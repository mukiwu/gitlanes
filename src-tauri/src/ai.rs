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

fn parse_response(provider: AiProvider, resp: &Value) -> Result<String, String> {
    let text = match provider {
        AiProvider::Gemini => resp
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str),
        AiProvider::OpenAI => resp
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        AiProvider::Anthropic => resp
            .pointer("/content/0/text")
            .and_then(Value::as_str),
        AiProvider::Ollama => resp.pointer("/response").and_then(Value::as_str),
    };
    text.map(|t| t.trim().to_string())
        .ok_or_else(|| "AI response did not contain any text.".to_string())
}

fn sanitize_error(raw: &str, api_key: Option<&str>) -> String {
    match api_key {
        Some(key) if !key.is_empty() => raw.replace(key, "[REDACTED]"),
        _ => raw.to_string(),
    }
}

const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434";

pub async fn ai_generate(
    provider: AiProvider,
    model: &str,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    prompt: &str,
    system: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let request = match provider {
        AiProvider::Gemini => {
            let key = api_key.ok_or_else(|| "Gemini API key is not set.".to_string())?;
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            );
            client
                .post(url)
                .header("x-goog-api-key", key)
                .json(&build_gemini_body(prompt, system))
        }
        AiProvider::OpenAI => {
            let key = api_key.ok_or_else(|| "OpenAI API key is not set.".to_string())?;
            client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key)
                .json(&build_openai_body(model, prompt, system))
        }
        AiProvider::Anthropic => {
            let key = api_key.ok_or_else(|| "Anthropic API key is not set.".to_string())?;
            client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&build_anthropic_body(model, prompt, system))
        }
        AiProvider::Ollama => {
            let base = endpoint.unwrap_or(DEFAULT_OLLAMA_ENDPOINT).trim_end_matches('/');
            let url = format!("{base}/api/generate");
            client.post(url).json(&build_ollama_body(model, prompt, system))
        }
    };

    let response = request
        .send()
        .await
        .map_err(|err| sanitize_error(&err.to_string(), api_key))?;

    if !response.status().is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "AI request failed".to_string());
        return Err(sanitize_error(&body, api_key));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|err| sanitize_error(&err.to_string(), api_key))?;
    parse_response(provider, &json).map_err(|err| sanitize_error(&err, api_key))
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

    #[test]
    fn parse_gemini_extracts_text() {
        let resp = json!({ "candidates": [{ "content": { "parts": [{ "text": "  hi  " }] } }] });
        assert_eq!(parse_response(AiProvider::Gemini, &resp), Ok("hi".to_string()));
    }

    #[test]
    fn parse_openai_extracts_text() {
        let resp = json!({ "choices": [{ "message": { "content": "  hi  " } }] });
        assert_eq!(parse_response(AiProvider::OpenAI, &resp), Ok("hi".to_string()));
    }

    #[test]
    fn parse_anthropic_extracts_text() {
        let resp = json!({ "content": [{ "type": "text", "text": "  hi  " }] });
        assert_eq!(parse_response(AiProvider::Anthropic, &resp), Ok("hi".to_string()));
    }

    #[test]
    fn parse_ollama_extracts_text() {
        let resp = json!({ "response": "  hi  " });
        assert_eq!(parse_response(AiProvider::Ollama, &resp), Ok("hi".to_string()));
    }

    #[test]
    fn parse_missing_field_errors() {
        let resp = json!({ "unexpected": true });
        assert!(parse_response(AiProvider::OpenAI, &resp).is_err());
    }

    #[test]
    fn sanitize_error_redacts_api_key() {
        let raw = "Invalid key sk-secret123 in request";
        let cleaned = sanitize_error(raw, Some("sk-secret123"));
        assert!(!cleaned.contains("sk-secret123"));
        assert!(cleaned.contains("[REDACTED]"));
    }

    #[test]
    fn sanitize_error_passthrough_when_no_key() {
        assert_eq!(sanitize_error("boom", None), "boom".to_string());
    }
}
