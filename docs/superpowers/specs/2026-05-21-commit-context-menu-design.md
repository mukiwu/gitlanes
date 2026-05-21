# Commit 右鍵選單與擴充 Git 操作設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | 把 commit 線圖的操作改為右鍵選單，加入 cherry-pick、打 tag、從 commit 開分支、複製 SHA/訊息；在線圖渲染 tag/branch 標籤並支援刪除 |
| 預估工時 | 約 1.5 個工作天（含手動測試） |

---

## 1. 背景與動機

目前 commit 相關操作只放在「Selected commit historical inspector panel」下方的 **Workspace Actions** 按鈕區（[src/App.tsx](../../../src/App.tsx)），只有 Checkout / Reset --hard / Reset --soft / Revert 四個。操作種類少，且固定佔用面板空間。

GitGraph（[src/components/GitGraph.tsx](../../../src/components/GitGraph.tsx)）的 commit 節點與 commit 列目前只支援左鍵點選（`onSelectCommit`）。

目標：把這些操作改成在 commit 線圖上**右鍵呼出的 context menu**，並擴充更多常用 Git 操作（cherry-pick、tag、從 commit 開分支、複製 SHA/訊息）。同時讓有副作用的操作在二次確認時用**自然語言**解釋功能，讓不熟 git 的使用者也看得懂。

---

## 2. 目標

- commit 線圖（節點 + commit 列）右鍵呼出 context menu。
- 選單項目：Checkout、Reset --soft、Reset --hard、Revert、Cherry-pick、Create Tag…、Create Branch here…、Copy SHA、Copy message。
- 需要輸入的操作（tag 名 + 可選訊息、分支名）用 Modal 對話框收輸入。
- 有副作用 / 破壞性的操作（Checkout、Reset、Revert、Cherry-pick）保留二次確認 dialog，且確認訊息以**自然語言**說明該操作會做什麼。
- 移除原本面板下方的 Workspace Actions 按鈕區；commit inspector 面板只保留「詳情 + 更動檔案清單 + 檔案 diff」。
- **在線圖上渲染每個 commit 的 tag / branch 標籤裝飾**（branch、tag、HEAD、remote 用不同顏色 chip）。
- **支援刪除 tag 與本地 branch**：右鍵 ref chip 呼出選單刪除（branch 提供安全刪除與強制刪除，皆二次確認）。
- 中英雙語 i18n。

---

## 3. 不做（YAGNI）

- 多選 commit 批次操作。
- Interactive rebase、squash、commit 編輯。
- **拖拉式操作（drag commit onto branch）** —— 互動模糊（cherry-pick？reset？rebase？）且誤拖風險高，另開獨立 spec 處理，不併入本次。
- 刪除 **remote** 分支（需 push，超出範圍）；本次刪除只作用在本地 branch 與 tag。
- 線圖標籤的點擊跳轉 / 篩選（chip 僅顯示與右鍵刪除，不做點擊導覽）。
- 選單項目的情境停用（例如對 HEAD 禁用 cherry-pick）；一律顯示，無效時讓 git 報錯並以 toast 呈現。例外：刪除目前所在分支會被 git 拒絕，以 toast 呈現錯誤。

---

## 4. 架構

### 4.1 後端新增 Tauri commands

新增於 `src-tauri/src/lib.rs`，並註冊進 `invoke_handler`。

```rust
#[tauri::command]
async fn git_cherry_pick(state: State<'_, AppState>, commit: String) -> Result<serde_json::Value, String>
// git cherry-pick <commit>；成功回 { success: true, message }；git_error 失敗時回傳 stderr（含衝突訊息）

#[tauri::command]
async fn git_tag_create(state: State<'_, AppState>, name: String, commit: String, message: Option<String>) -> Result<serde_json::Value, String>
// name 非空必填；message 有非空內容 → annotated：git tag -a <name> <commit> -m <message>
//                          否則      → lightweight：git tag <name> <commit>

#[tauri::command]
async fn git_branch_create_at(state: State<'_, AppState>, name: String, commit: String) -> Result<serde_json::Value, String>
// git checkout -b <name> <commit>（從指定 commit 建立並切換）

#[tauri::command]
async fn git_tag_delete(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String>
// git tag -d <name>

#[tauri::command]
async fn git_branch_delete(state: State<'_, AppState>, name: String, force: Option<bool>) -> Result<serde_json::Value, String>
// force == Some(true) → git branch -D <name>（強制，含未合併）；否則 git branch -d <name>（安全，未合併會被 git 擋）
```

