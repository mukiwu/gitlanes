# Push / Pull / Fetch 與 ahead-behind 指示設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | 工具列加入 Push / Pull / Fetch，並在目前分支旁顯示 ahead/behind |
| 預估工時 | 約半個工作天（含手動測試） |
| 相依 | 建立在 `feat/commit-context-menu` 分支之上 |

---

## 1. 背景與動機

GitLanes 目前能 clone、commit、操作分支與 commit，但**沒有與遠端同步的功能**——無法 push 本地 commit、pull 遠端更新、或 fetch 遠端狀態。使用者也看不到目前分支相對 upstream 領先/落後幾個 commit。

目標：在頂部 workspace nav 工具列加入 **Pull / Push / Fetch** 三顆按鈕（作用於目前分支），並在分支名旁顯示 **ahead/behind** 指示。

---

## 2. 目標

- 工具列三顆按鈕：**Pull**、**Push**、**Fetch**，作用於目前分支。
- Push 在分支尚無 upstream 時自動 `git push -u origin <branch>`（首推設定追蹤）。
- 目前分支名旁顯示 **ahead/behind**（如 `main ↑2 ↓1`）；無 upstream 不顯示數字。
- 網路操作執行中顯示 spinner 並 disable 按鈕；完成後 `refreshState()` 重算狀態。
- 認證走系統 git credential helper / SSH；**設 `GIT_TERMINAL_PROMPT=0` 讓無認證時快速失敗**而非 hang。
- 不做二次確認（工具列明確點擊即意圖）。
- 中英雙語 i18n。

---

## 3. 不做（YAGNI）

- 分支 chip 右鍵的 push/pull（推非當前分支需額外處理）——本次只做工具列、作用於目前分支。
- 選擇 remote（多 remote 時）——一律對預設 upstream / `origin`。
- Pull 的 rebase 模式切換（`--rebase`）——用使用者 git 設定的預設行為。
- 衝突解決 UI——衝突時只以 toast 顯示 git 訊息，使用者自行於工作區處理。
- 認證設定 UI（輸入帳密 / token 管理）——倚賴系統既有 git 認證。
- 進度條 / 即時輸出串流——只在完成後給結果 toast。

---

## 4. 架構

### 4.1 後端

新增三個 command（註冊進 invoke_handler）。網路操作用一個會設定 `GIT_TERMINAL_PROMPT=0` 的執行路徑。

#### 新增 run_git_no_prompt helper

既有的 `run_process` 不帶自訂 env。新增一個小 helper，在目前 repo 路徑下執行 git 並設 `GIT_TERMINAL_PROMPT=0`（避免無 tty 時等待帳密輸入而 hang）：

```rust
fn run_git_network(state: &State<'_, AppState>, args: &[&str]) -> Result<CommandResult, String> {
    let repo_path = current_repo_path(state)?;
    let output = Command::new("git")
        .args(args)
        .current_dir(&repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| format!("Failed to run git: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let code = output.status.code().unwrap_or(1);
    let command = format!("git {}", args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" "));
    log_command(state, command, code, stdout.clone(), stderr.clone());
    Ok(CommandResult { stdout, stderr, code })
}
```

（沿用既有 `quote_arg` / `log_command` / `CommandResult` / `git_error`。）

#### 三個 command

```rust
#[tauri::command]
async fn git_push(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // 取目前分支
    let branch = run_git(&state, &["branch", "--show-current"])?.stdout;
    if branch.is_empty() {
        return Err("Not on a branch (detached HEAD); cannot push.".to_string());
    }
    // 是否已有 upstream
    let upstream = run_git(&state, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
    let result = if upstream.code == 0 {
        run_git_network(&state, &["push"])?
    } else {
        run_git_network(&state, &["push", "-u", "origin", branch.trim()])?
    };
    git_error(result, "Push failed")?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn git_pull(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let result = run_git_network(&state, &["pull"])?;
    git_error(result, "Pull failed")?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn git_fetch(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let result = run_git_network(&state, &["fetch", "--all", "--prune"])?;
    git_error(result, "Fetch failed")?;
    Ok(json!({ "success": true }))
}
```

#### 擴充 git_status：ahead / behind / hasUpstream

`GitStatusResponse` struct 加三個欄位：

```rust
#[derive(Debug, Serialize)]
struct GitStatusResponse {
    initialized: bool,
    #[serde(rename = "currentBranch")]
    current_branch: String,
    #[serde(rename = "workspacePath")]
    workspace_path: Option<String>,
    files: Vec<GitFile>,
    #[serde(rename = "hasUpstream")]
    has_upstream: bool,
    ahead: u32,
    behind: u32,
}
```

在 `git_status` 計算（在已確認是 git repo 之後）：用 `git rev-list --count --left-right @{u}...HEAD`，輸出格式為 `"<behind>\t<ahead>"`（left = upstream 多出的 = behind，right = HEAD 多出的 = ahead）。無 upstream 時該指令 exit code != 0：

```rust
let (has_upstream, ahead, behind) = {
    let rl = run_git(&state, &["rev-list", "--count", "--left-right", "@{u}...HEAD"])?;
    if rl.code == 0 {
        let mut parts = rl.stdout.split_whitespace();
        let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        (true, ahead, behind)
    } else {
        (false, 0, 0)
    }
};
```

並把 `has_upstream` / `ahead` / `behind` 填進回傳的 `GitStatusResponse`。其他既有的「未初始化 / 非 repo」early-return 分支也要補上這三個欄位（`has_upstream: false, ahead: 0, behind: 0`）。

