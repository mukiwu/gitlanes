# 分支右鍵選單擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在線圖本地 branch chip 的右鍵選單加入 Checkout / Merge into current / Rename / Copy branch name（保留既有 Delete / Force delete）。

**Architecture:** 後端只新增一個薄 git wrapper `git_branch_rename`（checkout/merge 重用既有 command）。前端在 `App.tsx` 新增 4 個 handler、一個 rename 輸入 modal state，並改寫既有的 `buildRefMenuItems` 把 branch 選單擴充成 6 項；重用既有 `CommitInputModal` 與 `CommitContextMenu`，不新增元件。

**Tech Stack:** Rust (Tauri 2), TypeScript/React, Tailwind。

**前置：** 本計畫建立在 `feat/commit-context-menu` 分支已完成的 ref 右鍵選單之上（在該分支或其後續分支執行）。

**驗收紀律：** `git_branch_rename` 是薄 git wrapper，無單元測試，靠 `cargo build` + 手動驗收（Task 5）；前端走 `npx tsc --noEmit` + 手動驗收。所有 git 寫入操作須實際測過才算完成。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/src/lib.rs` | 新增 `git_branch_rename` command | Modify |
| `src/tauriFetchShim.ts` | 新增 `/api/git/branch/rename` 路由 | Modify |
| `src/App.tsx` | 4 個 handler、`renameModal` state、rename modal 渲染、改寫 `buildRefMenuItems`、i18n | Modify |

**型別契約：**
- Rust：`git_branch_rename(old_name: String, new_name: String)`（`new` 是保留字，故 `new_name`）。
- 前端送 `{ oldName, newName }`，Tauri 自動轉 snake_case。
- API：`POST /api/git/branch/rename` body `{ oldName, newName }`。
- 既有重用：`POST /api/git/branch/checkout {name}`、`POST /api/git/branch/merge {name}`。

---

## Task 1: 後端 — git_branch_rename

**Files:**
- Modify: `src-tauri/src/lib.rs`（新增 command + 註冊）

- [ ] **Step 1: 新增 command**

在 `src-tauri/src/lib.rs` 的 `git_branch_delete` 函式之後加入：

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

- [ ] **Step 2: 註冊到 invoke_handler**

在 `tauri::generate_handler![...]` 清單中，於 `git_branch_delete,` 之後加入：

```rust
            git_branch_rename,
```

- [ ] **Step 3: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功。dead_code 警告不應出現（generate_handler! 會引用它）。若有，勿加 `#[allow]`。也跑 `cargo test ref_tests`（expect 3 pass）確認未破壞既有測試。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add git_branch_rename command"
```

---

## Task 2: Tauri shim — rename 路由

**Files:**
- Modify: `src/tauriFetchShim.ts`

- [ ] **Step 1: 加入路由**

在 `src/tauriFetchShim.ts` 的 `case "/api/git/branch/delete":` 那組之後加入：

```typescript
      case "/api/git/branch/rename":
        return invokeJson("git_branch_rename", { oldName: body.oldName, newName: body.newName });
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/tauriFetchShim.ts
git commit -m "feat: add branch rename route to fetch shim"
```

---

## Task 3: App.tsx — i18n、handlers、rename state

**Files:**
- Modify: `src/App.tsx`

**You MUST read `src/App.tsx` first** to locate the `translations` en/zh blocks, the existing ref handlers (`handleDeleteTag`/`handleDeleteBranch`), and the `refMenu` state declaration.

- [ ] **Step 1: 新增 rename modal state**

在 `refMenu` state 宣告附近加入：

```typescript
  const [renameModal, setRenameModal] = useState<{ branch: string } | null>(null);
```

- [ ] **Step 2: 加入 i18n keys（en 與 zh 兩區塊都要加，鍵集相同）**

en 區塊加入：

```typescript
    menuCheckoutBranch: "Checkout this branch",
    menuMergeBranch: "Merge into current branch",
    menuRenameBranch: "Rename branch…",
    menuCopyBranchName: "Copy branch name",
    renameModalTitle: "Rename Branch",
    renameNewNameLabel: "New branch name",
    confirmMergeBranchTitle: (name: string) => `Merge branch ${name}?`,
    confirmMergeBranchMessage: (name: string) => `Merges the changes from branch ${name} into your current branch. If both sides changed the same lines you'll get conflicts to resolve manually.`,
    confirmMergeBranchBtn: "Merge",
    toastBranchCheckedOut: (name: string) => `Switched to branch ${name}.`,
    toastBranchMerged: (name: string) => `Branch ${name} merged into current branch.`,
    toastBranchRenamed: (name: string) => `Branch renamed to ${name}.`,
    toastCopiedBranch: "Branch name copied to clipboard.",
