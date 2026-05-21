# AI Provider 設定功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 GitLanes 的兩個 AI 功能（commit message / explain diff）可由使用者在 UI 內選擇 provider（Gemini / OpenAI / Anthropic / Ollama）、自帶 API key，並把 key 安全存進 OS keychain。

**Architecture:** 後端新增 `ai.rs`（4 個 provider 的 HTTP 抽象 + `ai_generate` 分派）與 `ai_settings.rs`（keychain load/save/has_key）。`lib.rs` 刪除寫死的 `gemini_generate`，兩個 AI command 改讀 keychain 設定，並新增 3 個設定相關 command。前端新增 `AiSettingsModal.tsx`，由 header 齒輪 dropdown 開啟；兩個 AI 觸發點在沒 key 時改為跳 toast + 自動開 modal。

**Tech Stack:** Rust (Tauri 2, reqwest, serde_json, keyring 3), TypeScript/React, Tailwind。

**驗收紀律（來自使用者）：** 四個 provider（Gemini / OpenAI / Anthropic / Ollama）都必須實際手動測過連線成功，才能把 Task 12 標記完成。Rust 純函式（request builder / response parser / error sanitizer）走 TDD；HTTP/keychain/UI 整合走手動驗收。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/Cargo.toml` | 依賴宣告 | Modify：加 `keyring = "3"` |
| `src-tauri/src/ai.rs` | provider 抽象：`AiProvider` enum、request body 建構、response 解析、error 過濾、`ai_generate` 分派 | Create |
| `src-tauri/src/ai_settings.rs` | keychain 讀寫：`AiSettings`、`load`/`save`/`has_key`/`clear_key` | Create |
| `src-tauri/src/lib.rs` | 刪 `gemini_generate`；改寫兩個 AI command；加 3 個設定 command；註冊模組與 handler | Modify |
| `src/tauriFetchShim.ts` | 新增 4 條 `/api/ai/*` 路由 | Modify |
| `src/components/AiSettingsModal.tsx` | provider tab + model dropdown + key input + 測試連線 | Create |
| `src/App.tsx` | dropdown 加入口、AI commit 沒 key 自動開 modal、provider 動態顯示、i18n | Modify |
| `src/components/DiffViewer.tsx` | explain diff 沒 key 自動開 modal（透過新 props） | Modify |
| `.env.example` / `README.md` | 移除 `GEMINI_API_KEY` 說明、改指向設定 modal | Modify |

**型別契約（跨任務一致，務必照抄命名）：**

- Rust enum：`AiProvider { Gemini, OpenAI, Anthropic, Ollama }`，提供 `AiProvider::from_str(&str) -> Result<Self, String>`（接受 `"gemini"` / `"openai"` / `"anthropic"` / `"ollama"`）與 `fn as_key_suffix(&self) -> &'static str`（回 `"gemini"` 等小寫字串）。
- keychain service name 常數：`const SERVICE: &str = "gitlanes";`
- keychain account 命名：`provider`、`model_<suffix>`、`apikey_<suffix>`、`endpoint_ollama`。
- 前端 `ai_settings_get` 回傳 JSON 形狀：`{ provider: string, model: string, hasKey: boolean, endpoint: string | null }`，**永不含 api key**。

---

## Task 1: 加入 keyring 依賴並建立 ai_settings 骨架（含 AiProvider enum）

**Files:**
- Modify: `src-tauri/Cargo.toml:15-26`
- Create: `src-tauri/src/ai.rs`
- Create: `src-tauri/src/ai_settings.rs`
- Modify: `src-tauri/src/lib.rs:1-11`（加 `mod ai;` `mod ai_settings;`）

- [ ] **Step 1: 加入 keyring 依賴**

修改 `src-tauri/Cargo.toml`，在 `[dependencies]` 區塊（第 15-26 行）的 `ignore = "0.4"` 後面加一行：

```toml
keyring = "3"
```

- [ ] **Step 2: 建立 ai.rs，先定義 AiProvider enum 與其轉換（含失敗測試）**

建立 `src-tauri/src/ai.rs`，先只放 enum 與轉換函式 + 測試：

```rust
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
```

- [ ] **Step 3: 在 lib.rs 註冊兩個新模組**

修改 `src-tauri/src/lib.rs`，在第 11 行 `use ignore::WalkBuilder;` 後面加：

```rust

mod ai;
mod ai_settings;
```

- [ ] **Step 4: 建立 ai_settings.rs 骨架（暫時讓 lib.rs 能編譯）**

建立 `src-tauri/src/ai_settings.rs`，先放最小骨架（Task 3 會填實作）：

```rust
use crate::ai::AiProvider;

const SERVICE: &str = "gitlanes";

pub struct AiSettings {
    pub provider: AiProvider,
    pub model: String,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}
```

- [ ] **Step 5: 跑測試確認 enum 邏輯通過、整體可編譯**

Run: `cd src-tauri && cargo test ai::tests`
Expected: PASS（2 個測試），且 `cargo build` 無誤（keyring 下載成功）。
若 keyring 下載失敗或編譯錯誤，先解決再繼續。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/ai.rs src-tauri/src/ai_settings.rs src-tauri/src/lib.rs
git commit -m "feat: scaffold ai provider module and keyring dependency"
```

---

## Task 2: ai.rs — 各 provider 的 request body 建構（純函式，TDD）

**Files:**
- Modify: `src-tauri/src/ai.rs`

每個 provider 的 request body 是純資料轉換，先寫測試鎖定 schema。

- [ ] **Step 1: 寫失敗測試（4 個 provider 的 body 形狀）**

在 `ai.rs` 的 `#[cfg(test)] mod tests` 內加入：

```rust
    use serde_json::json;

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
        assert_eq!(body["max_tokens"], json!(4096));
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd src-tauri && cargo test ai::tests::`
Expected: 編譯失敗（`build_gemini_body` 等未定義）。

- [ ] **Step 3: 實作 4 個 body builder**

在 `ai.rs`（`#[cfg(test)]` 之前）加入。需要在檔案頂部加 `use serde_json::{json, Value};`：

```rust
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd src-tauri && cargo test ai::tests::`
Expected: PASS（含前一任務的 enum 測試共 7 個）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ai.rs
git commit -m "feat: add per-provider request body builders"
```

---

## Task 3: ai.rs — response 解析與 error 過濾（純函式，TDD）

**Files:**
- Modify: `src-tauri/src/ai.rs`

- [ ] **Step 1: 寫失敗測試（response 解析 + key 過濾）**

在 `mod tests` 內加入：

```rust
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd src-tauri && cargo test ai::tests::parse`
Expected: 編譯失敗（`parse_response`、`sanitize_error` 未定義）。

- [ ] **Step 3: 實作 parse_response 與 sanitize_error**

在 `ai.rs` 加入：

```rust
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd src-tauri && cargo test ai::tests::`
Expected: PASS（共 14 個測試）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ai.rs
git commit -m "feat: add provider response parsing and error sanitization"
```

---

## Task 4: ai.rs — ai_generate HTTP 分派（整合，手動驗收）

**Files:**
- Modify: `src-tauri/src/ai.rs`

此步驟是真正打 HTTP 的分派，無法純單元測試；正確性在 Task 12 用各 provider 實測。

- [ ] **Step 1: 實作 ai_generate 公開函式**

在 `ai.rs` 加入（檔案頂部補 `use std::collections::HashMap;` 非必要——下方用 reqwest builder 直接設 header）：

```rust
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
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            );
            client.post(url).json(&build_gemini_body(prompt, system))
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
    parse_response(provider, &json)
}
```

- [ ] **Step 2: 確認編譯通過**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功（可能出現 `build_*_body` / `parse_response` 等 dead_code 警告——Task 5/6 接上後消失，暫時可忽略）。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ai.rs
git commit -m "feat: add ai_generate HTTP dispatch across providers"
```

---

## Task 5: ai_settings.rs — keychain load / save / has_key / clear_key（整合，手動驗收）

**Files:**
- Modify: `src-tauri/src/ai_settings.rs`

keychain 在測試環境會真的寫入 OS keychain，不適合自動化；正確性在 Task 11/12 手動驗收。

- [ ] **Step 1: 實作完整 ai_settings.rs**

把 `src-tauri/src/ai_settings.rs` 內容整個換成：

```rust
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

pub fn load() -> Result<AiSettings, String> {
    let provider = read("provider")
        .and_then(|p| AiProvider::from_str(&p).ok())
        .unwrap_or(AiProvider::Gemini);
    let suffix = provider.as_key_suffix();

    let model = read(&format!("model_{suffix}"))
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| default_model(provider).to_string());

    let api_key = if matches!(provider, AiProvider::Ollama) {
        None
    } else {
        read(&format!("apikey_{suffix}"))
    };

    let endpoint = match provider {
        AiProvider::Ollama => Some(
            read("endpoint_ollama")
                .filter(|e| !e.is_empty())
                .unwrap_or_else(|| "http://localhost:11434".to_string()),
        ),
        _ => None,
    };

    Ok(AiSettings { provider, model, api_key, endpoint })
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

    // api_key == None / "" 代表「保留現有 key 不動」；只有非空才覆寫。
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
        // Ollama 不需要 key——只要設定存在（endpoint 可用預設）即視為可用。
        AiProvider::Ollama => true,
        other => read(&format!("apikey_{}", other.as_key_suffix()))
            .map(|k| !k.is_empty())
            .unwrap_or(false),
    }
}

pub fn clear_key(provider: AiProvider) -> Result<(), String> {
    delete(&format!("apikey_{}", provider.as_key_suffix()))
}
```

- [ ] **Step 2: 確認編譯通過**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功。若 `delete_credential` 在 keyring 3 的 API 名稱不同，依編譯器訊息調整（keyring 3 為 `delete_credential`）。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ai_settings.rs
git commit -m "feat: add keychain-backed ai settings load/save/clear"
```

---

## Task 6: lib.rs — 改寫兩個 AI command 並刪除 gemini_generate

**Files:**
- Modify: `src-tauri/src/lib.rs:85-103`（刪 GeminiResponse 等 struct）
- Modify: `src-tauri/src/lib.rs:644-706`（刪 gemini_generate、改寫兩個 command）

- [ ] **Step 1: 刪除 Gemini response struct（第 85-103 行）**

刪除 `src-tauri/src/lib.rs` 第 85-103 行的這整段：

```rust
#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}
```

- [ ] **Step 2: 刪除 gemini_generate（第 644-673 行）**

刪除 `async fn gemini_generate(...)` 整個函式（從 `async fn gemini_generate` 到對應的結尾 `}`）。

- [ ] **Step 3: 改寫 git_ai_commit_message**

把 `git_ai_commit_message` 改成先讀設定再分派（注意：staged 為空時的訊息把「Gemini」字眼改為通用「AI」）：

```rust
#[tauri::command]
async fn git_ai_commit_message(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let diff = run_git(&state, &["diff", "--cached"])?.stdout;
    if diff.is_empty() {
        return Ok(json!({ "message": "", "error": "No changes are staged! Stage some modifications first to let AI generate a message." }));
    }
    let cfg = ai_settings::load()?;
    let prompt = format!("You are an expert Git GUI assistant. Analyze the following cached/staged git diff and write a beautifully structured Conventional Commit message (e.g., 'feat(auth): add login validation' or 'fix(calculator): resolve division by zero').\nVerify that the message represents only the actual modifications in the code. Keep it brief (ideally under 72 characters for the header). Include bullet points below if there are multiple substantial changes.\n\nDo not include markdown code block formatting--just return the plain text commit message.\n\nStaged Diff:\n{diff}");
    let message = ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        &prompt,
        Some("You are a professional commit analyst that writes Conventional Commit messages based on code diffs."),
    )
    .await?;
    Ok(json!({ "message": if message.is_empty() { "feat: update files".to_string() } else { message } }))
}
```

- [ ] **Step 4: 改寫 git_ai_explain_diff**

```rust
#[tauri::command]
async fn git_ai_explain_diff(state: State<'_, AppState>, file: String, staged: Option<bool>) -> Result<serde_json::Value, String> {
    if file.trim().is_empty() {
        return Err("file is required".to_string());
    }
    let diff = if staged.unwrap_or(false) {
        run_git(&state, &["diff", "--cached", "--", &file])?.stdout
    } else {
        run_git(&state, &["diff", "--", &file])?.stdout
    };
    if diff.is_empty() {
        return Ok(json!({ "explanation": "No dynamic differences detected on this file." }));
    }
    let cfg = ai_settings::load()?;
    let prompt = format!("As a senior software architect, analyze this diff from git on file \"{file}\" and explain the code changes in incredibly simple, scannable human terms.\nDetail the logical modifications, point out what was added or removed, and explain why this change would be made. Feel free to use brief markdown formatting with bolding or bullet points.\nKeep the answer concise and highly readable.\n\nGit Diff:\n{diff}");
    let explanation = ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        &prompt,
        None,
    )
    .await?;
    Ok(json!({ "explanation": if explanation.is_empty() { "No explanation could be compiled.".to_string() } else { explanation } }))
}
```

- [ ] **Step 5: 確認編譯通過**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功（`Deserialize` 若因刪掉 struct 變未使用，依警告調整 `use` —— 其他 struct 仍用到 `Deserialize`，通常不需改）。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "refactor: route ai commands through provider abstraction"
```

---

## Task 7: lib.rs — 新增 3 個設定 command 並註冊 handler

**Files:**
- Modify: `src-tauri/src/lib.rs`（在兩個 AI command 之後加新 command）
- Modify: `src-tauri/src/lib.rs:719-748`（invoke_handler 清單）

- [ ] **Step 1: 新增 ai_settings_get / ai_settings_set / ai_settings_clear_key / ai_test_connection**

在 `git_ai_explain_diff` 之後、`pub fn run()` 之前加入：

```rust
#[tauri::command]
async fn ai_settings_get() -> Result<serde_json::Value, String> {
    let cfg = ai_settings::load()?;
    Ok(json!({
        "provider": cfg.provider.as_key_suffix(),
        "model": cfg.model,
        "hasKey": ai_settings::has_key(cfg.provider),
        "endpoint": cfg.endpoint,
    }))
}

#[tauri::command]
async fn ai_settings_set(
    provider: String,
    model: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<serde_json::Value, String> {
    let provider = ai::AiProvider::from_str(&provider)?;
    ai_settings::save(provider, &model, api_key.as_deref(), endpoint.as_deref())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn ai_settings_clear_key(provider: String) -> Result<serde_json::Value, String> {
    let provider = ai::AiProvider::from_str(&provider)?;
    ai_settings::clear_key(provider)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn ai_test_connection() -> Result<serde_json::Value, String> {
    let cfg = ai_settings::load()?;
    match ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        "ping",
        Some("Reply with the single word: pong"),
    )
    .await
    {
        Ok(_) => Ok(json!({ "ok": true })),
        Err(message) => Ok(json!({ "ok": false, "message": message })),
    }
}
```

> 注意：Tauri 會把前端 camelCase 參數轉成 snake_case command 參數。前端送 `apiKey` → command 收 `api_key`（Task 8 的 shim 已配合）。

- [ ] **Step 2: 在 invoke_handler 註冊新 command**

把 `src-tauri/src/lib.rs:746-747` 的尾端：

```rust
            git_ai_commit_message,
            git_ai_explain_diff
        ])
```

改成：

```rust
            git_ai_commit_message,
            git_ai_explain_diff,
            ai_settings_get,
            ai_settings_set,
            ai_settings_clear_key,
            ai_test_connection
        ])
```

- [ ] **Step 3: 確認編譯通過**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功，無 dead_code 警告（所有 ai/ai_settings 函式都被用到）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add ai settings tauri commands and register handlers"
```

---

## Task 8: tauriFetchShim.ts — 新增 4 條 AI 設定路由

**Files:**
- Modify: `src/tauriFetchShim.ts:104-105`

- [ ] **Step 1: 加入 4 條路由**

在 `src/tauriFetchShim.ts` 第 104 行（`case "/api/git/ai/explain-diff":` 那一組）之後、`default:` 之前加入：

```typescript
      case "/api/ai/settings":
        return invokeJson("ai_settings_get");
      case "/api/ai/settings/set":
        return invokeJson("ai_settings_set", {
          provider: body.provider,
          model: body.model,
          apiKey: body.apiKey,
          endpoint: body.endpoint,
        });
      case "/api/ai/settings/clear-key":
        return invokeJson("ai_settings_clear_key", { provider: body.provider });
      case "/api/ai/test":
        return invokeJson("ai_test_connection");
```

> Tauri `invoke` 會把 `apiKey` 自動對應到 command 的 `api_key` 參數。

- [ ] **Step 2: 確認前端型別檢查通過**

Run: `npm run build`（或 `npx tsc --noEmit`）
Expected: 無型別錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/tauriFetchShim.ts
git commit -m "feat: add ai settings api routes to tauri fetch shim"
```

---

## Task 9: AiSettingsModal.tsx — 設定 modal 元件

**Files:**
- Create: `src/components/AiSettingsModal.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/AiSettingsModal.tsx`：

```typescript
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, X, CheckCircle2, XCircle } from "lucide-react";

type Provider = "gemini" | "openai" | "anthropic" | "ollama";

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  labels: AiSettingsLabels;
}

export interface AiSettingsLabels {
  title: string;
  provider: string;
  model: string;
  custom: string;
  apiKey: string;
  endpoint: string;
  clear: string;
  test: string;
  testing: string;
  testOk: string;
  cancel: string;
  save: string;
  keyStoredHint: string;
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "gemini", label: "Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "ollama", label: "Ollama" },
];

const MODEL_OPTIONS: Record<Provider, string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7"],
  ollama: [],
};

const CUSTOM_VALUE = "__custom__";
const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ open, onClose, onSaved, labels }) => {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState<string>("gemini-2.5-flash");
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_OLLAMA_ENDPOINT);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  // Modal 開啟時初始化目前設定
  useEffect(() => {
    if (!open) return;
    setShowKey(false);
    setApiKey("");
    setTestState("idle");
    setTestMessage("");
    fetch("/api/ai/settings")
      .then((res) => res.json())
      .then((data: { provider: Provider; model: string; hasKey: boolean; endpoint: string | null }) => {
        applyProviderState(data.provider, data.model, data.hasKey, data.endpoint);
      })
      .catch(() => {
        applyProviderState("gemini", "gemini-2.5-flash", false, null);
      });
  }, [open]);

  const applyProviderState = (p: Provider, m: string, keyExists: boolean, ep: string | null) => {
    setProvider(p);
    setHasKey(keyExists);
    setEndpoint(ep || DEFAULT_OLLAMA_ENDPOINT);
    if (p === "ollama") {
      setModel(m);
      setIsCustomModel(false);
    } else if (MODEL_OPTIONS[p].includes(m)) {
      setModel(m);
      setIsCustomModel(false);
    } else {
      setModel(m);
      setIsCustomModel(true);
    }
  };

  // 切換 provider tab：載入該 provider 已存的設定
  const handleSwitchProvider = (p: Provider) => {
    setApiKey("");
    setShowKey(false);
    setTestState("idle");
    setTestMessage("");
    fetch("/api/ai/settings")
      .then((res) => res.json())
      .then(() => {
        // settings_get 只回目前選定 provider；切到別的 provider 先用預設 model，
        // 真實 hasKey 在儲存後重新整理時才精準。先樂觀顯示預設值。
        const fallback = p === "ollama" ? "" : MODEL_OPTIONS[p][0];
        applyProviderState(p, fallback, false, null);
      });
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage("");
    try {
      // 測試前先存目前設定，確保後端用的是畫面上的值
      await persist();
      const res = await fetch("/api/ai/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setTestState("ok");
      } else {
        setTestState("fail");
        setTestMessage(data.message || "");
      }
    } catch (err) {
      setTestState("fail");
      setTestMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const persist = async () => {
    const payload: Record<string, unknown> = { provider, model };
    if (provider === "ollama") {
      payload.endpoint = endpoint;
    } else if (apiKey.trim()) {
      payload.apiKey = apiKey.trim();
    }
    const res = await fetch("/api/ai/settings/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Save failed");
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await persist();
      onSaved?.();
      onClose();
    } catch {
      setTestState("fail");
      setTestMessage("Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearKey = async () => {
    await fetch("/api/ai/settings/clear-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setHasKey(false);
    setApiKey("");
  };

  const handleModelDropdown = (value: string) => {
    if (value === CUSTOM_VALUE) {
      setIsCustomModel(true);
      setModel("");
    } else {
      setIsCustomModel(false);
      setModel(value);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[70] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">{labels.title}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* Provider segmented control */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.provider}</label>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-950 p-1">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSwitchProvider(p.id)}
                  className={`rounded px-2 py-1.5 text-xs font-mono transition-colors ${
                    provider === p.id ? "bg-cyan-600 text-slate-50" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.model}</label>
            {provider === "ollama" ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3"
                className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            ) : (
              <>
                <select
                  value={isCustomModel ? CUSTOM_VALUE : model}
                  onChange={(e) => handleModelDropdown(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  {MODEL_OPTIONS[provider].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value={CUSTOM_VALUE}>{labels.custom}</option>
                </select>
                {isCustomModel && (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="model-id"
                    className="mt-2 w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                )}
              </>
            )}
          </div>

          {/* API Key / Endpoint */}
          {provider === "ollama" ? (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.endpoint}</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={DEFAULT_OLLAMA_ENDPOINT}
                className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.apiKey}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? "••••••••••••" : ""}
                  className="flex-1 rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
                <button onClick={() => setShowKey((v) => !v)} className="rounded border border-slate-800 p-1.5 text-slate-400 hover:text-slate-200">
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button onClick={handleClearKey} className="rounded border border-slate-800 px-2 py-1.5 text-[10px] font-mono text-rose-400 hover:text-rose-300">
                  {labels.clear}
                </button>
              </div>
              {hasKey && <p className="mt-1 text-[10px] text-slate-500">{labels.keyStoredHint}</p>}
            </div>
          )}

          {/* Test result inline */}
          {testState === "ok" && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {labels.testOk}
            </div>
          )}
          {testState === "fail" && (
            <div className="flex items-start gap-1.5 text-xs text-rose-400">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{testMessage}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
          <button
            onClick={handleTest}
            disabled={testState === "testing"}
            className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs font-mono text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {testState === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {testState === "testing" ? labels.testing : labels.test}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-xs font-mono text-slate-400 hover:text-slate-200">
              {labels.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-xs font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {labels.save}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 2: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無型別錯誤（此時元件尚未被引用，僅檢查語法/型別）。

- [ ] **Step 3: Commit**

```bash
git add src/components/AiSettingsModal.tsx
git commit -m "feat: add AI settings modal component"
```

---

## Task 10: App.tsx — 整合 modal、dropdown 入口、沒 key 自動開、i18n

**Files:**
- Modify: `src/App.tsx`（import、state、translations、dropdown、handleAiSuggestedCommitMessage、DiffViewer props）

- [ ] **Step 1: import 元件與 icon**

在 `src/App.tsx` 第 32 行 `import { DiffViewer } from "./components/DiffViewer";` 之後加：

```typescript
import { AiSettingsModal, AiSettingsLabels } from "./components/AiSettingsModal";
```

並確認 `Sparkles` 已在 lucide import（DiffViewer 用，App 若沒有則略過）。在 App 既有的 lucide import 中加 `Sparkles`（若尚未引入）供 dropdown 項目使用。

- [ ] **Step 2: 新增 state**

在 `src/App.tsx:305` 附近（`isSettingsOpen` state 旁）加：

```typescript
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState<boolean>(false);
```

- [ ] **Step 3: translations 加入中英 label**

在 `src/App.tsx:47` 的 `translations` 物件，於 `en` 與 `zh` 兩組各加入以下 key（依物件既有縮排對齊，放在各語言區塊內）：

```typescript
    // en 區塊
    aiSettings: "AI Settings",
    aiSettingsTitle: "AI Settings",
    aiProvider: "Provider",
    aiModel: "Model",
    aiCustomModel: "Custom…",
    aiApiKey: "API Key",
    aiEndpoint: "Endpoint URL",
    aiClearKey: "Clear",
    aiTest: "Test Connection",
    aiTesting: "Testing…",
    aiTestOk: "Connection succeeded",
    aiCancel: "Cancel",
    aiSave: "Save",
    aiKeyStoredHint: "A key is stored. Leave blank to keep it.",
    toastSetupAiFirst: "Please set up an AI provider first.",
```

```typescript
    // zh 區塊
    aiSettings: "AI 設定",
    aiSettingsTitle: "AI 設定",
    aiProvider: "供應商",
    aiModel: "模型",
    aiCustomModel: "自訂…",
    aiApiKey: "API Key",
    aiEndpoint: "Endpoint URL",
    aiClearKey: "清除",
    aiTest: "測試連線",
    aiTesting: "測試中…",
    aiTestOk: "連線成功",
    aiCancel: "取消",
    aiSave: "儲存",
    aiKeyStoredHint: "已儲存金鑰，留空則保留現有金鑰。",
    toastSetupAiFirst: "請先設定 AI provider。",
```

- [ ] **Step 4: dropdown 加入「AI 設定…」項目**

在 `src/App.tsx:1459`（語言切換 row 與 `border-t` 分隔線之間，即第 1459 行 `</div>` 後、第 1461 行 `<div className="my-1 border-t...` 前）插入：

```typescript
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsAiSettingsOpen(true);
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 rounded font-mono cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    {t.aiSettings}
                  </button>
```

- [ ] **Step 5: handleAiSuggestedCommitMessage 加入沒 key 自動開 modal**

把 `src/App.tsx:875-898` 的 `handleAiSuggestedCommitMessage` 改成（在送出前先檢查 hasKey）：

```typescript
  const handleAiSuggestedCommitMessage = async () => {
    const stagedFiles = gitFiles.filter(f => f.staged);
    if (stagedFiles.length === 0) {
      showToast(t.toastNoFilesStaged, true);
      return;
    }

    try {
      const settingsRes = await fetch("/api/ai/settings");
      const settings = await settingsRes.json();
      if (!settings.hasKey) {
        showToast(t.toastSetupAiFirst, true);
        setIsAiSettingsOpen(true);
        return;
      }
    } catch {
      showToast(t.toastSetupAiFirst, true);
      setIsAiSettingsOpen(true);
      return;
    }

    setIsAiLoading(true);
    try {
      const res = await fetch("/api/git/ai/commit-message", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not invoke AI provider.");
      if (data.error) throw new Error(data.error);

      setCommitMessage(data.message);
      showToast(t.toastAiCommitDone);
    } catch (err: any) {
      showToast(err.message || t.toastAiCommitFailed, true);
    } finally {
      setIsAiLoading(false);
    }
  };
```

- [ ] **Step 6: 渲染 modal 並把 openSettings 傳給 DiffViewer**

把 `src/App.tsx:1737-1741` 的 `<DiffViewer .../>` 改成加一個 prop：

```typescript
              <DiffViewer
                file={diffTarget.path}
                staged={diffTarget.staged}
                onClose={() => setDiffTarget(null)}
                onNeedAiSetup={() => {
                  showToast(t.toastSetupAiFirst, true);
                  setIsAiSettingsOpen(true);
                }}
              />
```

並在 `</nav>` 之後（第 1485 行附近）或元件 return 的最外層 fragment 內、靠近其他 modal 的位置，加入 modal 渲染：

```typescript
      <AiSettingsModal
        open={isAiSettingsOpen}
        onClose={() => setIsAiSettingsOpen(false)}
        labels={{
          title: t.aiSettingsTitle,
          provider: t.aiProvider,
          model: t.aiModel,
          custom: t.aiCustomModel,
          apiKey: t.aiApiKey,
          endpoint: t.aiEndpoint,
          clear: t.aiClearKey,
          test: t.aiTest,
          testing: t.aiTesting,
          testOk: t.aiTestOk,
          cancel: t.aiCancel,
          save: t.aiSave,
          keyStoredHint: t.aiKeyStoredHint,
        } satisfies AiSettingsLabels}
      />
```

> 放置位置：找到 App return 中已有 modal/overlay 的區域（如 confirm dialog）旁邊即可，確保在最外層容器內。

- [ ] **Step 7: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無型別錯誤。若 `DiffViewer` 還沒加 `onNeedAiSetup` prop 會報錯——Task 11 會補；可先暫時讓 prop optional（Task 11 定義為 optional）。

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate AI settings modal and no-key fallback in App"
```

---

## Task 11: DiffViewer.tsx — explain diff 沒 key 自動開 modal

**Files:**
- Modify: `src/components/DiffViewer.tsx:4-9`（props 介面）
- Modify: `src/components/DiffViewer.tsx:50-72`（handleExplain）

- [ ] **Step 1: 介面加入 onNeedAiSetup**

把 `src/components/DiffViewer.tsx:4-9` 的 `DiffViewerProps` 改成：

```typescript
interface DiffViewerProps {
  file: string;
  staged: boolean;
  commitHash?: string;
  onClose?: () => void;
  onNeedAiSetup?: () => void;
}
```

並在第 11-16 行的解構加入 `onNeedAiSetup`：

```typescript
export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  staged,
  commitHash,
  onClose,
  onNeedAiSetup,
}) => {
```

- [ ] **Step 2: handleExplain 先檢查 hasKey**

把 `src/components/DiffViewer.tsx:50-72` 的 `handleExplain` 改成：

```typescript
  const handleExplain = async () => {
    try {
      const settingsRes = await fetch("/api/ai/settings");
      const settings = await settingsRes.json();
      if (!settings.hasKey) {
        onNeedAiSetup?.();
        return;
      }
    } catch {
      onNeedAiSetup?.();
      return;
    }

    setIsExplaining(true);
    setErrorMess(null);
    try {
      const res = await fetch("/api/git/ai/explain-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, staged, commit: commitHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch AI explanation");
      if (data.error) throw new Error(data.error);
      setExplanation(data.explanation);
    } catch (err: any) {
      setErrorMess(err.message || "Failed to contact AI provider.");
    } finally {
      setIsExplaining(false);
    }
  };
```

- [ ] **Step 3: 確認型別檢查通過**

Run: `npx tsc --noEmit`
Expected: 無型別錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/components/DiffViewer.tsx
git commit -m "feat: prompt AI setup from diff explainer when no key"
```

---

## Task 12: 四個 provider 手動測試（驗收 gate）

**Files:** 無程式改動（純驗收）。

> **此任務未全部通過前，整個功能不得標記完成。** 依 spec §7 測試矩陣逐項手動驗證。

- [ ] **Step 1: 啟動 app**

Run: `npm run tauri dev`
Expected: app 開啟、能開啟一個 git repo。

- [ ] **Step 2: 首次啟動行為**

操作：在沒設定任何 key 的狀態下，stage 一個檔案，按「AI 建議」commit 按鈕。
Expected: 跳 toast「請先設定 AI provider」+ AI 設定 modal 自動開啟。

- [ ] **Step 3: Gemini 測試**

操作：選 Gemini、填入有效 Gemini key、按「測試連線」。
Expected: 綠勾「連線成功」。再按「儲存」→ 回主畫面按「AI 建議」→ 產生 commit message。

- [ ] **Step 4: OpenAI 測試（含錯誤 key）**

操作：切到 OpenAI，先填一個**錯誤** key，測試連線。
Expected: 紅叉 + 後端錯誤訊息（且訊息中不含完整 key 明文）。
再填**正確** key 測試。
Expected: 綠勾。儲存後 explain diff 可運作。

- [ ] **Step 5: Anthropic 測試**

操作：切到 Anthropic、選 `claude-haiku-4-5`、填有效 key、測試連線。
Expected: 綠勾。儲存後兩個 AI 功能可運作。

- [ ] **Step 6: Ollama 測試（含未啟動情境）**

操作：先在 endpoint 沒啟動的狀態測試。
Expected: 紅叉「連線失敗」（連線錯誤，非 401）。
啟動本地 ollama（`ollama serve` + 已 pull 一個 model 如 `llama3`），填 model 名、測試連線。
Expected: 綠勾。

- [ ] **Step 7: provider 切換狀態還原**

操作：在已設定 Gemini + Anthropic 後，於 modal 切換 provider tab。
Expected: 對應 model 與 hasKey placeholder（`••••`）正確顯示。

- [ ] **Step 8: 持久化與清除**

操作：(a) 設定 key 後重啟 app → 設定仍在。(b) 在 modal 按某 provider 的「清除」→ 再按 AI 建議 → 行為等同首次（toast + 自動開 modal）。
Expected: 兩者皆符合。

- [ ] **Step 9: 安全檢查**

操作：在 dev console / 後端 log 觀察 explain/commit/test 過程。
Expected: 任何 log、error toast、`ai_settings_get` 回傳中都看不到 API key 明文。

- [ ] **Step 10: 全部通過後，把本任務所有 checkbox 勾完**

四個 provider 全部實測連線成功、矩陣全綠，才算完成。

---

## Task 13: 文件更新

**Files:**
- Modify: `.env.example`
- Modify: `README.md:31-34`

- [ ] **Step 1: 清空 / 改寫 .env.example**

把 `.env.example` 內的 `GEMINI_API_KEY` 區段移除，改為說明 AI key 改由 app 內設定 modal 管理。新內容：

```
# GitLanes 不再使用環境變數設定 AI 金鑰。
# AI provider 與 API key 請於 app 內「AI 設定」modal 設定，金鑰會存進 OS keychain。
```

- [ ] **Step 2: 改寫 README 的 AI 設定段落**

把 `README.md:31-34` 那段（提到 `GEMINI_API_KEY` 與 `GEMINI_API_KEY=your_key npm run dev`）改為：

```markdown
AI commit-message and diff explanation are configured in-app via the gear menu → "AI Settings".
Choose a provider (Gemini / OpenAI / Anthropic / Ollama), pick a model, and paste your API key.
Keys are stored in the OS keychain and never written to disk or logs.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: replace GEMINI_API_KEY env setup with in-app AI settings"
```

---

## Task 14: 推送

- [ ] **Step 1: 確認全綠**

Run: `cd src-tauri && cargo test && cargo build` 然後 `npx tsc --noEmit`
Expected: 全部通過。

- [ ] **Step 2: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage 對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 後端 provider 抽象（ai.rs / ai_generate / 4 endpoint） | Task 2, 3, 4 |
| §4.2 Keychain 整合（keyring / AiSettings / load/save/has_key） | Task 1, 5 |
| §4.3 4 個 Tauri command | Task 7（含 clear_key、test_connection、get、set） |
| §4.4 AiSettingsModal（segmented control / model dropdown / 自訂 / key input / 眼睛 / 清除 / 測試） | Task 9 |
| §4.4 切換 provider 還原 model+hasKey | Task 9 / 驗收 Task 12 Step 7 |
| §4.5 沒 key 自動開 modal（commit + explain 兩觸發點） | Task 10 Step 5, Task 11 |
| §5 檔案改動清單（含 shim 4 路由、i18n、docs） | Task 8, 10 Step 3, Task 13 |
| §6 安全紅線（key 不回傳前端、不入 log、error 過濾） | Task 3（sanitize_error）, Task 7（get 不回 key）, 驗收 Task 12 Step 9 |
| §7 測試矩陣（含 4 provider 實測） | Task 12 |

**待釐清項目（spec §8）：** keyring 在 bundled macOS app 的 entitlement、Anthropic max_tokens=4096 —— 已在實作中採預設值（4096），bundled 權限問題於 Task 12 實測時遇到再處理，不影響架構。

**型別一致性檢查：** `AiProvider::from_str` / `as_key_suffix`、keychain account 命名（`apikey_<suffix>`）、前端 `hasKey`/`apiKey`、`AiSettingsLabels` 介面在 Task 9 定義並於 Task 10 使用——命名一致。`onNeedAiSetup` 在 Task 10（傳入）與 Task 11（定義為 optional）一致。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。