實作規範：
- 三者都先驗證必填參數（`commit` / `name` 非空，trim 後檢查），不符回 `Err`。
- 用既有的 `run_git` + `git_error(result, fallback)` 模式：exit code != 0 時回傳 stderr（fallback 文字見下），成功回 `json!({ "success": true, "message": result.stdout })`。
- 不寫死任何分支假設；cherry-pick / branch 建立作用在目前 HEAD。

| command | 失敗 fallback 文字 |
|---|---|
| `git_cherry_pick` | `"Cherry-pick failed"` |
| `git_tag_create` | `"Failed to create tag"` |
| `git_branch_create_at` | `"Failed to create branch"` |
| `git_tag_delete` | `"Failed to delete tag"` |
| `git_branch_delete` | `"Failed to delete branch"` |

（既有的 `git_branch_create` 是從 HEAD 建立，保留不動；本次新增的 `git_branch_create_at` 專供「從指定 commit 開分支」。）

#### git_log 加入 ref 裝飾資訊

`git_log` 的 pretty format 從 `%h|%p|%an|%ad|%s` 改為 `%h|%p|%an|%ad|%d|%s`（把裝飾 `%d` 放在 `%s` 之前，因為 commit subject 可能含 `|`）。解析時：

- 以 `|` split，但 message 取 `parts[5..].join("|")`（保留 subject 中可能的 `|`）。
- `%d` 內容形如 ` (HEAD -> main, tag: v1.0, origin/main, feature/x)`：去掉外層括號與空白後以 `, ` 切開，逐一判斷類型：
  - `HEAD -> <name>` → `{ name, kind: "head" }`（目前所在分支）
  - `tag: <name>` → `{ name, kind: "tag" }`
  - 含 `/` 且前綴是 remote（如 `origin/...`） → `{ name, kind: "remote" }`
  - 其餘 → `{ name, kind: "branch" }`
- 每個 `CommitNode` 新增 `refs: Vec<Ref>` 欄位，序列化為 JSON `refs: { name: string, kind: "head"|"branch"|"tag"|"remote" }[]`。

```rust
#[derive(Debug, Serialize)]
struct GitRef {
    name: String,
    kind: String, // "head" | "branch" | "tag" | "remote"
}
// CommitNode 增加： refs: Vec<GitRef>
```

### 4.2 Tauri shim 路由

`src/tauriFetchShim.ts` 新增：

```typescript
case "/api/git/cherry-pick":
  return invokeJson("git_cherry_pick", { commit: body.commit });
case "/api/git/tag/create":
  return invokeJson("git_tag_create", { name: body.name, commit: body.commit, message: body.message });
case "/api/git/branch/create-at":
  return invokeJson("git_branch_create_at", { name: body.name, commit: body.commit });
case "/api/git/tag/delete":
  return invokeJson("git_tag_delete", { name: body.name });
case "/api/git/branch/delete":
  return invokeJson("git_branch_delete", { name: body.name, force: body.force });
```

### 4.3 前端元件

#### `src/components/CommitContextMenu.tsx`（新檔，presentational）

- Props：
  ```typescript
  interface CommitContextMenuItem {
    key: string;
    label: string;
    onSelect: () => void;
    danger?: boolean;       // 破壞性操作（reset --hard）用紅色
    dividerBefore?: boolean; // 在此項之前畫分隔線
  }
  interface CommitContextMenuProps {
    x: number;
    y: number;
    items: CommitContextMenuItem[];
    onClose: () => void;
  }
  ```
- 行為：以 `position: fixed; left:x; top:y` 浮出；點任一項先呼叫 `onSelect()` 再 `onClose()`；點背景遮罩或按 Esc 關閉。
- 邊界處理：若 `x`/`y` 太靠右/下導致溢出視窗，做基本鉗制（`Math.min(x, window.innerWidth - menuWidth)` 類似處理），避免選單跑出畫面。
- 樣式對齊既有 dropdown（`bg-slate-900 border border-slate-800 rounded-lg shadow-xl`，項目 `text-[12px] font-mono`）。

