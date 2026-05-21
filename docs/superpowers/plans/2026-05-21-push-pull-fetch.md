# Push / Pull / Fetch 與 ahead-behind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 workspace nav 工具列加入 Pull / Push / Fetch 三顆按鈕（作用於目前分支），並在分支名旁顯示相對 upstream 的 ahead/behind。

**Architecture:** 後端新增一個設定 `GIT_TERMINAL_PROMPT=0` 的網路執行 helper + 三個薄 git wrapper command，並擴充 `git_status` 用 `git rev-list --count --left-right @{u}...HEAD` 回傳 ahead/behind/hasUpstream。前端在工具列加按鈕、顯示 ahead/behind、用一個共用的 `runSync` 包裝呼叫；認證倚賴系統 git。

**Tech Stack:** Rust (Tauri 2), TypeScript/React, Tailwind, lucide-react。

**前置：** 建立在 `feat/commit-context-menu` 分支之上（在該分支執行）。

**驗收紀律：** 薄 git wrapper 無單元測試，靠 `cargo build` + 手動驗收（Task 6）；前端走 `npx tsc --noEmit` + 手動驗收。所有網路操作須實際對遠端測過才算完成。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/src/lib.rs` | `run_git_network` helper、`git_push`/`git_pull`/`git_fetch`、`git_status` 加 ahead/behind | Modify |
| `src/tauriFetchShim.ts` | 3 條路由 | Modify |
| `src/App.tsx` | state、3 handler、工具列按鈕、ahead/behind 指示、i18n、refreshState 解析 | Modify |

**型別契約：**
- `git_status` 回傳 JSON 多三個欄位：`hasUpstream: boolean`、`ahead: number`、`behind: number`。
- API：`POST /api/git/push`、`/api/git/pull`、`/api/git/fetch`（皆無 body）。

---

## Task 1: 後端 — git_status 加 ahead/behind/hasUpstream

**Files:**
- Modify: `src-tauri/src/lib.rs`（`GitStatusResponse` struct + `git_status` 三個回傳點 + 計算）

- [ ] **Step 1: 擴充 GitStatusResponse struct**

找到 `struct GitStatusResponse { ... }`，在 `files` 欄位後加入三個欄位：

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

- [ ] **Step 2: 補兩個 early-return 分支的新欄位**

`git_status` 開頭有兩個 `return Ok(GitStatusResponse { ... })`（一個是無 repo path、一個是非 git repo），兩個都缺新欄位。各自在 `files: vec![],` 後補上：

```rust
                files: vec![],
                has_upstream: false,
                ahead: 0,
                behind: 0,
```

（兩處都要補；它們是 `initialized: false` 的分支。）

- [ ] **Step 3: 計算 ahead/behind 並填入主回傳**

在 `git_status` 主回傳（`Ok(GitStatusResponse { initialized: true, ... })`）之前，加入計算：

```rust
    let (has_upstream, ahead, behind) = {
        let rl = run_git(&state, &["rev-list", "--count", "--left-right", "@{u}...HEAD"])?;
        if rl.code == 0 {
            let mut parts = rl.stdout.split_whitespace();
            let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            (true, ahead, behind)
        } else {
            (false, 0u32, 0u32)
        }
    };
```

並把主回傳改為：

```rust
    Ok(GitStatusResponse {
        initialized: true,
        current_branch,
        workspace_path: Some(repo_path.to_string_lossy().to_string()),
        files,
        has_upstream,
        ahead,
        behind,
    })
```

> `git rev-list --count --left-right @{u}...HEAD` 輸出 `"<behind>\t<ahead>"`：左邊（`@{u}` 多出的）= behind，右邊（HEAD 多出的）= ahead。無 upstream 時 exit code != 0 → `has_upstream=false`。

- [ ] **Step 4: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功。`cargo test ref_tests` 仍 3 pass。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: report ahead/behind/hasUpstream in git_status"
```

---

## Task 2: 後端 — push / pull / fetch commands

**Files:**
- Modify: `src-tauri/src/lib.rs`（helper + 3 command + 註冊）

- [ ] **Step 1: 新增 run_git_network helper**