### 4.2 Tauri shim 路由

`src/tauriFetchShim.ts` 新增：

```typescript
case "/api/git/push":
  return invokeJson("git_push");
case "/api/git/pull":
  return invokeJson("git_pull");
case "/api/git/fetch":
  return invokeJson("git_fetch");
```

### 4.3 前端

#### state（App.tsx）
- 既有 `currentBranch` 旁，新增同步狀態：
  ```typescript
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [aheadBehind, setAheadBehind] = useState<{ hasUpstream: boolean; ahead: number; behind: number }>({ hasUpstream: false, ahead: 0, behind: 0 });
  ```
- 在 `refreshState` 解析 `git_status` 回應時，設定 `aheadBehind`（從 `statusData.hasUpstream / ahead / behind`）。

#### handlers
```typescript
const runSync = async (path: string, okToast: string, failFallback: string) => {
  setIsSyncing(true);
  try {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || failFallback);
    showToast(okToast);
    refreshState();
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : failFallback, true);
  } finally {
    setIsSyncing(false);
  }
};

const handlePull = () => runSync("/api/git/pull", t.toastPullDone, "Pull failed");
const handlePush = () => runSync("/api/git/push", t.toastPushDone, "Push failed");
const handleFetch = () => runSync("/api/git/fetch", t.toastFetchDone, "Fetch failed");
```

#### 工具列按鈕（workspace nav）
在 `#workspace-nav`（refresh 按鈕附近）加入三顆按鈕（圖示用 lucide `ArrowDownToLine`/`ArrowUpFromLine`/`RefreshCw` 或 `Download`/`Upload`/`RefreshCw`），執行中 `disabled={isSyncing}` + spinner。

#### ahead/behind 指示
在目前分支名（`{currentBranch}` span）旁，當 `aheadBehind.hasUpstream` 時顯示：
```typescript
{aheadBehind.hasUpstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
  <span className="flex items-center gap-1 text-[12px] font-mono text-slate-400" title={t.aheadBehindTip}>
    {aheadBehind.ahead > 0 && <span className="text-emerald-400">↑{aheadBehind.ahead}</span>}
    {aheadBehind.behind > 0 && <span className="text-amber-400">↓{aheadBehind.behind}</span>}
  </span>
)}
```

#### i18n（中英）
| key | en | zh |
|---|---|---|
| `pull` | "Pull" | "Pull" |
| `push` | "Push" | "Push" |
| `fetch` | "Fetch" | "Fetch" |
| `aheadBehindTip` | "Commits ahead / behind the remote" | "領先 / 落後遠端的 commit 數" |
| `toastPullDone` | "Pulled latest changes from remote." | "已從遠端拉取最新變更。" |
| `toastPushDone` | "Pushed to remote." | "已推送到遠端。" |
| `toastFetchDone` | "Fetched remote updates." | "已抓取遠端更新。" |

（按鈕 tooltip 用 `t.pull` / `t.push` / `t.fetch`。）

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust | `src-tauri/src/lib.rs` | 新增 `run_git_network` helper、`git_push`/`git_pull`/`git_fetch`；`GitStatusResponse` 加 3 欄位 + `git_status` 計算 ahead/behind；註冊 invoke_handler |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 3 條路由 |
| 前端 | `src/App.tsx` | `isSyncing` / `aheadBehind` state、3 handler、工具列按鈕、ahead/behind 指示、i18n |
| 型別 | `src/types.ts` | 若有 GitStatus 型別定義，補 ahead/behind/hasUpstream（執行時確認，無則略過） |

---

## 6. 錯誤處理

- 認證失敗 / 無權限：`GIT_TERMINAL_PROMPT=0` 讓 git 快速失敗，stderr 經 toast 顯示（不 hang）。
- Pull 衝突：git 回 stderr → 紅 toast；使用者自行於工作區解決。
- detached HEAD push：回明確錯誤訊息。
- 無 upstream pull：git 報錯 → toast。
- 所有操作完成後 `refreshState()` 重算 ahead/behind 與檔案狀態。

---

## 7. 測試與驗收（手動）

| 場景 | 預期 |
|---|---|
| 有未推 commit | 分支名旁顯示 `↑n`；按 Push → 成功 toast、↑ 歸零 |
| 遠端有新 commit（先在他處 push） | Fetch 後顯示 `↓n`；按 Pull → 合併、↓ 歸零 |
| 新分支首次 Push（無 upstream） | 自動 `push -u origin <branch>`，成功；之後顯示 upstream 狀態 |
| Pull 造成衝突 | 紅 toast 顯示 git 衝突訊息 |
| 認證未設定 / 錯誤 | 快速失敗（不 hang），紅 toast 顯示 git 錯誤 |
| 同步進行中 | 三顆按鈕 disable + spinner |
| 無 upstream 分支 | 不顯示 ahead/behind 數字 |
| 操作完成 | ahead/behind 與檔案狀態自動刷新 |

---

## 8. 待釐清項目

- 多 remote 情境一律對預設 upstream / `origin`；本次不做 remote 選擇。
- `git pull` 用 rebase 或 merge 由使用者 git 設定（`pull.rebase`）決定，不在 UI 提供切換。
- 網路操作無逾時設定（git 子行程自行處理）；`GIT_TERMINAL_PROMPT=0` 已避免最常見的「等帳密輸入」hang。若實測仍遇長時間 hang，再評估加逾時。