#### `src/components/CommitInputModal.tsx`（新檔）

- 用途：收 tag 名（+可選訊息）與分支名兩種輸入。
- Props：
  ```typescript
  interface CommitInputModalProps {
    open: boolean;
    title: string;
    fields: { key: string; label: string; placeholder?: string; required?: boolean; multiline?: boolean }[];
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: (values: Record<string, string>) => void;
    onClose: () => void;
  }
  ```
- 行為：required 欄位空白時 disable 確認鈕；Enter 在單行欄位送出；Esc / 背景關閉。風格對齊現有 confirm dialog（z-index 疊在 context menu 之上）。
- Create Tag 用兩個欄位：`name`（required）、`message`（multiline，選填）。Create Branch 用一個欄位：`name`（required）。

#### `src/components/GitGraph.tsx`（修改）

- 新增 prop：`onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;`
- 在 commit 節點 `<button>`（[GitGraph.tsx:260](../../../src/components/GitGraph.tsx)）與 commit 列 `<div>`（[GitGraph.tsx:291](../../../src/components/GitGraph.tsx)）加上：
  ```typescript
  onContextMenu={(e) => { e.preventDefault(); onCommitContextMenu?.(commit, e.clientX, e.clientY); }}
  ```
- 左鍵 `onClick`（選取）行為不變。
- **Ref chip 渲染**：在 commit 列的 message 之前，依 `commit.refs` 渲染標籤 chip。顏色依 kind：
  | kind | 樣式 |
  |---|---|
  | head | emerald（取代原本寫死的 `isHead && HEAD` 指示，改由 `refs` 內的 head 判定；chip 文字為分支名，前綴小圖示） |
  | branch | cyan |
  | tag | amber（前綴 tag 圖示） |
  | remote | slate（僅顯示，不可右鍵刪除） |
  - 新增 prop：`onRefContextMenu?: (ref: { name: string; kind: string }, x: number, y: number) => void;`
  - 在 **branch / tag** kind 的 chip 上掛 `onContextMenu`（preventDefault → `onRefContextMenu`）；remote / head 的 chip 不掛（remote 不刪、目前分支由 git 自行擋）。head chip 仍可右鍵但刪除會被 git 拒並 toast。

> 原本 `isHead`（`index === 0`）的 HEAD 標示由 `refs` 中 kind=head 取代，行為更精準（HEAD 不一定是 index 0）。

#### `src/App.tsx`（修改）

- 新增 state：
  - `contextMenu: { commit: CommitNode; x: number; y: number } | null`
  - `refMenu: { ref: { name: string; kind: string }; x: number; y: number } | null`
  - `inputModal: { mode: "tag" | "branch"; commit: CommitNode } | null`
- 把 `onCommitContextMenu` / `onRefContextMenu` 傳給 `<GitGraph>`：分別設定 `contextMenu` / `refMenu`。
- 渲染 `<CommitContextMenu>`（commit 選單 / ref 選單共用此元件），items 依情境組裝（commit 見 4.4；ref 見下）。
- 渲染 `<CommitInputModal>`（當 `inputModal` 非 null），onConfirm 依 mode 呼叫對應 handler。
- 新增 commit handlers：
  - `handleCherryPick(commit)`：requestConfirm → POST `/api/git/cherry-pick` → toast + refreshState。
  - `handleCreateTag(commit, name, message)`：POST `/api/git/tag/create` → toast + refreshState。
  - `handleCreateBranchAt(commit, name)`：POST `/api/git/branch/create-at` → toast + refreshState + 清掉 selectedCommit。
  - `handleCopySha(commit)` / `handleCopyMessage(commit)`：`navigator.clipboard.writeText(...)` → toast；失敗時 toast 錯誤。
  - 既有的 checkout / `handleGitReset` / `handleGitRevert` 沿用，改由選單觸發。
- 新增 ref handlers：
  - `handleDeleteTag(name)`：requestConfirm → POST `/api/git/tag/delete` → toast + refreshState。
  - `handleDeleteBranch(name, force)`：requestConfirm → POST `/api/git/branch/delete` `{ name, force }` → toast + refreshState。
