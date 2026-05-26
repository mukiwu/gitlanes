# Branch / Tag 側邊欄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分支與 tag 清單搬到 dashboard 左欄，採「單擊預覽、double-click / right-click 才 checkout」的互動，header 改放「+ New Branch」按鈕。

**Architecture:** 後端把 `git_branches` 改成包含 local + remote 的統一資料結構（新 struct `BranchRef`，避開既有 `GitRef` 命名衝突），新增 `git_tags` 與 `git_branch_checkout_remote`，`git_log` 加 `branch: Option<String>` 參數。前端新建 `RefSidebar.tsx` 純展示元件、重用既有 `CommitContextMenu` 與 `CommitInputModal`，新增 preview state 與 GitGraph 的 `scrollToCommit` ref 方法。

**Tech Stack:** Rust (Tauri 2)、TypeScript/React、Tailwind、lucide-react。

**驗收紀律：** 後端薄 git wrapper 走 `cargo check`（在 `src-tauri/` 內執行）+ 手動驗收；前端走 `npx tsc --noEmit` + 手動驗收。所有 git 寫入操作（checkout / branch create / tag delete）須實際在 repo 跑過才算完成。最後一個 task 是手動測試矩陣，跑完才能宣告整份計畫完成。

**Spec：** `docs/superpowers/specs/2026-05-26-branch-tag-sidebar-design.md`

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/src/lib.rs` | 新增 `BranchRef` struct、改寫 `git_branches`、新增 `git_tags` / `git_branch_checkout_remote`、`git_log` 加 `branch` 參數 | Modify |
| `src/tauriFetchShim.ts` | 新增 `/api/git/tags`、`/api/git/branch/checkout-remote`；`/api/git/log` 帶 `branch` query | Modify |
| `src/types.ts` | 移除 `Branch`、新增 `BranchRef` 與 `GitTag` | Modify |
| `src/components/RefSidebar.tsx` | BRANCHES + TAGS 兩個可摺疊區塊（純展示，邏輯由 App.tsx 傳入） | Create |
| `src/components/GitGraph.tsx` | `forwardRef` + 暴露 `scrollToCommit(hash)`；頂部 preview bar | Modify |
| `src/App.tsx` | 新 state（previewedBranch / tags / showAllRemotes / branchesExpanded / tagsExpanded / newBranchModal / sidebarBranchMenu）、handlers、整合 RefSidebar、header 改造、log fetch 帶 branch、i18n | Modify |

**命名契約：**
- 後端 struct 用 `BranchRef`（避開既有 `GitRef`），欄位 `name`、`kind`（`"local"` / `"remote"`）、`is_current`（serde rename `isCurrent`）、`upstream: Option<String>`
- 前端 type 也叫 `BranchRef`，與後端同欄位但 camelCase
- Tag 後端不另建 struct，直接 `serde_json!` 組 `{ name, commit, date }`；前端 type 叫 `GitTag`
- 重用既有元件：`CommitContextMenu`（sidebar 右鍵選單）、`CommitInputModal`（Header 的 New Branch 按鈕）

---

## Task 1: 後端 — BranchRef struct + git_branches 改寫

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 新增 BranchRef struct**

在 `src-tauri/src/lib.rs` 找到既有 `struct Branch { ... }`（約 80 行附近），**移除**它、改成 `BranchRef`：

```rust
#[derive(Debug, Serialize)]
struct BranchRef {
    name: String,
    kind: String, // "local" | "remote"
    #[serde(rename = "isCurrent")]
    is_current: bool,
    upstream: Option<String>,
}
```

- [ ] **Step 2: 改寫 git_branches 跑 `git branch -a` + 取 upstream**

找到既有 `async fn git_branches(...)`（約 557 行），整段函式體換成：

```rust
#[tauri::command]
async fn git_branches(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "branches": Vec::<BranchRef>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "branches": Vec::<BranchRef>::new() }));
    }

    // 同時取 local + remote + upstream，用 NUL 分隔避免 quoting 問題
    let format = "%(refname:short)%00%(HEAD)%00%(upstream:short)";
    let res = run_git(&state, &[
        "for-each-ref",
        "--format",
        format,
        "refs/heads",
        "refs/remotes",
    ])?;
    if res.code != 0 {
        return Ok(json!({ "branches": [{ "name": "main", "kind": "local", "isCurrent": true, "upstream": null }] }));
    }

    let branches: Vec<BranchRef> = res
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{0}');
            let name = parts.next()?.trim().to_string();
            let head_marker = parts.next().unwrap_or("").trim();
            let upstream_raw = parts.next().unwrap_or("").trim();

            // 跳過 origin/HEAD 這種 symbolic ref
            if name.ends_with("/HEAD") {
                return None;
            }

            let kind = if name.contains('/') && !name.starts_with("heads/") {
                // refname:short 對 remote 會輸出 "origin/main"
                "remote"
            } else {
                "local"
            }.to_string();

            let is_current = head_marker == "*";
            let upstream = if upstream_raw.is_empty() { None } else { Some(upstream_raw.to_string()) };

            Some(BranchRef { name, kind, is_current, upstream })
        })
        .collect();

    Ok(json!({ "branches": branches }))
}
```

- [ ] **Step 3: cargo check 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes/src-tauri && cargo check
```

Expected: 編譯通過（可能會出現「`Branch` 未使用」或前端型別不一致的下游警告，那是 Task 6 才處理）。如果失敗，檢查 `BranchRef` 是否漏 derive `Serialize` 或 import。

- [ ] **Step 4: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src-tauri/src/lib.rs && git commit -m "$(cat <<'EOF'
feat(backend): git_branches 改帶 remote 與 upstream 資訊

新增 BranchRef struct 取代 Branch，包含 kind/isCurrent/upstream。
git_branches 改跑 for-each-ref refs/heads + refs/remotes，一次回傳 local + remote
與每個 local 的 upstream 對應。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 後端 — git_tags command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 新增 git_tags command**

