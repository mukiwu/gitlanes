# AI Provider 設定設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | GitLanes 兩個 AI 功能改為使用者可選 provider + 自帶 API key |
| 預估工時 | 1～1.5 個工作天（含 4 個 provider 手動測試） |

---

## 1. 背景與動機

GitLanes 目前有兩個 AI 功能：

- `git_ai_commit_message`（[src-tauri/src/lib.rs:676](../../../src-tauri/src/lib.rs#L676)）—— 從 staged diff 產生 Conventional Commit 訊息
- `git_ai_explain_diff`（[src-tauri/src/lib.rs:691](../../../src-tauri/src/lib.rs#L691)）—— 解釋單檔 diff

兩個都寫死走 Gemini 2.5 Flash，API key 透過 `GEMINI_API_KEY` 環境變數讀（[src-tauri/src/lib.rs:645](../../../src-tauri/src/lib.rs#L645)）。使用者沒辦法選別家供應商，也沒辦法在 UI 內設定／更換 key。

目標：讓使用者可以從 UI 選擇 AI 供應商與模型、自帶 API key，並把 key 存進 OS 安全儲存。

---

## 2. 目標

- 支援四個 provider：Gemini、OpenAI、Anthropic、Ollama（本地）
- 每個 provider 可選模型，包含「自訂…」手填 model ID 的逃生通道
- API key 存進 OS keychain，前後端流通時不外洩到日誌或前端 state
- 提供「測試連線」按鈕讓使用者驗證設定是否正確
- 兩個 AI 功能共用同一組 provider/model 設定（v1）
- 沒設定 key 時，AI 按鈕仍可點，按下會跳 toast + 自動開啟設定 modal

---

## 3. 不做（YAGNI）

- 兩個 AI 功能分別設定 provider/model
- 保留 `.env` / `GEMINI_API_KEY` 環境變數 fallback（避免「兩條來源誰贏」的混亂）
- 多 model 並排比較
- AI 對話歷史、重試上一次結果
- 自訂 prompt template
- 金鑰跨裝置同步（keychain 本身綁裝置）
- 使用量／額度顯示

---

## 4. 架構

### 4.1 後端 provider 抽象層

新增 `src-tauri/src/ai.rs`，公開：

```rust
pub enum AiProvider { Gemini, OpenAI, Anthropic, Ollama }

pub async fn ai_generate(
    provider: AiProvider,
    model: &str,
    api_key: Option<&str>,    // Ollama 不需要
    endpoint: Option<&str>,   // 只給 Ollama
    prompt: &str,
    system: Option<&str>,
) -> Result<String, String>
```

內部依 provider 分派到對應 HTTP 呼叫函式（`call_gemini`、`call_openai`、`call_anthropic`、`call_ollama`），每個函式處理該 provider 的 request/response schema。

`lib.rs` 原本的 `gemini_generate` 刪除，兩個 AI command 改成：

```rust
async fn git_ai_commit_message(state) {
    let cfg = load_ai_settings()?;  // 從 keychain 讀
    let message = ai::ai_generate(cfg.provider, &cfg.model, cfg.api_key.as_deref(),
                                   cfg.endpoint.as_deref(), &prompt, Some(&system)).await?;
    // ...
}
```

#### 各 provider endpoint

| Provider | URL pattern |
|---|---|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` |
| OpenAI | `https://api.openai.com/v1/chat/completions` (Bearer auth) |
| Anthropic | `https://api.anthropic.com/v1/messages` (`x-api-key` header + `anthropic-version: 2023-06-01`) |
| Ollama | `{endpoint}/api/generate`（預設 `http://localhost:11434`） |

### 4.2 Keychain 整合

加 `keyring = "3"` crate 到 `Cargo.toml`。

**Service name**：`gitlanes`

**儲存項目**（每個是一個獨立 keychain entry，account 名稱對應到下表 key）：

| Keychain key | 內容 | 範例 |
|---|---|---|
| `provider` | 目前選定的 provider | `gemini` / `openai` / `anthropic` / `ollama` |
| `model_gemini` | Gemini 用的 model | `gemini-2.5-flash` |
| `model_openai` | OpenAI 用的 model | `gpt-4o-mini` |
| `model_anthropic` | Anthropic 用的 model | `claude-haiku-4-5` |
| `model_ollama` | Ollama 用的 model | `llama3` |
| `apikey_gemini` | Gemini API key | — |
| `apikey_openai` | OpenAI API key | — |
| `apikey_anthropic` | Anthropic API key | — |
| `endpoint_ollama` | Ollama HTTP endpoint | `http://localhost:11434` |

讀取／寫入抽到 `src-tauri/src/ai_settings.rs`，公開：

```rust
pub struct AiSettings {
    pub provider: AiProvider,
    pub model: String,
    pub api_key: Option<String>,   // 不要序列化、不要回傳前端
    pub endpoint: Option<String>,
}

pub fn load() -> Result<AiSettings, String>
pub fn save(provider: AiProvider, model: &str, api_key: Option<&str>, endpoint: Option<&str>) -> Result<(), String>
pub fn has_key(provider: AiProvider) -> bool
```

### 4.3 新增 Tauri commands

```rust
#[tauri::command]
async fn ai_settings_get() -> Result<JsonValue, String>
// 回傳 { provider, model, hasKey, endpoint } —— api_key 永遠不回傳

#[tauri::command]
async fn ai_settings_set(provider: String, model: String,
                         apiKey: Option<String>, endpoint: Option<String>) -> Result<JsonValue, String>
// 寫進 keychain；apiKey 省略 / None 代表「保留現有 key 不動」

#[tauri::command]
async fn ai_settings_clear_key(provider: String) -> Result<JsonValue, String>
// 刪除指定 provider 的 keychain key entry

#[tauri::command]
async fn ai_test_connection() -> Result<JsonValue, String>
// 用目前設定送極短 prompt（如 "ping"），回 { ok: bool, message?: string }
```

### 4.4 前端 AI 設定 modal

新增 `src/components/AiSettingsModal.tsx`。

**入口**：header 齒輪 dropdown（[src/App.tsx:1444](../../../src/App.tsx#L1444)）新增「AI 設定…」項目；點下去設 `isAiSettingsOpen=true`，dropdown 收起。

**Modal 結構**：

```
┌─ AI 設定 ───────────────────────────────┐
│                                         │
│ Provider                                │
│ [Gemini] [OpenAI] [Anthropic] [Ollama]  │  segmented control
│                                         │
│ Model                                   │
│ [▼ gemini-2.5-flash         ]           │  dropdown
│   └ 選「自訂…」會出現 text input         │
│                                         │
│ API Key（Ollama 時改 Endpoint URL）       │
│ [••••••••••••••••••]  [👁] [清除]        │
│                                         │
│ ──────────────────────────────────────  │
│ [測試連線]                [取消] [儲存] │
└─────────────────────────────────────────┘
```

**Model dropdown 預設清單**（v1 寫死，未來再考慮動態抓）：

| Provider | 預設選項 |
|---|---|
| Gemini | `gemini-2.5-flash`、`gemini-2.5-pro`、`自訂…` |
| OpenAI | `gpt-4o-mini`、`gpt-4o`、`自訂…` |
| Anthropic | `claude-haiku-4-5`、`claude-sonnet-4-6`、`claude-opus-4-7`、`自訂…` |
| Ollama | 純手填（裝什麼模型只有使用者自己知道） |

**行為**：

- Modal 開啟時呼叫 `ai_settings_get` 初始化 state
- 切換 provider tab：自動載入該 provider 之前儲存的 model + `hasKey` 狀態
- Key 輸入框預設遮蔽（`type="password"`），眼睛圖示切換成 `type="text"` 顯示明文
- 若 `hasKey=true`，輸入框顯示 placeholder `••••••••`（不顯示實際值，因為後端不回傳）；輸入框留空送出代表保留現有 key
- 「清除」按鈕：清掉該 provider 的 key（呼叫獨立 command `ai_settings_clear_key`）
- 「測試連線」：呼叫 `ai_test_connection`，顯示 inline 結果（綠勾 / 紅叉 + 訊息），不擋 modal
- 「儲存」：呼叫 `ai_settings_set`、關 modal

### 4.5 沒設定 key 時的行為

兩個 AI 觸發點：

- Commit message「AI 建議」按鈕（[src/App.tsx:875](../../../src/App.tsx#L875) `handleAiSuggestedCommitMessage`）
- DiffViewer 的「解釋這個 diff」按鈕（`src/components/DiffViewer.tsx`）

**行為**：

- AI 按鈕**不灰**、永遠可點
- 點下去先檢查 `ai_settings_get` 的 `hasKey`：
  - `hasKey = false` → toast「請先設定 AI provider」+ 自動開啟 AI 設定 modal
  - `hasKey = true` → 直接呼叫對應 AI command；失敗時 toast 顯示後端傳回的錯誤訊息

理由：disabled + tooltip 在 desktop app 上對使用者不友善——hover 才看得到 tooltip，按不下去也不知道為什麼。

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust crate | `src-tauri/Cargo.toml` | 加 `keyring = "3"`、可能加 `async-trait` |
| Rust AI 層 | `src-tauri/src/ai.rs`（新檔） | 4 個 provider HTTP 呼叫 + `ai_generate` 分派 |
| Rust 設定 | `src-tauri/src/ai_settings.rs`（新檔） | keychain load / save / has_key |
| Rust commands | `src-tauri/src/lib.rs` | 刪 `gemini_generate`；改寫 `git_ai_commit_message` / `git_ai_explain_diff`；新增 `ai_settings_get` / `ai_settings_set` / `ai_test_connection`；更新 `invoke_handler` 清單 |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 `/api/ai/settings`（GET）、`/api/ai/settings/set`、`/api/ai/settings/clear-key`、`/api/ai/test` 四條路由 |
| 前端 modal | `src/components/AiSettingsModal.tsx`（新檔） | provider tab + model dropdown + key input + 測試連線 |
| 前端整合 | `src/App.tsx` | header dropdown 加「AI 設定…」；`handleAiSuggestedCommitMessage` 加「沒 key 自動開 modal」；把 hardcode 的「Gemini」字眼改成跟著 provider 顯示 |
| 前端整合 | `src/components/DiffViewer.tsx` | 解釋 diff 按鈕同樣加「沒 key 自動開 modal」邏輯 |
| i18n | `src/App.tsx`（`translations` 物件） | 中英雙語新增 AI 設定相關 label |
| 文件 | `.env.example`、`README.md` | 移除 `GEMINI_API_KEY` 區段、改說明走設定 modal |

---

## 6. 安全紅線

- **API key 永遠不透過 `invoke` 回傳前端**，前端只看得到 `hasKey: boolean`
- **不寫進 log**、不寫進任何 `Result` 的 error 訊息
- **不寫進 `.env`、不寫進 app data dir 的明文檔案**，只走 keychain
- HTTP request body 內含 key 的部分由後端組裝，不經前端中轉
- 「測試連線」的回應錯誤訊息要審慎處理——provider 4xx response 有時會在 body 中 echo 部分 key 或 prompt，前端顯示前要過濾

---

## 7. 測試與驗收

手動測試矩陣（v1 無自動化）：

| 場景 | 預期 |
|---|---|
| 首次啟動、按 AI 建議 | Toast「請先設定」+ modal 自動開啟 |
| 設定 Gemini key + 測試連線 | 綠勾「連線成功」 |
| 設定錯誤 OpenAI key + 測試連線 | 紅叉 + 後端錯誤訊息 |
| 同時設定 Anthropic + Ollama，切換 provider | 對應 model + hasKey 狀態正確還原 |
| Ollama 在 endpoint 沒啟動的狀態下測試 | 紅叉「連線失敗」（連線錯誤，不是 401） |
| 設定 key 後重啟 app | 設定仍在（keychain 持久化） |
| 「清除」key 後再按 AI 建議 | 行為等同首次啟動 |
| 重灌 app（清掉 app data） | keychain 還在，重開仍可用（除非使用者主動清 keychain） |

---

## 8. 待釐清項目

- `keyring` crate 在 macOS bundled app（非 dev mode）的權限——可能需要 entitlement / code signing 設定，第一次寫入會跳系統 keychain 確認 dialog
- Anthropic API 的 `max_tokens` 必填——預設 4096 應該夠用，但 explain diff 對長檔案可能要視情況調整

這兩點不影響架構，實作時遇到再處理。
