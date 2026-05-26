# Branch / Tag 側邊欄設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-26 |
| 範圍 | 把分支與 tag 清單搬到 dashboard 左欄、Header 改成放 New Branch 按鈕、加入「預覽 vs checkout 分離」互動 |
| 預估工時 | 1～1.5 個工作天 |

---

## 1. 背景與動機

目前 branch 操作分散在 header：

- Checkout dropdown（[src/App.tsx:2010](../../../src/App.tsx#L2010)）—— 只列本地分支、夾在 sync 按鈕之間不顯眼
- Merge dropdown（[src/App.tsx:2026](../../../src/App.tsx#L2026)）—— 同上
- Tag 完全沒有列表入口，只能透過 commit context menu 建立／刪除

後端 `git_branches`（[src-tauri/src/lib.rs:557](../../../src-tauri/src/lib.rs#L557)）只跑 `git branch`、不含 remote；沒有 `git_tags` API。

目標：在 dashboard 左欄加 **BRANCHES** + **TAGS** 兩個可摺疊區塊，採 SourceTree 風格的「**單擊預覽、明確動作才 checkout**」互動，把 working tree 切換從不小心點到的風險裡解放出來。

---

## 2. 目標

- Dashboard 左欄新增 BRANCHES 區塊：本地 + remote 混在一起、預設隱藏「已有對應 local 的 remote」、可 toggle 收合
- Dashboard 左欄新增 TAGS 區塊：按建立時間倒序、可 toggle 收合
- 兩區塊收合狀態存 localStorage、跨 session 記憶
- 單擊 branch = 預覽（filter commit log 到該分支可達範圍，不動 working tree）
- Double-click 或 right-click → Checkout 才真的切換
- 單擊 tag = 跳到對應 commit、自動 scroll
- Header 移除 checkout / merge dropdown、改放「+ New Branch」按鈕
- Branch / Tag 都支援 right-click context menu

---

## 3. 不做（YAGNI）

- 把 current branch merge another branch 的 picker UI（透過 right-click 別的 branch → Merge into current 就能做）
- Delete remote branch（對遠端有副作用、留給後續）
- Branch / Tag 拖曳排序（用 git 天然排序：本地按字母、remote 同字母、tag 按建立時間倒序）
- Sidebar 各 branch 個別顯示 ahead/behind（current branch 的 ahead/behind 已在 header 顯示）
- Branch / Tag search filter（v1 數量不多直接列出）
- Stash 區塊任何改動

---

## 4. 架構

### 4.1 後端改動

**`git_branches` 改寫**（[src-tauri/src/lib.rs:557](../../../src-tauri/src/lib.rs#L557)）

改跑 `git branch -a`，輸出統一資料結構：

```rust
pub struct GitRef {
    pub name: String,           // "main" / "origin/main"
    pub kind: String,           // "local" | "remote"
    pub is_current: bool,       // 只有 local 可能為 true
    pub upstream: Option<String>,  // local 對應的 upstream（用 `git for-each-ref --format='%(upstream:short)'` 取）
}
```

回傳 `{ branches: GitRef[] }`，前端一份清單包含 local 與 remote。

**新增 `git_tags`**

```rust
#[tauri::command]
async fn git_tags(state) -> Result<JsonValue, String>
// 跑 `git tag --sort=-creatordate --format='%(refname:short)|%(objectname)|%(creatordate:iso8601)'`
// 回傳 { tags: [{ name, commit, date }, ...] }，按建立時間倒序
```

**新增 `git_branch_checkout_remote`**

```rust
#[tauri::command]
async fn git_branch_checkout_remote(state, remoteBranch: String) -> Result<JsonValue, String>
// 接 "origin/feature-x"，跑 `git checkout -b feature-x --track origin/feature-x`
// 若 local "feature-x" 已存在 → 改跑 `git checkout feature-x` 避免錯誤
```

**`git_log` 新增 `branch` 參數**

現有簽名加一個 `branch: Option<String>`：

- 有值 → `git log <branch>`
- 沒值 + `all_branches = true` → `git log --all`（沿用現況）
- 沒值 + `all_branches = false` → `git log HEAD`

### 4.2 前端型別調整

`src/types.ts`：

```typescript
export interface GitRef {
  name: string;
  kind: "local" | "remote";
  isCurrent: boolean;
  upstream?: string;
}

export interface GitTag {
  name: string;
  commit: string;  // 完整 hash
  date: string;
}
```

移除舊的 `Branch` 介面、用到的地方一起改成 `GitRef`。

### 4.3 Tauri shim 新增路由

`src/tauriFetchShim.ts`：

```
GET  /api/git/tags                      → git_tags
POST /api/git/branch/checkout-remote    → git_branch_checkout_remote
GET  /api/git/log?branch=<name>         → git_log（既有路由加 branch 參數透傳）
```

### 4.4 前端元件

#### `src/components/RefSidebar.tsx`（新檔）

兩個可摺疊區塊整合在這個元件：

```typescript
interface RefSidebarProps {
  branches: GitRef[];
  tags: GitTag[];
  currentBranch: string;
  previewedBranch: string | null;
  onPreviewBranch: (name: string) => void;     // 單擊
  onCheckoutBranch: (name: string) => void;    // double-click / context menu
  onCheckoutRemote: (name: string) => void;    // 對應 git_branch_checkout_remote
  onBranchContextMenu: (branch: GitRef, x: number, y: number) => void;
  onTagClick: (tag: GitTag) => void;
  onTagContextMenu: (tag: GitTag, x: number, y: number) => void;
}
```

**收合狀態**：

```typescript
const KEY_BRANCHES_EXPANDED = "gitlanes.sidebar.branches.expanded";
const KEY_TAGS_EXPANDED = "gitlanes.sidebar.tags.expanded";
// 預設都展開
```

**Remote 濾鏡**：預設隱藏已經有對應 local 的 remote（例如有 local `main` 時就不另外列 `origin/main`），標題列加 toggle「Show all remotes」強制顯示。

#### `src/components/BranchContextMenu.tsx`（新檔）

沿用 `CommitContextMenu` 的 pattern。Menu 內容依 branch 類型動態組裝：

- **Local branch（非 current）**：Preview this branch / Checkout this branch / Merge into current branch / Delete branch / Force delete branch
- **Local branch（current）**：Preview only this branch
- **Remote branch**：Preview this branch / Checkout as local

#### Tag context menu

不另開元件，重用 `CommitContextMenu` 既有的 Delete tag 路徑（沿用 `git_tag_delete`）。

#### `src/components/CommitInputModal.tsx`（沿用既有）

Header 「+ New Branch」按鈕觸發。Modal 內容：

- Branch name input
- Base commit picker（預設 HEAD、可選擇從 selected commit 或 任一 ref 開始）
- 送出 → `git_branch_create` + 自動 checkout

### 4.5 視覺風格

| 元素 | 樣式 |
|---|---|
| BRANCHES / TAGS 標題 | `text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500` |
| 標題列 toggle 按鈕 | `ChevronRight` / `ChevronDown` 切換 |
| Local branch（current） | `●` + `text-cyan-400 font-bold` |
| Local branch（previewing） | `👁` + `text-cyan-300` + `bg-cyan-950/30` 底色 |
| Local branch（其他） | `○` + `text-slate-300` |
| Remote branch（previewing） | `👁` + `text-cyan-300` + 底色 |
| Remote branch（其他） | Lucide `Cloud` icon（h-3 w-3） + `text-slate-500` |
| Tag | Lucide `Tag` icon（h-3 w-3） + `text-amber-400` |
| Hover | `hover:bg-slate-900/80`（沿用既有 sidebar item hover） |

### 4.6 GitGraph preview bar

當 `previewedBranch` 有值時，GitGraph 頂部出現一條 thin bar：

```
┌────────────────────────────────────────────┐
│ 👁 Previewing: feature/x          [Clear]  │  bg-cyan-950/40, text-cyan-300
└────────────────────────────────────────────┘
```

點 `[Clear]` → `setPreviewedBranch(null)`，回到 all branches 視圖。

### 4.7 GitGraph scroll to commit（給 tag 點擊用）

對外暴露 `scrollToCommit(hash: string)` 方法（透過 `useImperativeHandle`）：

- 找到對應 commit 的 layout、計算 row top
- `scrollRef.current.scrollTo({ top, behavior: "smooth" })`
- 同時 `setSelectedCommit(commit)` 高亮

### 4.8 自動刷新時機

`branches` / `tags` 跟現有 `refreshState` 一起重新抓——以下動作後刷新：

- Checkout / create / delete branch
- Create / delete tag
- Pull / Push / Fetch（remote 可能變動）
- Commit（HEAD 移動，current 標記要更新）

---

## 5. 互動行為細表

### Branch 單擊（= 預覽）

| 目標 | 行為 |
|---|---|
| 點目前的 local branch（current） | 設 `previewedBranch = name`，filter log 到只有這條的歷史 |
| 點別的 local branch | 設 `previewedBranch = name`、log fetch 帶 branch、working tree 不動 |
| 點 remote branch（顯示中） | 同上，但 branch 是 `origin/x` 格式 |

### Branch double-click / context menu Checkout

| 目標 | 行為 |
|---|---|
| Local branch（非 current） | `git_branch_checkout`、刷新、`previewedBranch = null` |
| Remote branch | `git_branch_checkout_remote`、刷新、`previewedBranch = null` |

Working tree 髒污時 git 自己會擋，直接把 git 原始錯誤訊息 toast 出來。

### Tag 單擊

- 若 `previewedBranch` 有值且該 tag 對應的 commit 不在 preview 範圍內 → 先 `setPreviewedBranch(null)` 切回 all branches 視圖
- `setSelectedCommit(對應 commit node)` + `gitGraphRef.scrollToCommit(commit hash)`
- 不改 working tree

### Header「+ New Branch」按鈕

- 開 `CommitInputModal` 的 Create Branch 變體
- 預設 base = current HEAD
- 送出 → `git_branch_create` → `git_branch_checkout` 到新 branch
- 失敗 toast、成功 refresh

---

## 6. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust commands | `src-tauri/src/lib.rs` | 改寫 `git_branches` 帶 remote + upstream；新增 `git_tags`、`git_branch_checkout_remote`；`git_log` 新增 `branch` 參數；更新 `invoke_handler` 清單 |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 `/api/git/tags`、`/api/git/branch/checkout-remote`；`/api/git/log` 帶 `branch` query |
| 型別 | `src/types.ts` | 移除 `Branch`、新增 `GitRef` + `GitTag` |
| 前端 sidebar | `src/components/RefSidebar.tsx`（新檔） | BRANCHES + TAGS 兩個可摺疊區塊、收合狀態存 localStorage、remote 濾鏡 |
| 前端 context menu | `src/components/BranchContextMenu.tsx`（新檔） | 沿用 `CommitContextMenu` pattern |
| 前端 modal | `src/components/CommitInputModal.tsx` | 加 Create Branch 變體（input + base commit picker） |
| 前端 App | `src/App.tsx` | header 移除 checkout/merge dropdown、加 New Branch 按鈕；dashboard 左欄整合 `RefSidebar`；新增 `previewedBranch` state；log fetch 帶 branch；GitGraph 頂部 preview bar；refresh 時連帶刷 tags；handlers `handlePreviewBranch` / `handleCheckoutBranch` / `handleCheckoutRemote` / `handleTagClick` |
| GitGraph | `src/components/GitGraph.tsx` | 對外暴露 `scrollToCommit(hash)`（`forwardRef` + `useImperativeHandle`） |
| i18n | `src/App.tsx` translations | 中英雙語新增 BRANCHES / TAGS / Preview / Show all remotes / Previewing / Clear preview 等 label |

---

## 7. 測試與驗收

手動測試矩陣：

| 場景 | 預期 |
|---|---|
| 開啟有 local + remote 的 repo | BRANCHES 區塊顯示 local + 沒被 local 對應的 remote |
| 切換「Show all remotes」 | 所有 remote 都列出來、包含已被 local 對應的 |
| 單擊 local branch（非 current） | log filter 到該 branch、working tree 不動、sidebar 高亮預覽中 |
| Clear preview | 回到 all branches 視圖 |
| Double-click local branch | 真的 checkout、HEAD 移動、preview 清空 |
| Right-click local branch → Delete | confirm 後刪除、清單刷新 |
| 單擊 remote branch | log filter 到該 branch 可達範圍 |
| Double-click remote branch | 建立追蹤分支並切換 |
| 單擊 tag | GitGraph 自動 scroll 到對應 commit、commit 被選取 |
| Right-click tag → Delete | confirm 後刪除、tag 清單刷新 |
| 收合 BRANCHES、重啟 app | 收合狀態被記住 |
| 在預覽某 branch 時 commit | preview 清空（HEAD 動了）、log 回到 all branches |
| 在預覽某 branch 時 pull/push/fetch | remote 清單刷新、preview 狀態保留 |
| Header「+ New Branch」 | 開 modal、輸入名稱送出、新 branch 出現在清單並 checkout |

---

## 8. 待釐清項目

- `git for-each-ref --format='%(upstream:short)'` 在 Windows 上的 quoting 行為要實測（既有 `run_git` 是用 args slice 走 `Command`，理論上沒問題）
- Tag 名稱含特殊字元（例如 `/`）的顯示與右鍵 menu 行為——`git tag` 本身允許 `release/v1.0` 這種命名

這兩點不影響架構，實作時遇到再處理。