在 Task 1 改寫的 `git_branches` 函式之後加入：

```rust
#[tauri::command]
async fn git_tags(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "tags": Vec::<serde_json::Value>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "tags": Vec::<serde_json::Value>::new() }));
    }

    // refname:short 對 tag 會輸出 "v1.0.0" 等
    // creatordate 對 lightweight tag 會 fallback 為 commit 的 author date
    let format = "%(refname:short)%00%(objectname)%00%(creatordate:iso8601)";
    let res = run_git(&state, &[
        "for-each-ref",
        "--sort=-creatordate",
        "--format",
        format,
        "refs/tags",
    ])?;
    if res.code != 0 {
        return Ok(json!({ "tags": Vec::<serde_json::Value>::new() }));
    }

    let tags: Vec<serde_json::Value> = res
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{0}');
            let name = parts.next()?.trim().to_string();
            let commit = parts.next().unwrap_or("").trim().to_string();
            let date = parts.next().unwrap_or("").trim().to_string();
            if name.is_empty() { return None; }
            Some(json!({ "name": name, "commit": commit, "date": date }))
        })
        .collect();

    Ok(json!({ "tags": tags }))
}
```

- [ ] **Step 2: cargo check**

```bash
cd /Users/muki/Documents/01.project/gitlanes/src-tauri && cargo check
```

Expected: 編譯通過。

- [ ] **Step 3: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src-tauri/src/lib.rs && git commit -m "$(cat <<'EOF'
feat(backend): 新增 git_tags command

跑 for-each-ref refs/tags 按建立時間倒序、輸出 {name, commit, date}。
給前端 sidebar TAGS 區塊用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 後端 — git_branch_checkout_remote command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 新增 command**

在 `git_branch_checkout` 函式之後加入：

```rust
#[tauri::command]
async fn git_branch_checkout_remote(
    state: State<'_, AppState>,
    remote_branch: String,
) -> Result<serde_json::Value, String> {
    let remote_branch = remote_branch.trim();
    if remote_branch.is_empty() {
        return Err("Remote branch name is required".to_string());
    }
    // 從 "origin/feature-x" 抽出 "feature-x" 當 local branch 名
    let local_name = remote_branch
        .splitn(2, '/')
        .nth(1)
        .unwrap_or(remote_branch)
        .to_string();
    if local_name.is_empty() {
        return Err("Unable to derive local branch name".to_string());
    }

    // 先檢查 local 是否已存在同名 branch
    let exists = run_git(&state, &["rev-parse", "--verify", &format!("refs/heads/{local_name}")])?;
    let result = if exists.code == 0 {
        // 已存在 → 直接 checkout
        git_error(run_git(&state, &["checkout", &local_name])?, "Checkout error")?
    } else {
        // 不存在 → 建追蹤分支並 checkout
        git_error(
            run_git(&state, &["checkout", "-b", &local_name, "--track", remote_branch])?,
            "Checkout error",
        )?
    };

    let message = if result.stdout.is_empty() {
        format!("Switched to branch {local_name}")
    } else {
        result.stdout
    };
    Ok(json!({ "success": true, "message": message }))
}
```

- [ ] **Step 2: cargo check**

```bash
cd /Users/muki/Documents/01.project/gitlanes/src-tauri && cargo check
```

Expected: 編譯通過。

- [ ] **Step 3: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src-tauri/src/lib.rs && git commit -m "$(cat <<'EOF'
feat(backend): 新增 git_branch_checkout_remote command

接 "origin/feature-x"，已有同名 local 就直接 checkout，否則
跑 `git checkout -b feature-x --track origin/feature-x` 建追蹤分支。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 後端 — git_log 加 branch 參數

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 修改 git_log 簽名與參數處理**

找到既有 `async fn git_log(...)`（約 490 行），把簽名與 args 組裝改成：

```rust
#[tauri::command]
async fn git_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
    skip: Option<usize>,
    all_branches: Option<bool>,
    branch: Option<String>,
) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "commits": Vec::<CommitNode>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "commits": Vec::<CommitNode>::new() }));
    }
    let limit = limit.unwrap_or(300).clamp(1, 2000);
    let skip = skip.unwrap_or(0);
    let max_count = format!("--max-count={}", limit + 1);
    let skip_arg = format!("--skip={skip}");

    let branch_name = branch.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());

    let mut args: Vec<&str> = vec![
        "log",
        "--topo-order",
        "--decorate=full",
        "--pretty=format:%h|%p|%an|%ad|%d|%s",
        "--date=format-local:%Y-%m-%d %H:%M",
        max_count.as_str(),
        skip_arg.as_str(),
    ];

    if let Some(name) = branch_name {
        // 指定分支：limit log 到該分支可達範圍
        args.push(name);
    } else if all_branches.unwrap_or(true) {
        args.insert(1, "--all");
    }

    let log_res = run_git(&state, &args)?;
    if log_res.code != 0 {
        return Ok(json!({ "commits": Vec::<CommitNode>::new() }));
    }
    // ... 後續的 commits 解析保持不變
```

（後半段 `commits` 解析邏輯不動，從 `let mut commits = log_res...` 那行起原樣保留。）

- [ ] **Step 2: cargo check**

```bash
cd /Users/muki/Documents/01.project/gitlanes/src-tauri && cargo check
```

Expected: 編譯通過。

- [ ] **Step 3: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src-tauri/src/lib.rs && git commit -m "$(cat <<'EOF'
feat(backend): git_log 加 branch 參數

新增 branch: Option<String> 參數。有值時 limit log 到該分支可達範圍，
否則沿用既有 all_branches 行為。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 後端 — 註冊 invoke_handler + 完整 build

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 註冊新 commands**

找到 `tauri::generate_handler![...]` 巨集（約 lib.rs 末段、`pub fn run()` 內），把 `git_tags` 與 `git_branch_checkout_remote` 加進去：

