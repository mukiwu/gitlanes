# 分支右鍵選單擴充設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | 在線圖的本地 branch chip 右鍵選單加入 Checkout / Merge into current / Rename / Copy branch name（保留既有 Delete / Force delete） |
| 預估工時 | 約半個工作天（含手動測試） |
| 相依 | 建立在 `feat/commit-context-menu` 分支已完成的 ref 右鍵選單之上 |

---

## 1. 背景與動機

`feat/commit-context-menu` 已讓線圖的 ref chip（branch / tag）支援右鍵。目前 branch chip 右鍵只有 **Delete branch** 與 **Force delete branch**；tag chip 只有 **Delete tag**。

使用者希望本地 branch chip 能做更多常用操作：切換（checkout）、合併進目前分支（merge）、重新命名（rename）、複製分支名。後端已有 `git_branch_checkout`、`git_branch_merge`，只缺 rename；copy 為純前端。

---

## 2. 目標

本地 branch chip 右鍵選單（依序）：
1. **Checkout** — 切換到該分支（**不二次確認**）。
2. **Merge into current** — 合併進目前分支（**二次確認 + 自然語言說明**）。
3. **Rename…** — 開輸入 modal 改名（modal 即確認）。
4. **Copy branch name** — 複製分支名到剪貼簿。
5. **Delete branch** — 既有（安全 `-d`）。
6. **Force delete branch** — 既有（`-D`，danger）。

tag chip 維持不變（只有 Delete tag）。中英雙語 i18n。

---

## 3. 不做（YAGNI）

- **遠端分支 chip 的右鍵操作**（如 origin/main 的 checkout-as-tracking、刪除遠端）—— 本次不動，遠端 chip 維持只顯示。
- Rebase current onto branch（風險高、互動需另外設計）。
- Set upstream / push / pull / fetch 等網路操作。
- 分支比較 / diff against current。
- 從分支再開新分支（commit 右鍵已有「從這裡開分支」）。

---

## 4. 架構

### 4.1 後端

新增 1 個 command（其餘重用），註冊進 `invoke_handler`：

```rust
#[tauri::command]
async fn git_branch_rename(state: State<'_, AppState>, old_name: String, new_name: String) -> Result<serde_json::Value, String> {
    if old_name.trim().is_empty() || new_name.trim().is_empty() {
        return Err("Branch names are required".to_string());
    }
    let result = git_error(run_git(&state, &["branch", "-m", old_name.trim(), new_name.trim()])?, "Failed to rename branch")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}
```

重用既有：`git_branch_checkout(name)`、`git_branch_merge(name)`。

> Rust 參數命名用 `old_name` / `new_name`（`new` 是保留字）；前端送 `oldName` / `newName`，Tauri 自動轉成 snake_case。

### 4.2 Tauri shim 路由

`src/tauriFetchShim.ts` 新增：

```typescript
case "/api/git/branch/rename":
  return invokeJson("git_branch_rename", { oldName: body.oldName, newName: body.newName });
```

（checkout / merge 路由 `/api/git/branch/checkout`、`/api/git/branch/merge` 已存在。）

### 4.3 前端 handlers（App.tsx）

```typescript
// Checkout：不二次確認
const handleCheckoutBranch = async (name: string) => {
  try {
    const res = await fetch("/api/git/branch/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed");
    showToast(t.toastBranchCheckedOut(name));
    setSelectedCommit(null);
    refreshState();
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : "Checkout failed", true);
  }
};

// Merge：二次確認（自然語言）
const handleMergeBranch = (name: string) => {
  requestConfirm(
    t.confirmMergeBranchTitle(name),
    t.confirmMergeBranchMessage(name),
    async () => {
      try {
        const res = await fetch("/api/git/branch/merge", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Merge failed");
        showToast(t.toastBranchMerged(name));
        refreshState();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : "Merge failed", true);
      }
    },
    t.confirmMergeBranchBtn,
    "bg-cyan-600 hover:bg-cyan-500"
  );
};

// Rename：輸入 modal → 執行
const handleRenameBranch = async (oldName: string, newName: string) => {
  try {
    const res = await fetch("/api/git/branch/rename", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName, newName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Rename failed");
    showToast(t.toastBranchRenamed(newName));
    refreshState();
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : "Rename failed", true);
  }
};

// Copy branch name
const handleCopyBranchName = async (name: string) => {
  try {
    await navigator.clipboard.writeText(name);
    showToast(t.toastCopiedBranch);
  } catch {
    showToast(t.toastCopyFailed, true); // 既有 key
  }
};
```

### 4.4 Rename 輸入 modal

重用既有 `CommitInputModal` 元件，新增獨立 state（不綁 commit）：

```typescript
const [renameModal, setRenameModal] = useState<{ branch: string } | null>(null);
```

渲染：

```typescript
{renameModal && (
  <CommitInputModal
    open
    title={t.renameModalTitle}
    fields={[{ key: "newName", label: t.renameNewNameLabel, placeholder: renameModal.branch, required: true }]}
    confirmLabel={t.modalConfirm}
    cancelLabel={t.modalCancel}
    onConfirm={(values) => {
      const oldName = renameModal.branch;
      setRenameModal(null);
      handleRenameBranch(oldName, values.newName.trim());
    }}
    onClose={() => setRenameModal(null)}
  />
)}
```

