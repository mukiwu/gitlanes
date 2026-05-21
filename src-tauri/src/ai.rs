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
}