```rust
        .invoke_handler(tauri::generate_handler![
            // ... 既有 commands ...
            git_branches,
            git_tags,                       // 新
            git_branch_create,
            git_branch_checkout,
            git_branch_checkout_remote,     // 新
            git_branch_merge,
            // ... 其餘既有 commands ...
```

精確位置：`git_tags` 放在 `git_branches` 後面、`git_branch_checkout_remote` 放在 `git_branch_checkout` 後面。

- [ ] **Step 2: cargo build 完整編譯**

```bash
cd /Users/muki/Documents/01.project/gitlanes/src-tauri && cargo build
```

Expected: 編譯成功（一個完整 build cycle，不只 check）。

- [ ] **Step 3: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src-tauri/src/lib.rs && git commit -m "$(cat <<'EOF'
feat(backend): 註冊 git_tags / git_branch_checkout_remote 到 invoke_handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 前端型別 + Tauri shim 路由

**Files:**
- Modify: `src/types.ts`
- Modify: `src/tauriFetchShim.ts`
- Modify: `src/App.tsx`（型別 import 與 state 同步換名）

- [ ] **Step 1: 更新 types.ts**

整個 `src/types.ts` 改成：

```typescript
export interface GitFile {
  path: string;
  status: string;
  x: string;
  y: string;
  staged: boolean;
  modified: boolean;
  displayStatus: string;
}

export interface CommitNode {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  refs: { name: string; kind: string }[];
}

export interface BranchRef {
  name: string;
  kind: "local" | "remote";
  isCurrent: boolean;
  upstream?: string;
}

export interface GitTag {
  name: string;
  commit: string;
  date: string;
}

export interface StashItem {
  line: string;
}
```

（保留既有未列出的型別；若上面缺漏哪個既有 export 請參照原檔補上。重點是 **移除** `Branch`、**新增** `BranchRef` 與 `GitTag`。）

- [ ] **Step 2: 更新 tauriFetchShim.ts**

打開 `src/tauriFetchShim.ts`，找到既有 `/api/git/log` 的 case 區塊：

```typescript
      case "/api/git/log":
        return invokeJson("git_log", {
          limit: Number(query.get("limit") || 300),
          skip: Number(query.get("skip") || 0),
          allBranches: query.get("allBranches") !== "false",
        });
```

把它替換成：

```typescript
      case "/api/git/log":
        return invokeJson("git_log", {
          limit: Number(query.get("limit") || 300),
          skip: Number(query.get("skip") || 0),
          allBranches: query.get("allBranches") !== "false",
          branch: query.get("branch") || undefined,
        });
```

然後在 `/api/git/branches` case 後面加入：

```typescript
      case "/api/git/tags":
        return invokeJson("git_tags");
```

並在 `/api/git/branch/checkout` case 後面加入：

```typescript
      case "/api/git/branch/checkout-remote":
        return invokeJson("git_branch_checkout_remote", { remoteBranch: body.remoteBranch });
```

- [ ] **Step 3: 在 App.tsx 更新 import 與 state 型別**

打開 `src/App.tsx`，找到：

```typescript
import { GitFile, CommitNode, Branch, StashItem } from "./types";
```

換成：

```typescript
import { GitFile, CommitNode, BranchRef, GitTag, StashItem } from "./types";
```

接著找到：

```typescript
const [branches, setBranches] = useState<Branch[]>([]);
```

換成：

```typescript
const [branches, setBranches] = useState<BranchRef[]>([]);
```

其他用到 `Branch` 型別宣告的地方一併改為 `BranchRef`（用編輯器全文搜尋 `Branch[]` 或 `: Branch` 確認）。

- [ ] **Step 4: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。若報 `BranchRef` 缺欄位（例如某處用了 `b.kind` 但 spec 還沒到那段），等到後續 task 加上。如果報的是 import 找不到、欄位拼錯，現在就修。

- [ ] **Step 5: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/types.ts src/tauriFetchShim.ts src/App.tsx && git commit -m "$(cat <<'EOF'
feat(frontend): 型別換成 BranchRef + 新增 GitTag、shim 加 tags/checkout-remote 路由

types.ts 移除 Branch、新增 BranchRef (含 kind/upstream) 與 GitTag。
tauriFetchShim 新增 /api/git/tags、/api/git/branch/checkout-remote 路由，
/api/git/log 透傳 branch query 參數。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: i18n labels

**Files:**
- Modify: `src/App.tsx`（`translations.en` 與 `translations.zh` 物件）

- [ ] **Step 1: 找到既有 translations 物件位置**

```bash
grep -n "createBranch:\|menuCheckoutBranch:" /Users/muki/Documents/01.project/gitlanes/src/App.tsx | head -6
```

確認 `translations.en` 與 `translations.zh` 的大致行號位置。

- [ ] **Step 2: 在 translations.en 物件內加入新 keys**

在 `translations.en` 物件內（找個與 sidebar / branch 相關 keys 群組附近）加入：

```typescript
    sidebarBranches: "Branches",
    sidebarTags: "Tags",
    sidebarShowAllRemotes: "Show all remotes",
    sidebarHideMatchedRemotes: "Hide matched remotes",
    sidebarPreviewBranch: "Preview this branch",
    sidebarCheckoutAsLocal: "Checkout as local",
    previewingBar: (b: string) => `Previewing: ${b}`,
    clearPreview: "Clear",
    newBranchButton: "New Branch",
    newBranchModalTitle: "Create New Branch",
    newBranchNameLabel: "Branch name",
    newBranchNamePlaceholder: "feature/my-new-branch",
    newBranchConfirm: "Create & Checkout",
    toastBranchPreview: (b: string) => `Previewing branch: ${b}`,
    toastRemoteCheckedOut: (b: string) => `Tracking branch created and checked out: ${b}`,
```