```

zh 區塊加入：

```typescript
    menuCheckoutBranch: "切換到這個分支",
    menuMergeBranch: "合併進目前分支",
    menuRenameBranch: "重新命名分支…",
    menuCopyBranchName: "複製分支名稱",
    renameModalTitle: "重新命名分支",
    renameNewNameLabel: "新的分支名稱",
    confirmMergeBranchTitle: (name: string) => `合併分支 ${name}？`,
    confirmMergeBranchMessage: (name: string) => `會把分支 ${name} 的變更合併進你目前的分支。如果兩邊改到同一處會產生衝突，需要你手動解決。`,
    confirmMergeBranchBtn: "合併",
    toastBranchCheckedOut: (name: string) => `已切換到分支 ${name}。`,
    toastBranchMerged: (name: string) => `已將分支 ${name} 合併進目前分支。`,
    toastBranchRenamed: (name: string) => `分支已重新命名為 ${name}。`,
    toastCopiedBranch: "已複製分支名稱到剪貼簿。",
```

- [ ] **Step 3: 新增 4 個 handler**

在既有的 `handleDeleteBranch` 之後加入：

```typescript
  const handleCheckoutBranch = async (name: string) => {
    try {
      const res = await fetch("/api/git/branch/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const handleMergeBranch = (name: string) => {
    requestConfirm(
      t.confirmMergeBranchTitle(name),
      t.confirmMergeBranchMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/branch/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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

  const handleRenameBranch = async (oldName: string, newName: string) => {
    try {
      const res = await fetch("/api/git/branch/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const handleCopyBranchName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      showToast(t.toastCopiedBranch);
    } catch {
      showToast(t.toastCopyFailed, true);
    }
  };
```

> `t.toastCopyFailed`、`requestConfirm`、`showToast`、`refreshState`、`setSelectedCommit` 皆為既有。

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。新 handler 暫時未被引用（Task 4 接上）；本專案 tsconfig 未開 noUnusedLocals，不會報錯。en/zh 鍵集若不一致會型別錯誤——確保兩邊都加了相同的 key。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add branch checkout/merge/rename/copy handlers and i18n"
```

---

## Task 4: App.tsx — 改寫 ref 選單與 rename modal 渲染

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 改寫 buildRefMenuItems**

找到既有的 `buildRefMenuItems`（目前 branch 只回 Delete + Force delete），整個函式替換成：

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

- [ ] **Step 2: 渲染 rename modal**

在既有的 ref `<CommitContextMenu>`（由 `refMenu` 驅動）渲染處附近，加入 rename modal 渲染：

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

> `CommitInputModal`、`t.modalConfirm`、`t.modalCancel` 皆為既有。

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: extend branch ref menu with checkout/merge/rename/copy"
```

---

## Task 5: 手動測試（驗收 gate）

**Files:** 無程式改動。

> 需 `npm run tauri dev`（**重啟**以載入 Rust 改動）+ 一個有多個本地分支的 repo。

- [ ] **Step 1: 啟動並右鍵本地 branch chip**

操作：右鍵一個非當前的本地 branch chip。
Expected：浮出 6 項：Checkout / Merge into current / Rename…（上方分隔線）/ Copy branch name / Delete branch（上方分隔線）/ Force delete branch（紅）。順序與分隔線正確。

- [ ] **Step 2: Checkout**

操作：點 Checkout。
Expected：**不跳確認**，直接切換；HEAD（emerald）chip 移到該分支；toast「已切換到分支 X」。若工作區有未提交改動導致衝突 → 紅 toast 顯示 git 訊息。

- [ ] **Step 3: Merge into current**

操作：在分支 A，右鍵分支 B → Merge into current。
Expected：跳出含自然語言說明的確認 dialog；確認後合併、refresh。製造衝突再試 → 紅 toast 顯示衝突訊息。

- [ ] **Step 4: Rename**

操作：右鍵 branch → Rename… → 輸入新名稱 → 確認。
Expected：改名成功，chip 文字更新為新名；輸入既有分支名（重名）→ 紅 toast 報錯。

- [ ] **Step 5: Copy branch name**

操作：右鍵 branch → Copy branch name → 貼到別處。
Expected：剪貼簿為分支名，toast「已複製分支名稱」。

- [ ] **Step 6: 未受影響項目**

操作：右鍵 tag chip；右鍵遠端 chip。
Expected：tag chip 仍只有 Delete tag；遠端 chip 無選單。

- [ ] **Step 7: 全部通過後勾完本任務**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 git_branch_rename | Task 1 |
| §4.2 shim rename 路由 | Task 2 |
| §4.3 4 個 handler | Task 3 Step 3 |
| §4.4 rename modal state + 渲染 | Task 3 Step 1, Task 4 Step 2 |
| §4.5 改寫 buildRefMenuItems（6 項） | Task 4 Step 1 |
| §4.6 i18n（中英） | Task 3 Step 2 |
| §7 測試矩陣 | Task 5 |

**型別一致性：** Rust `old_name`/`new_name` ↔ 前端 `oldName`/`newName` ↔ shim 一致；i18n key 名稱在 Task 3 定義、Task 4 使用，一致；`buildRefMenuItems` 簽章不變（refName, kind），只擴充 branch 分支回傳。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。

**已知相依：** Task 3 的 handler 在 Task 4 由 `buildRefMenuItems` 引用；中間狀態 tsconfig 不報未使用。