- **Ref 選單項目**（依 chip kind 組裝）：
  - tag chip → 「Delete tag <name>」（danger）。
  - branch chip → 「Delete branch <name>」（`-d` 安全刪除）+「Force delete branch <name>」（`-D`，danger）。
  - remote / head：不開選單（remote 不刪、head 為目前分支）。
- **移除** commit inspector 面板裡的「Workspace Actions」整個 `<div>` 區塊（h5 + 四顆按鈕）。面板剩下：詳情 grid + 更動檔案清單（左欄）、檔案 diff（右欄）。

### 4.4 選單項目與順序

依序（`dividerBefore` 標分隔線）：

| # | label key | 動作 | 確認 / 輸入 | danger |
|---|---|---|---|---|
| 1 | `menuCheckout` | checkout commit（detached） | requestConfirm | |
| 2 | `menuCherryPick` | cherry-pick | requestConfirm | |
| 3 | `menuRevert` | revert | requestConfirm | |
| 4 | `menuResetSoft`（divider） | reset --soft | requestConfirm | |
| 5 | `menuResetHard` | reset --hard | requestConfirm | ✓ |
| 6 | `menuCreateTag`（divider） | 開 tag 輸入 modal | modal | |
| 7 | `menuCreateBranch` | 開 branch 輸入 modal | modal | |
| 8 | `menuCopySha`（divider） | 複製 hash | 無 | |
| 9 | `menuCopyMessage` | 複製 message | 無 | |

### 4.5 二次確認的自然語言說明（核心需求）

有副作用的操作，確認 dialog 的「訊息」要用白話解釋這個操作會做什麼、有無風險。沿用既有 `requestConfirm(title, message, onConfirm, confirmBtn, btnClass)`。以下為 i18n 文案（`{hash}` 為短 hash）：

| 操作 | 中文 message | 英文 message |
|---|---|---|
| Checkout | 「會切換到 commit {hash} 的狀態來檢視（detached HEAD）——你會暫時不在任何分支上。在這個狀態下做的新 commit，要記得另外開分支才能保存，否則可能會遺失。」 | "Switches your working copy to commit {hash} to inspect it (detached HEAD) — you won't be on any branch. New commits made here can be lost unless you create a branch to keep them." |
| Cherry-pick | 「會把 commit {hash} 的變更『複製』一份套用到你目前的分支，產生一個新的 commit。原本的 commit 不會被移動。如果內容有衝突，需要你手動解決。」 | "Copies the changes from commit {hash} and applies them onto your current branch as a new commit. The original commit stays where it is. If the changes conflict, you'll need to resolve them manually." |
| Revert | 「會新增一個 commit 來『抵銷』commit {hash} 的變更，等於把它做的事反向做一次。歷史會完整保留，是安全的還原方式。」 | "Creates a new commit that undoes the changes from commit {hash} — like reversing what it did. History is kept intact, so this is a safe way to undo." |
| Reset --soft | 「會把目前分支的指標移回 commit {hash}，但你工作區和已 stage 的檔案改動都會保留下來。常用來把後面幾個 commit 重新整理成一個。」 | "Moves your current branch back to commit {hash}, but keeps all your working changes and staged files. Often used to re-shape recent commits." |
| Reset --hard | 「⚠️ 會把目前分支移回 commit {hash}，並且『丟棄』這個 commit 之後的所有 commit，以及尚未提交的改動。這個動作無法復原，請確認。」 | "⚠️ Moves your current branch back to commit {hash} and DISCARDS every commit after it as well as any uncommitted changes. This cannot be undone — please be sure." |
| Delete tag | 「會刪除標籤 {name}。標籤只是指向某個 commit 的書籤，刪掉它不會影響任何 commit 或程式碼。」 | "Deletes the tag {name}. A tag is just a bookmark pointing at a commit — removing it doesn't affect any commit or your code." |
| Delete branch（safe `-d`） | 「會刪除分支 {name}。如果這個分支的內容還沒被合併到別的分支，git 會擋下來提醒你（避免遺失工作）。」 | "Deletes the branch {name}. If this branch hasn't been merged elsewhere, git will block it to warn you (so you don't lose work)." |
| Force delete branch（`-D`） | 「⚠️ 會『強制』刪除分支 {name}，即使它還沒被合併。這個分支上只存在於它身上、還沒合併的 commit 可能會遺失。請確認。」 | "⚠️ FORCE-deletes the branch {name} even if it hasn't been merged. Any commits that exist only on this branch may be lost. Please be sure." |