- [ ] **Step 3: 在 translations.zh 物件內加入對應翻譯**

```typescript
    sidebarBranches: "分支",
    sidebarTags: "標籤",
    sidebarShowAllRemotes: "顯示全部遠端分支",
    sidebarHideMatchedRemotes: "隱藏已對應的遠端分支",
    sidebarPreviewBranch: "預覽這個分支",
    sidebarCheckoutAsLocal: "建立本地追蹤分支並切換",
    previewingBar: (b: string) => `預覽中：${b}`,
    clearPreview: "清除",
    newBranchButton: "新分支",
    newBranchModalTitle: "建立新分支",
    newBranchNameLabel: "分支名稱",
    newBranchNamePlaceholder: "feature/my-new-branch",
    newBranchConfirm: "建立並切換",
    toastBranchPreview: (b: string) => `預覽分支：${b}`,
    toastRemoteCheckedOut: (b: string) => `已建立追蹤分支並切換：${b}`,
```

- [ ] **Step 4: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。

- [ ] **Step 5: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/App.tsx && git commit -m "$(cat <<'EOF'
feat(i18n): 新增 sidebar branches/tags 相關中英雙語 label

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: RefSidebar.tsx 純展示元件

**Files:**
- Create: `src/components/RefSidebar.tsx`

- [ ] **Step 1: 建立 RefSidebar 元件**

新檔 `src/components/RefSidebar.tsx`：

```typescript
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Cloud, Eye, Tag as TagIcon } from "lucide-react";
import { BranchRef, GitTag } from "../types";

const KEY_BRANCHES_EXPANDED = "gitlanes.sidebar.branches.expanded";
const KEY_TAGS_EXPANDED = "gitlanes.sidebar.tags.expanded";
const KEY_SHOW_ALL_REMOTES = "gitlanes.sidebar.showAllRemotes";

const readBool = (key: string, fallback: boolean) => {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  if (raw === null) return fallback;
  return raw === "true";
};

const writeBool = (key: string, value: boolean) => {
  try { window.localStorage.setItem(key, String(value)); } catch {}
};

interface RefSidebarLabels {
  branches: string;
  tags: string;
  showAllRemotes: string;
  hideMatchedRemotes: string;
}

interface RefSidebarProps {
  branches: BranchRef[];
  tags: GitTag[];
  previewedBranch: string | null;
  labels: RefSidebarLabels;
  onPreviewBranch: (name: string) => void;
  onCheckoutBranch: (branch: BranchRef) => void;
  onBranchContextMenu: (branch: BranchRef, x: number, y: number) => void;
  onTagClick: (tag: GitTag) => void;
  onTagContextMenu: (tag: GitTag, x: number, y: number) => void;
}

export const RefSidebar: React.FC<RefSidebarProps> = ({
  branches,
  tags,
  previewedBranch,
  labels,
  onPreviewBranch,
  onCheckoutBranch,
  onBranchContextMenu,
  onTagClick,
  onTagContextMenu,
}) => {
  const [branchesExpanded, setBranchesExpanded] = useState<boolean>(() => readBool(KEY_BRANCHES_EXPANDED, true));
  const [tagsExpanded, setTagsExpanded] = useState<boolean>(() => readBool(KEY_TAGS_EXPANDED, true));
  const [showAllRemotes, setShowAllRemotes] = useState<boolean>(() => readBool(KEY_SHOW_ALL_REMOTES, false));

  useEffect(() => writeBool(KEY_BRANCHES_EXPANDED, branchesExpanded), [branchesExpanded]);
  useEffect(() => writeBool(KEY_TAGS_EXPANDED, tagsExpanded), [tagsExpanded]);
  useEffect(() => writeBool(KEY_SHOW_ALL_REMOTES, showAllRemotes), [showAllRemotes]);

  // 過濾：預設隱藏已有對應 local 的 remote
  const localUpstreams = new Set(
    branches.filter((b) => b.kind === "local" && b.upstream).map((b) => b.upstream!)
  );
  const visibleBranches = showAllRemotes
    ? branches
    : branches.filter((b) => b.kind === "local" || !localUpstreams.has(b.name));

  const localCount = visibleBranches.filter((b) => b.kind === "local").length;
  const remoteCount = visibleBranches.filter((b) => b.kind === "remote").length;

  return (
    <div className="space-y-3">
      {/* BRANCHES section */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={() => setBranchesExpanded((v) => !v)}
            className="flex items-center gap-1 text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500 hover:text-slate-300 cursor-pointer"
          >
            {branchesExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span>{labels.branches}</span>
            <span className="text-slate-600">({localCount}{remoteCount > 0 ? ` + ${remoteCount}` : ""})</span>
          </button>
          {branchesExpanded && (
            <button
              onClick={() => setShowAllRemotes((v) => !v)}
              title={showAllRemotes ? labels.hideMatchedRemotes : labels.showAllRemotes}
              className="text-[10px] font-mono text-slate-500 hover:text-cyan-400 cursor-pointer"
            >
              {showAllRemotes ? "−" : "+"}remote
            </button>
          )}
        </div>

        {branchesExpanded && (
          <ul className="space-y-0.5">
            {visibleBranches.map((branch) => {
              const isPreview = previewedBranch === branch.name;
              const isCurrent = branch.kind === "local" && branch.isCurrent;
              const rowBase = "flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[12px] cursor-pointer truncate transition-colors";
              const rowState = isPreview
                ? "text-cyan-300 bg-cyan-950/30"
                : isCurrent
                  ? "text-cyan-400 font-bold hover:bg-slate-900/80"
                  : branch.kind === "remote"
                    ? "text-slate-500 hover:bg-slate-900/80"
                    : "text-slate-300 hover:bg-slate-900/80";

              return (
                <li key={`${branch.kind}:${branch.name}`}>
                  <div
                    className={`${rowBase} ${rowState}`}
                    onClick={() => onPreviewBranch(branch.name)}
                    onDoubleClick={() => onCheckoutBranch(branch)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onBranchContextMenu(branch, e.clientX, e.clientY);
                    }}
                    title={branch.upstream ? `${branch.name} ← ${branch.upstream}` : branch.name}
                  >
                    {isPreview ? (
                      <Eye className="h-3 w-3 shrink-0" />
                    ) : branch.kind === "remote" ? (
                      <Cloud className="h-3 w-3 shrink-0" />
                    ) : isCurrent ? (
                      <span className="inline-block w-3 text-center shrink-0">●</span>
                    ) : (
                      <span className="inline-block w-3 text-center shrink-0">○</span>
                    )}
                    <span className="truncate">{branch.name}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* TAGS section */}
      <div>
        <button
          onClick={() => setTagsExpanded((v) => !v)}
          className="flex items-center gap-1 text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500 hover:text-slate-300 cursor-pointer mb-1.5"
        >
          {tagsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>{labels.tags}</span>
          <span className="text-slate-600">({tags.length})</span>
        </button>

        {tagsExpanded && (
          <ul className="space-y-0.5">
            {tags.map((tag) => (
              <li key={tag.name}>
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[12px] cursor-pointer truncate transition-colors text-amber-400 hover:bg-slate-900/80"
                  onClick={() => onTagClick(tag)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onTagContextMenu(tag, e.clientX, e.clientY);
                  }}
                  title={`${tag.name} → ${tag.commit.slice(0, 7)}`}
                >
                  <TagIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{tag.name}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。

- [ ] **Step 3: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/components/RefSidebar.tsx && git commit -m "$(cat <<'EOF'
feat(frontend): 新增 RefSidebar.tsx 純展示元件

兩個可摺疊區塊（Branches / Tags），收合狀態與「顯示全部 remote」開關存
localStorage。單擊預覽、double-click checkout、right-click 觸發外部 menu。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: GitGraph — forwardRef + scrollToCommit + preview bar

**Files:**
- Modify: `src/components/GitGraph.tsx`

- [ ] **Step 1: 加新 props 與 forwardRef 包裝**

打開 `src/components/GitGraph.tsx`，在檔案頂端的 imports 區塊確認有 `forwardRef` 與 `useImperativeHandle`，若沒有就加：

```typescript
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
```

接著在 `GitGraphProps` 介面內加兩個 props：

```typescript
interface GitGraphProps {
  // ... 既有 props ...
  previewedBranch?: string | null;
  onClearPreview?: () => void;
  previewingLabel?: (b: string) => string;
  clearPreviewLabel?: string;
}
```

新增 ref handle 型別（介面之上或之下擇一）：

```typescript
export interface GitGraphHandle {
  scrollToCommit: (hash: string) => void;
}
```

把元件外殼從 `export const GitGraph: React.FC<GitGraphProps> = (...) => { ... }` 改成 forwardRef 寫法：

```typescript
export const GitGraph = forwardRef<GitGraphHandle, GitGraphProps>(({
  commits,
  currentBranch,
  selectedCommit,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  hasMore = false,
  onLoadMore,
  labels,
  isMaximized = false,
  onToggleMaximize,
  maximizeTitle,
  previewedBranch,
  onClearPreview,
  previewingLabel,
  clearPreviewLabel,
}, ref) => {
  // ... 既有函式體 ...
});
GitGraph.displayName = "GitGraph";
```

- [ ] **Step 2: 在 GitGraph 內實作 scrollToCommit**

在 `commitLayouts` `useMemo` 之後（既有程式碼裡）、`return` 之前，加入：

```typescript
  useImperativeHandle(ref, () => ({
    scrollToCommit: (hash: string) => {
      const layout = commitLayouts[hash];
      const element = scrollRef.current;
      if (!layout || !element) return;
      const target = Math.max(0, layout.y - element.clientHeight / 2);
      element.scrollTo({ top: target, behavior: "smooth" });
    },
  }), [commitLayouts]);