在既有的 `run_git` 函式之後加入（設 `GIT_TERMINAL_PROMPT=0`，無 tty 認證時快速失敗而非 hang）：

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
    let command = format!(
        "git {}",
        args.iter().map(|arg| quote_arg(arg)).collect::<Vec<_>>().join(" ")
    );
    log_command(state, command, code, stdout.clone(), stderr.clone());
    Ok(CommandResult { stdout, stderr, code })
}
```

- [ ] **Step 2: 新增三個 command**

在 `run_git_network` 之後（或任一 command 區域）加入：

```rust
#[tauri::command]
async fn git_push(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let branch = run_git(&state, &["branch", "--show-current"])?.stdout;
    if branch.is_empty() {
        return Err("Not on a branch (detached HEAD); cannot push.".to_string());
    }
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

- [ ] **Step 3: 註冊 invoke_handler**

在 `tauri::generate_handler![...]` 清單中（例如 `git_branch_rename,` 之後）加入：

```rust
            git_push,
            git_pull,
            git_fetch,
```

- [ ] **Step 4: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功。dead_code 警告不應出現（generate_handler! 引用）。`cargo test ref_tests` 仍 3 pass。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add push/pull/fetch commands with no-prompt network helper"
```

---

## Task 3: Tauri shim — 3 條路由

**Files:**
- Modify: `src/tauriFetchShim.ts`

- [ ] **Step 1: 加入路由**

在 `src/tauriFetchShim.ts` 的 switch 中，於 `case "/api/git/revert":` 那組附近（任一既有 git 路由之後、`default:` 之前）加入：

```typescript
      case "/api/git/push":
        return invokeJson("git_push");
      case "/api/git/pull":
        return invokeJson("git_pull");
      case "/api/git/fetch":
        return invokeJson("git_fetch");
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/tauriFetchShim.ts
git commit -m "feat: add push/pull/fetch routes to fetch shim"
```

---

## Task 4: App.tsx — state、handlers、i18n、status 解析

**Files:**
- Modify: `src/App.tsx`

**Read `src/App.tsx` first** to locate `currentBranch` state, the `refreshState` function (where `statusData.currentBranch` is read), the `translations` en/zh blocks, and the `showToast`/`refreshState` helpers.

- [ ] **Step 1: 新增 state**

在 `currentBranch` state 宣告附近加入：

```typescript
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [aheadBehind, setAheadBehind] = useState<{ hasUpstream: boolean; ahead: number; behind: number }>({ hasUpstream: false, ahead: 0, behind: 0 });
```

- [ ] **Step 2: 在 refreshState 解析 ahead/behind**

在 `refreshState` 裡，找到設定 `setCurrentBranch(statusData.currentBranch)` 的地方，緊接著加入：

```typescript
        setAheadBehind({
          hasUpstream: !!statusData.hasUpstream,
          ahead: statusData.ahead ?? 0,
          behind: statusData.behind ?? 0,
        });
```

- [ ] **Step 3: 加入 i18n keys（en 與 zh 兩區塊，鍵集相同）**

en 區塊加入：

```typescript
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    aheadBehindTip: "Commits ahead / behind the remote",
    toastPullDone: "Pulled latest changes from remote.",
    toastPushDone: "Pushed to remote.",
    toastFetchDone: "Fetched remote updates.",
```

zh 區塊加入：

```typescript
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    aheadBehindTip: "領先 / 落後遠端的 commit 數",
    toastPullDone: "已從遠端拉取最新變更。",
    toastPushDone: "已推送到遠端。",
    toastFetchDone: "已抓取遠端更新。",
```

> 注意：若 `pull`/`push`/`fetch` 這些 key 已存在於 translations（可能與其他用途衝突），執行時先 grep 確認；若已存在且值相同則略過該行，若不存在才加。其餘 key（aheadBehindTip / toast*）為新。

- [ ] **Step 4: 新增 handlers**

在其他 handler 附近加入：

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

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。handlers 暫時未被引用（Task 5 接上），tsconfig 未開 noUnusedLocals 不會報錯。en/zh 鍵集需一致。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add sync state, push/pull/fetch handlers and i18n"
```

---

## Task 5: App.tsx — 工具列按鈕與 ahead/behind 指示

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 確認 icon import**

在 `src/App.tsx` 的 lucide-react import 中，確保有 `Download`、`Upload`、`RefreshCw`（`RefreshCw` 已有）。若 `Download` / `Upload` 未匯入則加入。

- [ ] **Step 2: 在 ahead/behind 指示加到分支名旁**

在 workspace nav（`id="workspace-nav"`）裡，找到顯示 `{currentBranch}` 的 `<span>`。緊接其後加入 ahead/behind 指示：

```typescript
            {aheadBehind.hasUpstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
              <span className="flex items-center gap-1 text-[12px] font-mono shrink-0" title={t.aheadBehindTip}>
                {aheadBehind.ahead > 0 && <span className="text-emerald-400">↑{aheadBehind.ahead}</span>}
                {aheadBehind.behind > 0 && <span className="text-amber-400">↓{aheadBehind.behind}</span>}
              </span>
            )}
```

- [ ] **Step 3: 加入三顆同步按鈕**

在 workspace nav 的 refresh 按鈕（`<RefreshCw .../>` 那顆）附近，加入 Pull / Push / Fetch 三顆按鈕：

```typescript
            <button
              onClick={handlePull}
              disabled={isSyncing}
              title={t.pull}
              className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
            >
              {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{t.pull}</span>
            </button>
            <button
              onClick={handlePush}
              disabled={isSyncing}
              title={t.push}
              className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
            >
              {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              <span>{t.push}</span>
            </button>
            <button
              onClick={handleFetch}
              disabled={isSyncing}
              title={t.fetch}
              className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{t.fetch}</span>
            </button>
```

> 放置位置：與既有 refresh 按鈕同一區塊（workspace nav 右側按鈕群）。依實際 JSX 結構對齊縮排。

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add pull/push/fetch toolbar buttons and ahead/behind indicator"
```

---

## Task 6: 手動測試（驗收 gate）

**Files:** 無程式改動。

> 需 `npm run tauri dev`（**重啟**載入 Rust 改動）+ 一個有遠端（origin）的 repo。

- [ ] **Step 1: ahead 指示 + Push**

操作：本地多做一個 commit（未推）。
Expected：分支名旁顯示 `↑1`（綠）；按 Push → 成功 toast、refresh 後 `↑` 消失。

- [ ] **Step 2: behind 指示 + Pull**

操作：在別處（或 GitHub）推一個 commit 到同分支 → 在 app 按 Fetch。
Expected：顯示 `↓1`（琥珀）；按 Pull → 合併成功、refresh 後 `↓` 消失。

- [ ] **Step 3: 新分支首次 Push**

操作：建一個無 upstream 的新分支、做一個 commit、按 Push。
Expected：自動 `push -u origin <branch>` 成功；之後 ahead/behind 正常顯示。

- [ ] **Step 4: Pull 衝突**

操作：本地與遠端改同一處後 Pull。
Expected：紅 toast 顯示 git 衝突訊息（不 hang）。

- [ ] **Step 5: 認證失敗 / 無權限**

操作：對一個沒有推送權限的 remote 按 Push（或斷網）。
Expected：**快速失敗**（不卡住等帳密），紅 toast 顯示 git 錯誤。

- [ ] **Step 6: 同步中狀態**

操作：按任一同步按鈕的當下。
Expected：三顆按鈕 disable，Pull/Push 顯示 spinner。

- [ ] **Step 7: 無 upstream 分支**

操作：切到一個從未推過、無 upstream 的分支。
Expected：不顯示 ahead/behind 數字。

- [ ] **Step 8: 全部通過後勾完本任務**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 git_status 加 ahead/behind/hasUpstream | Task 1 |
| §4.1 run_git_network + push/pull/fetch | Task 2 |
| §4.2 shim 3 路由 | Task 3 |
| §4.3 state + handlers + i18n + status 解析 | Task 4 |
| §4.3 工具列按鈕 + ahead/behind 指示 | Task 5 |
| §7 測試矩陣 | Task 6 |

**型別一致性：** `git_status` 回傳 `hasUpstream`/`ahead`/`behind` ↔ 前端 `aheadBehind` state 與解析一致；3 路由 ↔ 3 command 名稱一致；`runSync` 簽章在 Task 4 定義、Task 5 透過 handlePull/Push/Fetch 使用。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。

**已知相依：** Task 4 的 handler 在 Task 5 由按鈕引用；中間狀態 tsconfig 不報未使用。`pull`/`push`/`fetch` i18n key 若與既有衝突，Task 4 Step 3 已註明執行時 grep 確認。