（標題沿用既有 `confirm*Title(...)` 風格；本設計只強化 message 文字。`{name}` 為 ref 名稱。）

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust commands | `src-tauri/src/lib.rs` | 新增 `git_cherry_pick` / `git_tag_create` / `git_branch_create_at` / `git_tag_delete` / `git_branch_delete`；`git_log` format 加 `%d` 並解析 refs；`CommitNode` 加 `refs`、新增 `GitRef` struct；註冊 invoke_handler |
| 型別 | `src/types.ts` | `CommitNode` 加 `refs: { name: string; kind: string }[]` |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 5 條路由（cherry-pick / tag create+delete / branch create-at+delete） |
| 前端元件 | `src/components/CommitContextMenu.tsx`（新檔） | 右鍵浮動選單（commit 選單與 ref 選單共用） |
| 前端元件 | `src/components/CommitInputModal.tsx`（新檔） | tag / branch 輸入 modal |
| 前端整合 | `src/components/GitGraph.tsx` | 加 `onCommitContextMenu` / `onRefContextMenu`；節點與 commit 列掛 `onContextMenu`；渲染 ref chip（branch/tag/head/remote）並在 branch/tag chip 掛右鍵 |
| 前端整合 | `src/App.tsx` | context menu / ref menu / input modal state 與渲染；新增 commit + ref handlers；移除 Workspace Actions 按鈕區；強化確認訊息文案 |
| i18n | `src/App.tsx`（translations） | 新增選單、modal、確認訊息（含刪除）中英文案 |

---

## 6. 錯誤處理

- cherry-pick 衝突：後端回傳 git stderr（含衝突檔案），前端以紅色 toast 顯示；不自動 abort（讓使用者在工作區處理或自行 reset）。
- tag / branch 重名：git 報錯 → stderr → toast。
- Copy 失敗（clipboard 權限）：toast 錯誤訊息。
- 所有寫入操作成功後呼叫 `refreshState()` 重新整理線圖與狀態。

---

## 7. 測試與驗收（手動）

| 場景 | 預期 |
|---|---|
| 右鍵 commit 節點 / commit 列 | 在游標位置浮出選單；點外面 / Esc 關閉 |
| Checkout / Reset --soft/--hard / Revert | 各自跳出含自然語言說明的確認 dialog；確認後正確執行並 refresh |
| Cherry-pick 一個其他分支的 commit | 確認後套用成功，目前分支多一個新 commit |
| Cherry-pick 造成衝突 | 紅色 toast 顯示 git 衝突訊息 |
| Create Tag（有訊息 / 無訊息） | annotated / lightweight tag 建立成功；重名時 toast 報錯 |
| Create Branch here | 從該 commit 建立分支並切換；重名時 toast 報錯 |
| Copy SHA / Copy message | 剪貼簿內容正確，toast 提示已複製 |
| 確認下方面板 | Workspace Actions 按鈕已移除，仍可看詳情 + 更動檔案 + diff |
| 線圖標籤裝飾 | commit 列顯示對應的 branch / tag / HEAD / remote chip，顏色正確 |
| 建立 tag / branch 後 | refresh 後線圖上立即出現新的 chip |
| 右鍵 tag chip → Delete tag | 確認後刪除，chip 消失 |
| 右鍵 branch chip → Delete branch（safe） | 已合併的分支刪除成功；未合併時 toast 顯示 git 阻擋訊息 |
| 右鍵 branch chip → Force delete | 未合併分支也強制刪除成功 |
| 嘗試刪除目前所在分支 | git 拒絕，toast 顯示錯誤 |

---

## 8. 待釐清項目

- cherry-pick 衝突後的「中止（abort）/繼續（continue）」流程本次不做；使用者需自行用工作區或 reset 處理。若之後常用再追加 `git_cherry_pick_abort`。
- annotated tag 需要 git 設定 user identity（已由既有 identity 流程涵蓋）；若未設定，git 會報錯並透過 toast 呈現。
- **拖拉式操作（drag commit onto branch）** 另開獨立 spec：需定義放下後的消歧選單（cherry-pick / reset / rebase / merge）、drop 目標 hit-test、誤拖防護等，互動設計份量足以自成一個專案。