```

- [ ] **Step 3: 在 GitGraph 頂部加 preview bar**

在 GitGraph 既有 `return` 的 JSX 裡，找到容器最外層 div（包 SVG + commit rows 的那個 wrapper），在它之前、標題列之後（具體位置：標題列那個 `<div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 ...">` 之後）插入：

```tsx
      {previewedBranch && previewingLabel && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-cyan-950/40 border-b border-cyan-900/60 text-cyan-300 text-[12px] font-mono">
          <span className="truncate">👁 {previewingLabel(previewedBranch)}</span>
          {onClearPreview && (
            <button
              onClick={onClearPreview}
              className="text-cyan-400 hover:text-cyan-200 cursor-pointer underline-offset-2 hover:underline"
            >
              {clearPreviewLabel ?? "Clear"}
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 4: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。若報 `forwardRef` 推導失敗，檢查泛型參數是否正確、import 是否齊全。

- [ ] **Step 5: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/components/GitGraph.tsx && git commit -m "$(cat <<'EOF'
feat(gitgraph): 暴露 scrollToCommit + 頂部 preview bar

forwardRef + useImperativeHandle 對外暴露 scrollToCommit(hash)，
給 sidebar tag 點擊跳轉用。previewedBranch 有值時顯示頂部 thin bar
與 Clear 按鈕。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: App.tsx — state、handlers、tags fetch、log fetch 帶 branch

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 加新 state（在既有 state 區塊內）**

找到 `const [branches, setBranches] = useState<BranchRef[]>([]);` 那行附近，在它後面加：

```typescript
  const [tags, setTags] = useState<GitTag[]>([]);
  const [previewedBranch, setPreviewedBranch] = useState<string | null>(null);
  const [isNewBranchModalOpen, setIsNewBranchModalOpen] = useState<boolean>(false);
  const [sidebarBranchMenu, setSidebarBranchMenu] = useState<{ branch: BranchRef; x: number; y: number } | null>(null);
  const [sidebarTagMenu, setSidebarTagMenu] = useState<{ tag: GitTag; x: number; y: number } | null>(null);
  const gitGraphRef = useRef<GitGraphHandle | null>(null);
