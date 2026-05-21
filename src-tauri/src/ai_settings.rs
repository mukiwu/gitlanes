use crate::ai::AiProvider;

const SERVICE: &str = "gitlanes";

pub struct AiSettings {
    pub provider: AiProvider,
    pub model: String,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}
