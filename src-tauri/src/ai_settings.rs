use crate::ai::AiProvider;
use keyring::Entry;

const SERVICE: &str = "gitlanes";

pub struct AiSettings {
    pub provider: AiProvider,
    pub model: String,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|err| err.to_string())
}

fn read(account: &str) -> Option<String> {
    entry(account).ok().and_then(|e| e.get_password().ok())
}

fn write(account: &str, value: &str) -> Result<(), String> {
    entry(account)?.set_password(value).map_err(|err| err.to_string())
}

fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn default_model(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Gemini => "gemini-2.5-flash",
        AiProvider::OpenAI => "gpt-4o-mini",
        AiProvider::Anthropic => "claude-haiku-4-5",
        AiProvider::Ollama => "",
    }
}

fn stored_model(provider: AiProvider) -> String {
    read(&format!("model_{}", provider.as_key_suffix()))
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| default_model(provider).to_string())
}

fn stored_endpoint(provider: AiProvider) -> Option<String> {
    match provider {
        AiProvider::Ollama => Some(
            read("endpoint_ollama")
                .filter(|e| !e.is_empty())
                .unwrap_or_else(|| "http://localhost:11434".to_string()),
        ),
        _ => None,
    }
}

pub fn load() -> Result<AiSettings, String> {
    let provider = read("provider")
        .and_then(|p| AiProvider::from_str(&p).ok())
        .unwrap_or(AiProvider::Gemini);

    let api_key = if matches!(provider, AiProvider::Ollama) {
        None
    } else {
        read(&format!("apikey_{}", provider.as_key_suffix()))
    };

    Ok(AiSettings {
        provider,
        model: stored_model(provider),
        api_key,
        endpoint: stored_endpoint(provider),
    })
}

/// Returns (model, hasKey, endpoint) for a specific provider, without changing
/// the active provider. Used by the settings modal to restore per-provider
/// state when the user switches provider tabs.
pub fn provider_state(provider: AiProvider) -> (String, bool, Option<String>) {
    (stored_model(provider), has_key(provider), stored_endpoint(provider))
}

pub fn save(
    provider: AiProvider,
    model: &str,
    api_key: Option<&str>,
    endpoint: Option<&str>,
) -> Result<(), String> {
    let suffix = provider.as_key_suffix();
    write("provider", suffix)?;
    write(&format!("model_{suffix}"), model)?;

    // api_key == None / "" means "keep existing key untouched"; only overwrite when non-empty.
    if let Some(key) = api_key {
        if !key.is_empty() {
            write(&format!("apikey_{suffix}"), key)?;
        }
    }

    if matches!(provider, AiProvider::Ollama) {
        if let Some(endpoint) = endpoint {
            write("endpoint_ollama", endpoint)?;
        }
    }
    Ok(())
}

pub fn has_key(provider: AiProvider) -> bool {
    match provider {
        // Ollama needs no key — if settings exist (endpoint can default) treat as usable.
        AiProvider::Ollama => true,
        other => read(&format!("apikey_{}", other.as_key_suffix()))
            .map(|k| !k.is_empty())
            .unwrap_or(false),
    }
}

pub fn clear_key(provider: AiProvider) -> Result<(), String> {
    delete(&format!("apikey_{}", provider.as_key_suffix()))
}