```

並在頂部 import 區塊：

```typescript
import { GitGraph, GitGraphHandle } from "./components/GitGraph";
```

（既有 import 大概是 `import { GitGraph } from "./components/GitGraph";`，加上 `GitGraphHandle` 型別。）

也加上：

```typescript
import { RefSidebar } from "./components/RefSidebar";
```

- [ ] **Step 2: 在 refreshState 內加 fetchTags**

找到既有 `refreshState`（或同等的「重新抓 branches 的函式」）。在已抓 branches 的那塊之後，加：

```typescript
        // 同步抓 tags
        const tagsRes = await fetch("/api/git/tags");
        const tagsData = await tagsRes.json();
        setTags(tagsData.tags || []);
```

（如果 branches fetch 在初始化 `useEffect` 而非 `refreshState`，把這段加到同一處。）

- [ ] **Step 3: 修改 log fetch 帶 previewedBranch**

找到既有 log fetch（兩處：初始載入與 loadMore），把 url 從：

```typescript
const logRes = await fetch(`/api/git/log?limit=${COMMIT_PAGE_SIZE}&skip=0&allBranches=true`);
```

換成：

```typescript
const branchQuery = previewedBranch ? `&branch=${encodeURIComponent(previewedBranch)}` : "";
const logRes = await fetch(`/api/git/log?limit=${COMMIT_PAGE_SIZE}&skip=0&allBranches=true${branchQuery}`);
```

LoadMore 那個同樣處理（`skip=${commits.length}` 那個 url）。

注意：如果這幾個 fetch 是放在 `useCallback` 內、依賴 array 不含 `previewedBranch`，要把它加進依賴 array。

- [ ] **Step 4: 加 sidebar handlers**

在既有 handlers 區塊（例如 `handleCheckoutBranch` 附近）加入：

```typescript
  const handlePreviewBranch = (name: string) => {
    setPreviewedBranch(name);
    showToast(t.toastBranchPreview(name));
  };

  const handleClearPreview = () => {
    setPreviewedBranch(null);
  };

  const handleSidebarCheckoutBranch = async (branch: BranchRef) => {
    if (branch.kind === "remote") {
      try {
        const res = await fetch("/api/git/branch/checkout-remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remoteBranch: branch.name }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Checkout failed");
        const localName = branch.name.split("/").slice(1).join("/") || branch.name;
        showToast(t.toastRemoteCheckedOut(localName));
        setPreviewedBranch(null);
        refreshState();
      } catch (err: any) {
        showToast(err.message || "Checkout failed", true);
      }
    } else {
      if (branch.isCurrent) return;
      setPreviewedBranch(null);
      handleCheckoutBranch(branch.name); // 既有函式
    }
  };

  const handleTagClick = (tag: GitTag) => {
    // 找對應 commit；若不在目前 log 視窗內、且有 preview，清掉 preview 再 scroll
    const found = commits.find((c) => c.hash === tag.commit || tag.commit.startsWith(c.hash));
    if (!found && previewedBranch) {
      setPreviewedBranch(null);
      // refresh 後 commits 才會更新；scrollToCommit 留給下次 commits 變動後的 effect
      return;
    }
    if (found) {
      setSelectedCommit(found);
      setDiffTarget(null);
      gitGraphRef.current?.scrollToCommit(found.hash);
    }
  };

  const handleNewBranchSubmit = async (values: Record<string, string>) => {
    const name = (values.name ?? "").trim();
    if (!name) return;
    setIsNewBranchModalOpen(false);
    try {
      const createRes = await fetch("/api/git/branch/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || createData.error) throw new Error(createData.error || "Create failed");
      handleCheckoutBranch(name); // 既有函式：checkout + refresh
    } catch (err: any) {
      showToast(err.message || "Create branch failed", true);
    }
  };
```

- [ ] **Step 5: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。

- [ ] **Step 6: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/App.tsx && git commit -m "$(cat <<'EOF'
feat(app): 加 preview / sidebar handler、tags fetch、log fetch 帶 branch

新增 tags / previewedBranch / sidebarBranchMenu / sidebarTagMenu state、
gitGraphRef、handlePreviewBranch / handleSidebarCheckoutBranch / handleTagClick /
handleNewBranchSubmit handlers，log fetch 帶 branch 參數。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: App.tsx — 整合 RefSidebar 到左欄、Header 改造、Modal 整合

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 dashboard 左欄頂部塞 RefSidebar、移除原 Create Branch widget**

找到既有「Left column sidebar for local files index and staging list」這段（[App.tsx:2128](src/App.tsx#L2128) 附近）。

**移除**裡面的 `{/* 1. Branch Creator widget */}` 整個 `<div className="mb-5 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">...</div>` 區塊。

在原本 Branch Creator 的位置（區塊頂端）插入：

```tsx
          {/* 1. Branches + Tags sidebar */}
          <div className="mb-5">
            <RefSidebar
              branches={branches}
              tags={tags}
              previewedBranch={previewedBranch}
              labels={{
                branches: t.sidebarBranches,
                tags: t.sidebarTags,
                showAllRemotes: t.sidebarShowAllRemotes,
                hideMatchedRemotes: t.sidebarHideMatchedRemotes,
              }}
              onPreviewBranch={handlePreviewBranch}
              onCheckoutBranch={handleSidebarCheckoutBranch}
              onBranchContextMenu={(branch, x, y) => setSidebarBranchMenu({ branch, x, y })}
              onTagClick={handleTagClick}
              onTagContextMenu={(tag, x, y) => setSidebarTagMenu({ tag, x, y })}
            />
          </div>
```

- [ ] **Step 2: Header 移除 Checkout / Merge dropdowns、加「+ New Branch」按鈕**

找到既有 Header 區塊（[App.tsx:1955](src/App.tsx#L1955) 附近的 `<nav id="workspace-nav">`）。

**移除**「Checkout Selector」整個區塊（從 `{/* Checkout Selector */}` 註解到對應 `</div>` 結束）。

**移除**「Merge Trigger」整個區塊（`{branches.length > 1 && (<form onSubmit={handleMergeBranch}>...</form>)}`）。

在那個位置（Settings dropdown 之前）插入：

```tsx
          {/* New Branch button */}
          <button
            onClick={() => setIsNewBranchModalOpen(true)}
            title={t.newBranchModalTitle}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer text-[12px] font-mono shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.newBranchButton}</span>
          </button>
