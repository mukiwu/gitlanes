# Commit 右鍵選單與擴充 Git 操作設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | 把 commit 線圖的操作改為右鍵選單，並加入 cherry-pick、打 tag、從 commit 開分支、複製 SHA/訊息 |
| 預估工時 | 約 1 個工作天（含手動測試） |

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
- 中英雙語 i18n。

---

## 3. 不做（YAGNI）

- 多選 commit 批次操作。
- Interactive rebase、squash、commit 編輯。
- 拖拉式操作（drag commit onto branch）。
- 在線圖上渲染 tag/branch 標籤裝飾（建立後靠既有 `git_log --decorate` 在下次 refresh 呈現，不額外做 UI）。
- 刪除 tag / 刪除分支（本次只做建立）。
- 選單項目的情境停用（例如對 HEAD 禁用 cherry-pick）；一律顯示，無效時讓 git 報錯並以 toast 呈現。

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

（既有的 `git_branch_create` 是從 HEAD 建立，保留不動；本次新增的 `git_branch_create_at` 專供「從指定 commit 開分支」。）

### 4.2 Tauri shim 路由

`src/tauriFetchShim.ts` 新增：

```typescript
case "/api/git/cherry-pick":
  return invokeJson("git_cherry_pick", { commit: body.commit });
case "/api/git/tag/create":
  return invokeJson("git_tag_create", { name: body.name, commit: body.commit, message: body.message });
case "/api/git/branch/create-at":
  return invokeJson("git_branch_create_at", { name: body.name, commit: body.commit });
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

#### `src/App.tsx`（修改）

- 新增 state：
  - `contextMenu: { commit: CommitNode; x: number; y: number } | null`
  - `inputModal: { mode: "tag" | "branch"; commit: CommitNode } | null`
- 把 `onCommitContextMenu` 傳給 `<GitGraph>`：設定 `contextMenu`。
- 渲染 `<CommitContextMenu>`（當 `contextMenu` 非 null），items 依目前的 commit 組裝（見 4.4）。
- 渲染 `<CommitInputModal>`（當 `inputModal` 非 null），onConfirm 依 mode 呼叫對應 handler。
- 新增 handlers：
  - `handleCherryPick(commit)`：requestConfirm → POST `/api/git/cherry-pick` → toast + refreshState。
  - `handleCreateTag(commit, name, message)`：POST `/api/git/tag/create` → toast + refreshState。
  - `handleCreateBranchAt(commit, name)`：POST `/api/git/branch/create-at` → toast + refreshState + 清掉 selectedCommit。
  - `handleCopySha(commit)` / `handleCopyMessage(commit)`：`navigator.clipboard.writeText(...)` → toast；失敗時 toast 錯誤。
  - 既有的 checkout / `handleGitReset` / `handleGitRevert` 沿用，改由選單觸發。
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

（標題沿用既有 `confirm*Title(hash)` 風格；本設計只強化 message 文字。）

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust commands | `src-tauri/src/lib.rs` | 新增 `git_cherry_pick` / `git_tag_create` / `git_branch_create_at`；註冊 invoke_handler |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 3 條路由 |
| 前端元件 | `src/components/CommitContextMenu.tsx`（新檔） | 右鍵浮動選單 |
| 前端元件 | `src/components/CommitInputModal.tsx`（新檔） | tag / branch 輸入 modal |
| 前端整合 | `src/components/GitGraph.tsx` | 加 `onCommitContextMenu`，節點與 commit 列掛 `onContextMenu` |
| 前端整合 | `src/App.tsx` | context menu / input modal state 與渲染；新增 handlers；移除 Workspace Actions 按鈕區；強化確認訊息文案 |
| i18n | `src/App.tsx`（translations） | 新增選單、modal、確認訊息中英文案 |

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

---

## 8. 待釐清項目

- cherry-pick 衝突後的「中止（abort）/繼續（continue）」流程本次不做；使用者需自行用工作區或 reset 處理。若之後常用再追加 `git_cherry_pick_abort`。
- annotated tag 需要 git 設定 user identity（已由既有 identity 流程涵蓋）；若未設定，git 會報錯並透過 toast 呈現。
