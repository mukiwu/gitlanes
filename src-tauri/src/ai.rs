use serde_json::{json, Value};

const ANTHROPIC_MAX_TOKENS: u32 = 4096;

fn build_gemini_body(prompt: &str, system: Option<&str>) -> Value {
    let mut body = json!({ "contents": [{ "parts": [{ "text": prompt }] }] });
    if let Some(system) = system {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    body
}

fn build_openai_body(model: &str, prompt: &str, system: Option<&str>) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    if let Some(system) = system {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": prompt }));
    json!({ "model": model, "messages": messages })
}

fn build_anthropic_body(model: &str, prompt: &str, system: Option<&str>) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "messages": [{ "role": "user", "content": prompt }]
    });
    if let Some(system) = system {
        body["system"] = json!(system);
    }
    body
}

fn build_ollama_body(model: &str, prompt: &str, system: Option<&str>) -> Value {
    let combined = match system {
        Some(system) => format!("{system}\n\n{prompt}"),
        None => prompt.to_string(),
    };
    json!({ "model": model, "prompt": combined, "stream": false })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiProvider {
    Gemini,
    OpenAI,
    Anthropic,
    Ollama,
}

impl AiProvider {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "gemini" => Ok(AiProvider::Gemini),
            "openai" => Ok(AiProvider::OpenAI),
            "anthropic" => Ok(AiProvider::Anthropic),
            "ollama" => Ok(AiProvider::Ollama),
            other => Err(format!("Unknown AI provider: {other}")),
        }
    }

    pub fn as_key_suffix(&self) -> &'static str {
        match self {
            AiProvider::Gemini => "gemini",
            AiProvider::OpenAI => "openai",
            AiProvider::Anthropic => "anthropic",
            AiProvider::Ollama => "ollama",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn from_str_roundtrips_all_providers() {
        for p in [AiProvider::Gemini, AiProvider::OpenAI, AiProvider::Anthropic, AiProvider::Ollama] {
            assert_eq!(AiProvider::from_str(p.as_key_suffix()), Ok(p));
        }
    }

    #[test]
    fn from_str_rejects_unknown() {
        assert!(AiProvider::from_str("grok").is_err());
    }

    #[test]
    fn gemini_body_has_contents_and_system() {
        let body = build_gemini_body("hello", Some("be brief"));
        assert_eq!(body["contents"][0]["parts"][0]["text"], json!("hello"));
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], json!("be brief"));
    }

    #[test]
    fn gemini_body_omits_system_when_none() {
        let body = build_gemini_body("hello", None);
        assert!(body.get("systemInstruction").is_none());
    }

    #[test]
    fn openai_body_has_messages_with_optional_system() {
        let body = build_openai_body("m1", "hello", Some("sys"));
        assert_eq!(body["model"], json!("m1"));
        assert_eq!(body["messages"][0]["role"], json!("system"));
        assert_eq!(body["messages"][0]["content"], json!("sys"));
        assert_eq!(body["messages"][1]["role"], json!("user"));
        assert_eq!(body["messages"][1]["content"], json!("hello"));

        let body_no_sys = build_openai_body("m1", "hello", None);
        assert_eq!(body_no_sys["messages"][0]["role"], json!("user"));
    }

    #[test]
    fn anthropic_body_has_max_tokens_and_system() {
        let body = build_anthropic_body("claude-x", "hello", Some("sys"));
        assert_eq!(body["model"], json!("claude-x"));
        assert_eq!(body["max_tokens"], json!(ANTHROPIC_MAX_TOKENS));
        assert_eq!(body["system"], json!("sys"));
        assert_eq!(body["messages"][0]["role"], json!("user"));
        assert_eq!(body["messages"][0]["content"], json!("hello"));

        let body_no_sys = build_anthropic_body("claude-x", "hello", None);
        assert!(body_no_sys.get("system").is_none());
    }

    #[test]
    fn ollama_body_combines_system_and_prompt() {
        let body = build_ollama_body("llama3", "hello", Some("sys"));
        assert_eq!(body["model"], json!("llama3"));
        assert_eq!(body["stream"], json!(false));
        assert_eq!(body["prompt"], json!("sys\n\nhello"));

        let body_no_sys = build_ollama_body("llama3", "hello", None);
        assert_eq!(body_no_sys["prompt"], json!("hello"));
    }
}