```

（確認 `Plus` 已在頂端從 `lucide-react` import；既有 Branch Creator 既然用過 `Plus`，應該已經 import 了，否則加上去。）

- [ ] **Step 3: GitGraph 元件接 ref + preview props**

找到既有 `<GitGraph ... />` 渲染（[App.tsx:2350](src/App.tsx#L2350) 附近），加上 ref 與 preview 相關 props：

```tsx
            <GitGraph
              ref={gitGraphRef}
              commits={commits}
              currentBranch={currentBranch}
              selectedCommit={selectedCommit}
              hasMore={hasMoreCommits}
              onLoadMore={handleLoadMoreCommits}
              labels={{
                title: t.graphTitle,
                emptyTitle: t.graphEmptyTitle,
                emptyHint: t.graphEmptyHint,
                loadMore: t.loadMoreCommits,
              }}
              isMaximized={isGraphMaximized}
              onToggleMaximize={() => setIsGraphMaximized((v) => !v)}
              maximizeTitle={isGraphMaximized ? t.restoreGraph : t.maximizeGraph}
              previewedBranch={previewedBranch}
              onClearPreview={() => setPreviewedBranch(null)}
              previewingLabel={t.previewingBar}
              clearPreviewLabel={t.clearPreview}
              onSelectCommit={(commit) => {
                setSelectedCommit(commit);
                setDiffTarget(null);
              }}
              onCommitContextMenu={(commit, x, y) => setContextMenu({ commit, x, y })}
              onRefContextMenu={(ref, x, y) => setRefMenu({ refName: ref.name, kind: ref.kind, x, y })}
            />
```

（把 4 個新 props 加進去：`ref`、`previewedBranch`、`onClearPreview`、`previewingLabel`、`clearPreviewLabel`。既有 props 保留。）

- [ ] **Step 4: 渲染 sidebar 右鍵 context menus 與 New Branch modal**

找到既有 `<CommitContextMenu ... />` 渲染區（[App.tsx:2613](src/App.tsx#L2613) 附近），在它之後加：

```tsx
        {sidebarBranchMenu && (
          <CommitContextMenu
            x={sidebarBranchMenu.x}
            y={sidebarBranchMenu.y}
            items={buildSidebarBranchMenuItems(sidebarBranchMenu.branch)}
            onClose={() => setSidebarBranchMenu(null)}
          />
        )}

        {sidebarTagMenu && (
          <CommitContextMenu
            x={sidebarTagMenu.x}
            y={sidebarTagMenu.y}
            items={[
              {
                key: "deltag",
                label: `${t.menuDeleteTag} ${sidebarTagMenu.tag.name}`,
                danger: true,
                onSelect: () => handleDeleteTag(sidebarTagMenu.tag.name),
              },
            ]}
            onClose={() => setSidebarTagMenu(null)}
          />
        )}