（`modalConfirm` / `modalCancel` 為既有 key。）

### 4.5 改寫 buildRefMenuItems

現有 `buildRefMenuItems(refName, kind)`：tag → [Delete tag]；branch → [Delete, Force delete]。改為 branch 回傳完整 6 項：

```typescript
const buildRefMenuItems = (refName: string, kind: string): CommitContextMenuItem[] => {
  if (kind === "tag") {
    return [{ key: "deltag", label: `${t.menuDeleteTag} ${refName}`, danger: true, onSelect: () => handleDeleteTag(refName) }];
  }
  // branch
  return [
    { key: "checkout", label: t.menuCheckoutBranch, onSelect: () => handleCheckoutBranch(refName) },
    { key: "merge", label: t.menuMergeBranch, onSelect: () => handleMergeBranch(refName) },
    { key: "rename", label: t.menuRenameBranch, dividerBefore: true, onSelect: () => setRenameModal({ branch: refName }) },
    { key: "copy", label: t.menuCopyBranchName, onSelect: () => handleCopyBranchName(refName) },
    { key: "delbranch", label: `${t.menuDeleteBranch} ${refName}`, dividerBefore: true, onSelect: () => handleDeleteBranch(refName, false) },
    { key: "forcedel", label: `${t.menuForceDeleteBranch} ${refName}`, danger: true, onSelect: () => handleDeleteBranch(refName, true) },
  ];
};
```

### 4.6 i18n 文案（中英）

| key | en | zh |
|---|---|---|
| `menuCheckoutBranch` | "Checkout this branch" | "切換到這個分支" |
| `menuMergeBranch` | "Merge into current branch" | "合併進目前分支" |
| `menuRenameBranch` | "Rename branch…" | "重新命名分支…" |
| `menuCopyBranchName` | "Copy branch name" | "複製分支名稱" |
| `renameModalTitle` | "Rename Branch" | "重新命名分支" |
| `renameNewNameLabel` | "New branch name" | "新的分支名稱" |
| `confirmMergeBranchTitle` (name) | \`Merge branch ${name}?\` | \`合併分支 ${name}？\` |
| `confirmMergeBranchMessage` (name) | \`Merges the changes from branch ${name} into your current branch. If both sides changed the same lines you'll get conflicts to resolve manually.\` | \`會把分支 ${name} 的變更合併進你目前的分支。如果兩邊改到同一處會產生衝突，需要你手動解決。\` |
| `confirmMergeBranchBtn` | "Merge" | "合併" |
| `toastBranchCheckedOut` (name) | \`Switched to branch ${name}.\` | \`已切換到分支 ${name}。\` |
| `toastBranchMerged` (name) | \`Branch ${name} merged into current branch.\` | \`已將分支 ${name} 合併進目前分支。\` |
| `toastBranchRenamed` (name) | \`Branch renamed to ${name}.\` | \`分支已重新命名為 ${name}。\` |
| `toastCopiedBranch` | "Branch name copied to clipboard." | "已複製分支名稱到剪貼簿。" |

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust command | `src-tauri/src/lib.rs` | 新增 `git_branch_rename`；註冊 invoke_handler |
| Tauri shim | `src/tauriFetchShim.ts` | 新增 `/api/git/branch/rename` 路由 |
| 前端整合 | `src/App.tsx` | 新增 4 個 handler、`renameModal` state 與渲染、改寫 `buildRefMenuItems`、i18n |

（不需新增前端元件——重用既有 `CommitInputModal` 與 `CommitContextMenu`。）

---

## 6. 錯誤處理

- Checkout 失敗（如未提交改動會被覆蓋）：git 回 stderr → 紅色 toast。
- Merge 衝突：git 回 stderr → 紅色 toast（不自動 abort，使用者自行處理）。
- Rename 重名 / 不存在：git 回 stderr → toast。
- Copy 失敗：toast（重用 `toastCopyFailed`）。
- 所有寫入成功後 `refreshState()` 重整線圖。

---

## 7. 測試與驗收（手動）

| 場景 | 預期 |
|---|---|
| 右鍵本地 branch chip | 浮出 6 項選單（Checkout / Merge / Rename… / Copy / Delete / Force delete），順序與分隔線正確 |
| Checkout | 不跳確認，直接切換；HEAD chip 移到該分支；有未提交改動致衝突時紅 toast |
| Merge into current | 跳含自然語言說明的確認；確認後合併、refresh；衝突時紅 toast |
| Rename… | 開 modal 填新名 → 改名成功，chip 文字更新；重名時 toast 報錯 |
| Copy branch name | 剪貼簿為分支名，toast 提示 |
| tag chip 右鍵 | 仍只有 Delete tag（未受影響） |
| 遠端 chip 右鍵 | 無選單（維持現狀） |

---

## 8. 待釐清項目

- Merge 預設用一般 merge（可能產生 merge commit 或 fast-forward，由 git 決定）；不提供 `--no-ff` / `--squash` 選項，本次保持簡單。
- Checkout 若因未提交改動失敗，本次只顯示 git 錯誤訊息，不自動 stash；自動 stash 流程留待之後評估。