```

也加入 New Branch modal（找到既有 `<CommitInputModal ... />` 多個渲染處，在最後一個之後加）：

```tsx
        <CommitInputModal
          open={isNewBranchModalOpen}
          title={t.newBranchModalTitle}
          fields={[{ key: "name", label: t.newBranchNameLabel, placeholder: t.newBranchNamePlaceholder, required: true }]}
          confirmLabel={t.newBranchConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={handleNewBranchSubmit}
          onClose={() => setIsNewBranchModalOpen(false)}
        />
```

- [ ] **Step 5: 新增 buildSidebarBranchMenuItems 函式**

在既有 `buildRefMenuItems` 函式附近（[App.tsx:1907](src/App.tsx#L1907) 附近），加入：

```typescript
  const buildSidebarBranchMenuItems = (branch: BranchRef): CommitContextMenuItem[] => {
    if (branch.kind === "remote") {
      return [
        { key: "preview", label: t.sidebarPreviewBranch, onSelect: () => handlePreviewBranch(branch.name) },
        { key: "checkout-remote", label: t.sidebarCheckoutAsLocal, onSelect: () => handleSidebarCheckoutBranch(branch) },
      ];
    }
    if (branch.isCurrent) {
      return [
        { key: "preview", label: t.sidebarPreviewBranch, onSelect: () => handlePreviewBranch(branch.name) },
      ];
    }
    // Local non-current
    return [
      { key: "preview", label: t.sidebarPreviewBranch, onSelect: () => handlePreviewBranch(branch.name) },
      { key: "checkout", label: t.menuCheckoutBranch, onSelect: () => handleCheckoutBranch(branch.name) },
      { key: "merge", label: t.menuMergeBranch, dividerBefore: true, onSelect: () => handleMergeBranchFromMenu(branch.name) },
      { key: "delete", label: `${t.menuDeleteBranch} ${branch.name}`, dividerBefore: true, onSelect: () => handleDeleteBranch(branch.name, false) },
      { key: "force-delete", label: `${t.menuForceDeleteBranch} ${branch.name}`, danger: true, onSelect: () => handleDeleteBranch(branch.name, true) },
    ];
  };
```

（如果 `handleMergeBranchFromMenu` / `handleDeleteBranch` / `handleCheckoutBranch` 既有函式名不完全一致，依實際既有函式名調整。）

- [ ] **Step 6: tsc 驗證**

```bash
cd /Users/muki/Documents/01.project/gitlanes && npx tsc --noEmit
```

Expected: 沒有錯誤。

- [ ] **Step 7: Commit**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git add src/App.tsx && git commit -m "$(cat <<'EOF'
feat(app): 左欄塞 RefSidebar、Header 移除 checkout/merge dropdown 改放 + New Branch

左欄頂部換成 RefSidebar（Branches + Tags），Header 拿掉 checkout/merge select、
改加 + New Branch 按鈕觸發 modal。新增 buildSidebarBranchMenuItems 組 sidebar
右鍵選單、GitGraph 接 ref + preview 相關 props。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 手動測試矩陣

**Files:** （無檔案改動，純手動驗收）

**前置：** 啟動 dev：

```bash
cd /Users/muki/Documents/01.project/gitlanes && bun run tauri dev
```

確認 app 開起來、隨意 open 一個 repo（既有測試 repo 或新 clone 的 repo）。

- [ ] **Step 1: 基本顯示**
  - [ ] 開啟有 local + remote 的 repo
  - [ ] BRANCHES 區塊顯示 local 分支 + 沒有對應 local 的 remote
  - [ ] TAGS 區塊（若 repo 有 tag）按建立時間倒序顯示
  - [ ] 兩區塊的計數 `(N)` 正確

- [ ] **Step 2: Show all remotes 開關**
  - [ ] 點區塊標題右側 `+remote` 按鈕
  - [ ] 所有 remote 都列出（包含已被 local 對應的 origin/main 等）
  - [ ] 再點一次（變 `−remote`）恢復隱藏

- [ ] **Step 3: 收合狀態**
  - [ ] 收合 BRANCHES、收合 TAGS
  - [ ] 完全重啟 app（Cmd+Q 後重開）
  - [ ] 收合狀態應該被記住

- [ ] **Step 4: Branch 預覽（單擊）**
  - [ ] 單擊 local branch（非 current）
  - [ ] GitGraph 頂部出現 `👁 Previewing: feature/x [Clear]` bar
  - [ ] Commit log 內容限縮到該 branch 可達範圍
  - [ ] Working tree 沒變、HEAD 沒動（terminal 跑 `git branch` 驗證 current 沒變）
  - [ ] Sidebar 該 branch 高亮（cyan + 眼睛 icon）

- [ ] **Step 5: Clear preview**
  - [ ] 點 preview bar 上的 Clear
  - [ ] 回到 all branches 視圖
  - [ ] Sidebar 高亮消失

- [ ] **Step 6: Branch checkout（double-click）**
  - [ ] Double-click 另一個 local branch
  - [ ] HEAD 切換、current 標記移到新分支
  - [ ] Preview 自動清空
  - [ ] Terminal `git branch` 驗證

- [ ] **Step 7: Branch right-click（local 非 current）**
  - [ ] Right-click 顯示 menu：Preview / Checkout / Merge into current / Delete / Force delete
  - [ ] 點 Delete → confirm 後分支從清單消失

- [ ] **Step 8: Remote branch checkout**
  - [ ] 把 Show all remotes 開起來、找一個沒對應 local 的 remote（或先在 terminal `git branch -d` 砍掉某 local 讓 origin/x 出現）
  - [ ] Single-click → 預覽該 remote
  - [ ] Double-click → 建立追蹤分支、切換、toast 顯示 `已建立追蹤分支並切換: x`
  - [ ] `git branch -vv` 驗證 upstream 是 origin/x

- [ ] **Step 9: Tag 點擊**
  - [ ] 確認 repo 有 tag（沒有就 `git tag v0.0.1 HEAD`）
  - [ ] 單擊 sidebar 的 tag
  - [ ] GitGraph 自動 scroll 到對應 commit、commit 被選取（高亮）

- [ ] **Step 10: Tag 在 preview 範圍外**
  - [ ] 預覽某個 branch（讓 commit log 限縮）
  - [ ] 點一個不在該 branch 範圍內的 tag
  - [ ] Preview 應該自動清空、回到 all branches 視圖（commit 出現後才能 scroll；目前實作是先清 preview、不立即 scroll，使用者點第二次會 scroll 到位）

- [ ] **Step 11: Tag right-click → Delete**
  - [ ] Right-click tag → 顯示 Delete 選項
  - [ ] 點下去 confirm 後 tag 從清單消失
  - [ ] `git tag` 驗證

- [ ] **Step 12: Header「+ New Branch」按鈕**
  - [ ] 點 Header 右側「+ New Branch」按鈕
  - [ ] Modal 跳出
  - [ ] 輸入 `feature/test-new-branch`、送出
  - [ ] 新 branch 出現在 BRANCHES 區塊、current 標記在它身上
  - [ ] `git branch` 驗證

- [ ] **Step 13: Refresh 時機**
  - [ ] 在 preview 狀態下 commit（先 stage + commit）→ preview 自動清空、log 回到 all branches、新 commit 出現
  - [ ] 在 preview 狀態下 Pull / Push / Fetch → preview 狀態保留、branches/tags 刷新

- [ ] **Step 14: 全部步驟通過後 Commit 一個小 marker（無檔案改動，但留紀錄）**

```bash
cd /Users/muki/Documents/01.project/gitlanes && git commit --allow-empty -m "$(cat <<'EOF'
test: 手動驗收 Branch/Tag sidebar 完成

依照 plan Task 12 測試矩陣全部跑過。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完成宣告

12 個 task 全部勾選、`cargo build` + `npx tsc --noEmit` 都通過、手動測試矩陣每一項都跑過實際 repo 並驗證 git 狀態正確後，本計畫完成。

把所有 commit push 上去：

```bash
cd /Users/muki/Documents/01.project/gitlanes && git push origin main
```
