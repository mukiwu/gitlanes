# Commit 右鍵選單與擴充 Git 操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 GitLanes commit 線圖的操作改為右鍵 context menu，加入 cherry-pick、打 tag、從 commit 開分支、複製 SHA/訊息，並在線圖渲染 tag/branch 標籤、支援刪除 tag 與本地分支；有副作用的操作以自然語言二次確認。

**Architecture:** 後端在 `lib.rs` 新增 5 個薄 git wrapper command，並讓 `git_log` 解析 `%d` 裝飾為結構化 refs。前端新增兩個 presentational 元件（`CommitContextMenu`、`CommitInputModal`），GitGraph 往上拋右鍵事件並渲染 ref chip，所有 git 操作邏輯（confirm/toast/refresh/modal）集中在 `App.tsx`。

**Tech Stack:** Rust (Tauri 2, serde_json), TypeScript/React, Tailwind。

**驗收紀律：** 只有 Rust 的 `parse_refs` 純函式走 TDD；其餘 git wrapper、UI 整合走 `cargo build` / `npx tsc --noEmit` + 手動驗收。所有 git 寫入操作必須實際在 repo 測過（Task 11）才算完成。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/src/lib.rs` | git_log 解析 refs；5 個新 command | Modify |
| `src/types.ts` | `CommitNode.refs` 欄位 | Modify |
| `src/tauriFetchShim.ts` | 5 條新 API 路由 | Modify |
| `src/components/CommitContextMenu.tsx` | 浮動右鍵選單（commit 與 ref 共用） | Create |
| `src/components/CommitInputModal.tsx` | tag / branch 輸入 modal | Create |
| `src/components/GitGraph.tsx` | 右鍵事件 + ref chip 渲染 | Modify |
| `src/App.tsx` | 選單/modal state 與渲染、handlers、移除 Workspace Actions、i18n | Modify |

**型別契約（跨任務一致，務必照抄）：**

- Rust：`struct GitRef { name: String, kind: String }`；`kind` ∈ `"head"|"branch"|"tag"|"remote"`。`CommitNode` 新增 `refs: Vec<GitRef>`。
- Rust 純函式：`fn parse_refs(decoration: &str) -> Vec<GitRef>`。
- TS：`CommitNode.refs: { name: string; kind: string }[]`。
- `CommitContextMenuItem { key: string; label: string; onSelect: () => void; danger?: boolean; dividerBefore?: boolean }`。
- `CommitContextMenuProps { x: number; y: number; items: CommitContextMenuItem[]; onClose: () => void }`。
- `CommitInputModalProps { open: boolean; title: string; fields: InputField[]; confirmLabel: string; cancelLabel: string; onConfirm: (values: Record<string,string>) => void; onClose: () => void }`，其中 `InputField { key: string; label: string; placeholder?: string; required?: boolean; multiline?: boolean }`。
- API 路由與 body：
  - `POST /api/git/cherry-pick` `{ commit }`
  - `POST /api/git/tag/create` `{ name, commit, message }`
  - `POST /api/git/branch/create-at` `{ name, commit }`
  - `POST /api/git/tag/delete` `{ name }`
  - `POST /api/git/branch/delete` `{ name, force }`

---

## Task 1: 後端 — git_log 解析 ref 裝飾（TDD）

**Files:**
- Modify: `src-tauri/src/lib.rs`（`CommitNode` struct、新增 `GitRef` + `parse_refs`、`git_log` format/解析）

- [ ] **Step 1: 新增 GitRef struct 與 CommitNode.refs 欄位**

在 `src-tauri/src/lib.rs` 找到 `struct CommitNode { ... }`（約 line 59），改成：

```rust
#[derive(Debug, Serialize)]
struct GitRef {
    name: String,
    kind: String, // "head" | "branch" | "tag" | "remote"
}

#[derive(Debug, Serialize)]
struct CommitNode {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    message: String,
    refs: Vec<GitRef>,
}
```

- [ ] **Step 2: 寫 parse_refs 的失敗測試**

在 `src-tauri/src/lib.rs` 檔案最後加入一個測試模組：

```rust
#[cfg(test)]
mod ref_tests {
    use super::*;

    #[test]
    fn parses_head_branch_tag_remote() {
        let refs = parse_refs(" (HEAD -> main, tag: v1.0, origin/main, feature/x)");
        assert_eq!(refs.len(), 4);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[0].kind, "head");
        assert_eq!(refs[1].name, "v1.0");
        assert_eq!(refs[1].kind, "tag");
        assert_eq!(refs[2].name, "origin/main");
        assert_eq!(refs[2].kind, "remote");
        assert_eq!(refs[3].name, "feature/x");
        assert_eq!(refs[3].kind, "branch");
    }

    #[test]
    fn empty_decoration_yields_no_refs() {
        assert!(parse_refs("").is_empty());
        assert!(parse_refs("   ").is_empty());
    }

    #[test]
    fn detached_head_alone() {
        let refs = parse_refs(" (HEAD)");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, "head");
    }
}
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd src-tauri && cargo test ref_tests`
Expected: 編譯失敗（`parse_refs` 未定義）。

- [ ] **Step 4: 實作 parse_refs**

在 `src-tauri/src/lib.rs` 的 `git_log` 函式之前加入：

```rust
fn parse_refs(decoration: &str) -> Vec<GitRef> {
    let trimmed = decoration.trim().trim_start_matches('(').trim_end_matches(')').trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed
        .split(", ")
        .filter_map(|token| {
            let token = token.trim();
            if token.is_empty() {
                return None;
            }
            if let Some(rest) = token.strip_prefix("HEAD -> ") {
                return Some(GitRef { name: rest.trim().to_string(), kind: "head".to_string() });
            }
            if token == "HEAD" {
                return Some(GitRef { name: "HEAD".to_string(), kind: "head".to_string() });
            }
            if let Some(rest) = token.strip_prefix("tag: ") {
                return Some(GitRef { name: rest.trim().to_string(), kind: "tag".to_string() });
            }
            // remote-tracking refs look like "origin/main"; local branches have no "/".
            let kind = if token.contains('/') { "remote" } else { "branch" };
            Some(GitRef { name: token.to_string(), kind: kind.to_string() })
        })
        .collect()
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd src-tauri && cargo test ref_tests`
Expected: PASS（3 個測試）。

- [ ] **Step 6: 把 %d 接進 git_log**

在 `git_log` 中，把 pretty format 那行（約 line 394）：

```rust
        "--pretty=format:%h|%p|%an|%ad|%s",
```

改成（把 `%d` 放在 `%s` 前）：

```rust
        "--pretty=format:%h|%p|%an|%ad|%d|%s",
```

並把解析 commit 的 closure（約 line 410-419）改成（decoration 在 index 4、message 取 index 5 以後 join，避免 subject 內的 `|` 被截斷）：

```rust
        .map(|line| {
            let parts: Vec<_> = line.split('|').collect();
            CommitNode {
                hash: parts.first().unwrap_or(&"").trim().to_string(),
                parents: parts.get(1).unwrap_or(&"").split_whitespace().map(String::from).collect(),
                author: parts.get(2).unwrap_or(&"").trim().to_string(),
                date: parts.get(3).unwrap_or(&"").trim().to_string(),
                refs: parse_refs(parts.get(4).unwrap_or(&"")),
                message: parts.get(5..).map(|rest| rest.join("|")).unwrap_or_default().trim().to_string(),
            }
        })
```

- [ ] **Step 7: 確認編譯與測試**

Run: `cd src-tauri && cargo build && cargo test ref_tests`
Expected: build 成功、3 測試 PASS。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: parse git ref decorations into structured refs in git_log"
```

---

## Task 2: 後端 — cherry-pick / tag 建立 / 從 commit 開分支

**Files:**
- Modify: `src-tauri/src/lib.rs`（新增 3 個 command + 註冊）

- [ ] **Step 1: 新增三個 command**

在 `src-tauri/src/lib.rs` 的 `git_revert` 函式之後加入：

```rust
#[tauri::command]
async fn git_cherry_pick(state: State<'_, AppState>, commit: String) -> Result<serde_json::Value, String> {
    if commit.trim().is_empty() {
        return Err("Commit hash is required".to_string());
    }
    let result = git_error(run_git(&state, &["cherry-pick", commit.trim()])?, "Cherry-pick failed")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_tag_create(state: State<'_, AppState>, name: String, commit: String, message: Option<String>) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Tag name is required".to_string());
    }
    if commit.trim().is_empty() {
        return Err("Commit hash is required".to_string());
    }
    let name = name.trim();
    let commit = commit.trim();
    let result = match message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        Some(msg) => git_error(run_git(&state, &["tag", "-a", name, commit, "-m", msg])?, "Failed to create tag")?,
        None => git_error(run_git(&state, &["tag", name, commit])?, "Failed to create tag")?,
    };
    Ok(json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_branch_create_at(state: State<'_, AppState>, name: String, commit: String) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    if commit.trim().is_empty() {
        return Err("Commit hash is required".to_string());
    }
    let result = git_error(run_git(&state, &["checkout", "-b", name.trim(), commit.trim()])?, "Failed to create branch")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}
```

- [ ] **Step 2: 註冊到 invoke_handler**

在 `tauri::generate_handler![...]` 清單中，於 `git_revert,` 之後加入：

```rust
            git_cherry_pick,
            git_tag_create,
            git_branch_create_at,
```

- [ ] **Step 3: 確認編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功（dead_code 警告可能出現，因前端尚未呼叫；可忽略，勿加 `#[allow]`）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add cherry-pick, tag-create and branch-create-at commands"
```

---

## Task 3: 後端 — 刪除 tag / 刪除分支

**Files:**
- Modify: `src-tauri/src/lib.rs`（新增 2 個 command + 註冊）

- [ ] **Step 1: 新增兩個 command**

在 `git_branch_create_at` 之後加入：

```rust
#[tauri::command]
async fn git_tag_delete(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Tag name is required".to_string());
    }
    let result = git_error(run_git(&state, &["tag", "-d", name.trim()])?, "Failed to delete tag")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_branch_delete(state: State<'_, AppState>, name: String, force: Option<bool>) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    let result = git_error(run_git(&state, &["branch", flag, name.trim()])?, "Failed to delete branch")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}
```

- [ ] **Step 2: 註冊到 invoke_handler**

在 `git_branch_create_at,` 之後加入：

```rust
            git_tag_delete,
            git_branch_delete,
```

- [ ] **Step 3: 確認編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add tag-delete and branch-delete commands"
```

---

## Task 4: Tauri shim — 5 條新路由

**Files:**
- Modify: `src/tauriFetchShim.ts`

- [ ] **Step 1: 加入路由**

在 `src/tauriFetchShim.ts` 的 `switch` 中，於 `case "/api/git/branch/merge":` 那組之後（`default:` 之前）加入：

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

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/tauriFetchShim.ts
git commit -m "feat: add cherry-pick, tag and branch routes to fetch shim"
```

---

## Task 5: 前端元件 — CommitContextMenu

**Files:**
- Create: `src/components/CommitContextMenu.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/CommitContextMenu.tsx`：

```typescript
import React, { useEffect, useRef, useState } from "react";

export interface CommitContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  dividerBefore?: boolean;
}

interface CommitContextMenuProps {
  x: number;
  y: number;
  items: CommitContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 220;

export const CommitContextMenu: React.FC<CommitContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp into viewport once mounted (measure real height).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
        className="fixed z-[90] bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-1.5"
      >
        {items.map((item) => (
          <React.Fragment key={item.key}>
            {item.dividerBefore && <div className="my-1 border-t border-slate-800" />}
            <button
              onClick={() => { item.onSelect(); onClose(); }}
              className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-mono cursor-pointer transition-colors ${
                item.danger ? "text-rose-400 hover:bg-rose-950/40 hover:text-rose-300" : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
            >
              {item.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </>
  );
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（元件尚未被引用，僅檢查語法/型別）。

- [ ] **Step 3: Commit**

```bash
git add src/components/CommitContextMenu.tsx
git commit -m "feat: add CommitContextMenu floating menu component"
```

---

## Task 6: 前端元件 — CommitInputModal

**Files:**
- Create: `src/components/CommitInputModal.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/CommitInputModal.tsx`：

```typescript
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface InputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}

interface CommitInputModalProps {
  open: boolean;
  title: string;
  fields: InputField[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

export const CommitInputModal: React.FC<CommitInputModalProps> = ({
  open,
  title,
  fields,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setValues({});
  }, [open, title]);

  if (!open) return null;

  const requiredFilled = fields.every((f) => !f.required || (values[f.key]?.trim() ?? "") !== "");

  const submit = () => {
    if (!requiredFilled) return;
    onConfirm(values);
  };

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-slate-500">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={3}
                  className="w-full resize-none rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 focus:border-cyan-500 focus:outline-none placeholder-slate-600"
                />
              ) : (
                <input
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder={f.placeholder}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 focus:border-cyan-500 focus:outline-none placeholder-slate-600"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[12px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer">
            {cancelLabel}
          </button>
          <button
            onClick={submit}
            disabled={!requiredFilled}
            className="rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/components/CommitInputModal.tsx
git commit -m "feat: add CommitInputModal for tag/branch input"
```

---

## Task 7: GitGraph — 右鍵事件與 ref chip

**Files:**
- Modify: `src/types.ts`（CommitNode.refs）
- Modify: `src/components/GitGraph.tsx`

- [ ] **Step 1: types.ts 加 refs 欄位**

在 `src/types.ts` 的 `CommitNode` 介面加入 `refs`：

```typescript
export interface CommitNode {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  refs: { name: string; kind: string }[];
}
```

- [ ] **Step 2: GitGraph props 加兩個 callback**

在 `src/components/GitGraph.tsx` 的 props 介面（找到 `onSelectCommit: (commit: CommitNode) => void;` 那段）加入：

```typescript
  onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;
  onRefContextMenu?: (ref: { name: string; kind: string }, x: number, y: number) => void;
```

並在元件參數解構（`onSelectCommit,` 旁）加入：

```typescript
  onCommitContextMenu,
  onRefContextMenu,
```

- [ ] **Step 3: 節點與 commit 列掛 onContextMenu**

在 commit 節點 `<button ... onClick={() => onSelectCommit(commit)}`（約 line 262）加上 `onContextMenu`：

```typescript
                  onClick={() => onSelectCommit(commit)}
                  onContextMenu={(e) => { e.preventDefault(); onCommitContextMenu?.(commit, e.clientX, e.clientY); }}
```

在 commit 列 `<div ... onClick={() => onSelectCommit(commit)}`（約 line 293）加上同樣的 `onContextMenu`：

```typescript
                  onClick={() => onSelectCommit(commit)}
                  onContextMenu={(e) => { e.preventDefault(); onCommitContextMenu?.(commit, e.clientX, e.clientY); }}
```

- [ ] **Step 4: 渲染 ref chip 並取代寫死的 HEAD 指示**

在 commit 列裡，找到目前寫死的 HEAD 指示區塊：

```typescript
                    {/* Head tag indicator */}
                    {isHead && (
                      <span className="flex items-center space-x-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 text-[12px] px-1.5 py-0.5 rounded font-medium select-none shrink-0 uppercase">
                        <Check className="h-2.5 w-2.5" />
                        <span>HEAD</span>
                      </span>
                    )}
```

整段替換成依 `commit.refs` 渲染的 chip：

```typescript
                    {/* Ref decorations: branch / tag / HEAD / remote */}
                    {commit.refs.map((r) => {
                      const palette: Record<string, string> = {
                        head: "bg-emerald-950 border-emerald-800 text-emerald-400",
                        branch: "bg-cyan-950 border-cyan-800 text-cyan-300",
                        tag: "bg-amber-950 border-amber-800 text-amber-300",
                        remote: "bg-slate-800 border-slate-700 text-slate-400",
                      };
                      const deletable = r.kind === "tag" || r.kind === "branch";
                      return (
                        <span
                          key={`${r.kind}:${r.name}`}
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={deletable ? (e) => { e.preventDefault(); e.stopPropagation(); onRefContextMenu?.(r, e.clientX, e.clientY); } : undefined}
                          title={deletable ? `${r.name} — right-click to delete` : r.name}
                          className={`flex items-center space-x-0.5 border text-[12px] px-1.5 py-0.5 rounded font-medium select-none shrink-0 ${palette[r.kind] ?? palette.branch} ${deletable ? "cursor-context-menu" : ""}`}
                        >
                          {r.kind === "tag" && <Tag className="h-2.5 w-2.5" />}
                          {r.kind === "head" && <Check className="h-2.5 w-2.5" />}
                          <span>{r.name}</span>
                        </span>
                      );
                    })}
```

確保 `Tag` 已從 lucide-react 匯入：在 `src/components/GitGraph.tsx` 頂部 import 行把 `Tag` 加入（若尚未匯入）。`isHead`/`index` 變數若因移除而變成未使用，一併刪除其宣告（`const isHead = index === 0;` 與相關 `index`，若無其他用途）。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。若 `isHead`/`index` 未使用造成警告（vite 不報錯但保持乾淨），移除其宣告。

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/components/GitGraph.tsx
git commit -m "feat: render ref chips and emit context-menu events in GitGraph"
```

---

## Task 8: App.tsx — i18n、state、移除 Workspace Actions 面板

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: import 兩個新元件**

在 `src/App.tsx` 既有的 component import 區（`import { DiffViewer } ...` 附近）加入：

```typescript
import { CommitContextMenu, CommitContextMenuItem } from "./components/CommitContextMenu";
import { CommitInputModal } from "./components/CommitInputModal";
```

- [ ] **Step 2: 新增 state**

在 `selectedCommit` state 宣告附近加入：

```typescript
  const [contextMenu, setContextMenu] = useState<{ commit: CommitNode; x: number; y: number } | null>(null);
  const [refMenu, setRefMenu] = useState<{ refName: string; kind: string; x: number; y: number } | null>(null);
  const [inputModal, setInputModal] = useState<{ mode: "tag" | "branch"; commit: CommitNode } | null>(null);
```

- [ ] **Step 3: 加入 i18n 文案（en 與 zh 兩區塊都要加，鍵集相同）**

在 `translations` 的 `en` 區塊加入：

```typescript
    menuCheckout: "Checkout this commit",
    menuCherryPick: "Cherry-pick onto current branch",
    menuRevert: "Revert this commit",
    menuResetSoft: "Reset --soft to here",
    menuResetHard: "Reset --hard to here",
    menuCreateTag: "Create tag here…",
    menuCreateBranch: "Create branch here…",
    menuCopySha: "Copy SHA",
    menuCopyMessage: "Copy message",
    menuDeleteTag: "Delete tag",
    menuDeleteBranch: "Delete branch",
    menuForceDeleteBranch: "Force delete branch",
    tagModalTitle: "Create Tag",
    tagNameLabel: "Tag name",
    tagMessageLabel: "Message (optional — annotated tag)",
    branchModalTitle: "Create Branch",
    branchNameLabel: "Branch name",
    modalConfirm: "Create",
    modalCancel: "Cancel",
    confirmCherryPickTitle: (hash: string) => `Cherry-pick commit ${hash}?`,
    confirmCherryPickMessage: (hash: string) => `Copies the changes from commit ${hash} and applies them onto your current branch as a new commit. The original commit stays where it is. If the changes conflict, you'll need to resolve them manually.`,
    confirmCherryPickBtn: "Cherry-pick",
    confirmDeleteTagTitle: (name: string) => `Delete tag ${name}?`,
    confirmDeleteTagMessage: (name: string) => `Deletes the tag ${name}. A tag is just a bookmark pointing at a commit — removing it doesn't affect any commit or your code.`,
    confirmDeleteTagBtn: "Delete tag",
    confirmDeleteBranchTitle: (name: string) => `Delete branch ${name}?`,
    confirmDeleteBranchMessage: (name: string) => `Deletes the branch ${name}. If this branch hasn't been merged elsewhere, git will block it to warn you (so you don't lose work).`,
    confirmDeleteBranchBtn: "Delete branch",
    confirmForceDeleteBranchTitle: (name: string) => `Force delete branch ${name}?`,
    confirmForceDeleteBranchMessage: (name: string) => `⚠️ FORCE-deletes the branch ${name} even if it hasn't been merged. Any commits that exist only on this branch may be lost. Please be sure.`,
    confirmForceDeleteBranchBtn: "Force delete",
    toastCherryPicked: "Cherry-pick applied to current branch.",
    toastTagCreated: (name: string) => `Tag ${name} created.`,
    toastBranchCreatedAt: (name: string) => `Branch ${name} created and checked out.`,
    toastCopiedSha: "Commit SHA copied to clipboard.",
    toastCopiedMessage: "Commit message copied to clipboard.",
    toastCopyFailed: "Copy failed.",
    toastTagDeleted: (name: string) => `Tag ${name} deleted.`,
    toastBranchDeleted: (name: string) => `Branch ${name} deleted.`,
```

在 `translations` 的 `zh` 區塊加入：

```typescript
    menuCheckout: "Checkout 到這個 commit",
    menuCherryPick: "Cherry-pick 到目前分支",
    menuRevert: "Revert 這個 commit",
    menuResetSoft: "Reset --soft 到這裡",
    menuResetHard: "Reset --hard 到這裡",
    menuCreateTag: "在這裡打 tag…",
    menuCreateBranch: "從這裡開分支…",
    menuCopySha: "複製 SHA",
    menuCopyMessage: "複製訊息",
    menuDeleteTag: "刪除 tag",
    menuDeleteBranch: "刪除分支",
    menuForceDeleteBranch: "強制刪除分支",
    tagModalTitle: "建立 Tag",
    tagNameLabel: "Tag 名稱",
    tagMessageLabel: "訊息（選填 — 會建立 annotated tag）",
    branchModalTitle: "建立分支",
    branchNameLabel: "分支名稱",
    modalConfirm: "建立",
    modalCancel: "取消",
    confirmCherryPickTitle: (hash: string) => `Cherry-pick commit ${hash}？`,
    confirmCherryPickMessage: (hash: string) => `會把 commit ${hash} 的變更「複製」一份套用到你目前的分支，產生一個新的 commit。原本的 commit 不會被移動。如果內容有衝突，需要你手動解決。`,
    confirmCherryPickBtn: "Cherry-pick",
    confirmDeleteTagTitle: (name: string) => `刪除 tag ${name}？`,
    confirmDeleteTagMessage: (name: string) => `會刪除標籤 ${name}。標籤只是指向某個 commit 的書籤，刪掉它不會影響任何 commit 或程式碼。`,
    confirmDeleteTagBtn: "刪除 tag",
    confirmDeleteBranchTitle: (name: string) => `刪除分支 ${name}？`,
    confirmDeleteBranchMessage: (name: string) => `會刪除分支 ${name}。如果這個分支的內容還沒被合併到別的分支，git 會擋下來提醒你（避免遺失工作）。`,
    confirmDeleteBranchBtn: "刪除分支",
    confirmForceDeleteBranchTitle: (name: string) => `強制刪除分支 ${name}？`,
    confirmForceDeleteBranchMessage: (name: string) => `⚠️ 會「強制」刪除分支 ${name}，即使它還沒被合併。這個分支上只存在於它身上、還沒合併的 commit 可能會遺失。請確認。`,
    confirmForceDeleteBranchBtn: "強制刪除",
    toastCherryPicked: "已 cherry-pick 到目前分支。",
    toastTagCreated: (name: string) => `已建立 tag ${name}。`,
    toastBranchCreatedAt: (name: string) => `已建立並切換到分支 ${name}。`,
    toastCopiedSha: "已複製 commit SHA 到剪貼簿。",
    toastCopiedMessage: "已複製 commit 訊息到剪貼簿。",
    toastCopyFailed: "複製失敗。",
    toastTagDeleted: (name: string) => `已刪除 tag ${name}。`,
    toastBranchDeleted: (name: string) => `已刪除分支 ${name}。`,
```

- [ ] **Step 4: 強化現有確認文案（自然語言）**

在 `translations` 兩區塊，把既有的這幾個 key 的值替換為自然語言版本。

en：
```typescript
    confirmCheckoutMessage: "Switches your working copy to this commit to inspect it (detached HEAD) — you won't be on any branch. New commits made here can be lost unless you create a branch to keep them.",
    confirmHardResetMessage: "⚠️ Moves your current branch back to this commit and DISCARDS every commit after it as well as any uncommitted changes. This cannot be undone — please be sure.",
    confirmSoftResetMessage: "Moves your current branch back to this commit, but keeps all your working changes and staged files. Often used to re-shape recent commits.",
    confirmRevertMessage: "Creates a new commit that undoes the changes from this commit — like reversing what it did. History is kept intact, so this is a safe way to undo.",
```

zh：
```typescript
    confirmCheckoutMessage: "會切換到這個 commit 的狀態來檢視（detached HEAD）——你會暫時不在任何分支上。在這個狀態下做的新 commit，要記得另外開分支才能保存，否則可能會遺失。",
    confirmHardResetMessage: "⚠️ 會把目前分支移回這個 commit，並且「丟棄」這個 commit 之後的所有 commit，以及尚未提交的改動。這個動作無法復原，請確認。",
    confirmSoftResetMessage: "會把目前分支的指標移回這個 commit，但你工作區和已 stage 的檔案改動都會保留下來。常用來把後面幾個 commit 重新整理成一個。",
    confirmRevertMessage: "會新增一個 commit 來「抵銷」這個 commit 的變更，等於把它做的事反向做一次。歷史會完整保留，是安全的還原方式。",
```

> 註：若 `confirmRevertMessage` 在現有 translations 不存在，新增它；若存在則覆寫。執行時搜尋確認。

- [ ] **Step 5: 移除 Workspace Actions 按鈕區**

在 commit inspector 面板找到 `{t.workspaceActions}` 的 `<h5>` 與其外層 `<div>`（內含 Checkout / Reset --hard / Reset --soft / Revert 四顆按鈕的整個區塊），刪除整段。保留上方詳情 grid 與下方「更動的檔案」清單。

- [ ] **Step 6: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。若刪除 Workspace Actions 後 `handleGitReset`/`handleGitRevert` 暫時未被使用，會在 Task 9 重新接上——本步驟結束時若 tsc 因未使用報錯（本專案 tsconfig 不開 noUnusedLocals，預期不報），可忽略。

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add context-menu i18n, state and remove workspace actions panel"
```

---

## Task 9: App.tsx — commit 右鍵選單與建立/複製 handlers

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 新增 handlers**

在其他 handler 附近（如 `handleGitReset` 之後）加入：

```typescript
  const handleCherryPick = (commit: CommitNode) => {
    requestConfirm(
      t.confirmCherryPickTitle(commit.hash),
      t.confirmCherryPickMessage(commit.hash),
      async () => {
        try {
          const res = await fetch("/api/git/cherry-pick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commit: commit.hash }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Cherry-pick failed");
          showToast(t.toastCherryPicked);
          refreshState();
        } catch (err: any) {
          showToast(err.message, true);
        }
      },
      t.confirmCherryPickBtn,
      "bg-amber-600 hover:bg-amber-500"
    );
  };

  const handleCreateTag = async (commit: CommitNode, name: string, message: string) => {
    try {
      const res = await fetch("/api/git/tag/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, commit: commit.hash, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create tag");
      showToast(t.toastTagCreated(name));
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleCreateBranchAt = async (commit: CommitNode, name: string) => {
    try {
      const res = await fetch("/api/git/branch/create-at", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, commit: commit.hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create branch");
      showToast(t.toastBranchCreatedAt(name));
      setSelectedCommit(null);
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleCopy = async (text: string, kind: "sha" | "message") => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(kind === "sha" ? t.toastCopiedSha : t.toastCopiedMessage);
    } catch {
      showToast(t.toastCopyFailed, true);
    }
  };
```

- [ ] **Step 2: 組裝 commit 選單項目**

在 component 內（return 之前）加入一個建構選單項目的函式：

```typescript
  const buildCommitMenuItems = (commit: CommitNode): CommitContextMenuItem[] => [
    {
      key: "checkout",
      label: t.menuCheckout,
      onSelect: () => requestConfirm(
        t.confirmCheckoutTitle(commit.hash),
        t.confirmCheckoutMessage,
        async () => {
          setIsActionLoading(true);
          try {
            const res = await fetch("/api/git/branch/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: commit.hash }),
            });
            if (!res.ok) throw new Error("Hard checkout error");
            showToast(t.toastCheckedOut(commit.hash));
            setSelectedCommit(null);
            refreshState();
          } catch (err: any) {
            showToast(err.message, true);
          } finally {
            setIsActionLoading(false);
          }
        },
        t.confirmCheckoutBtn,
        "bg-amber-600 hover:bg-amber-500"
      ),
    },
    { key: "cherry", label: t.menuCherryPick, onSelect: () => handleCherryPick(commit) },
    {
      key: "revert",
      label: t.menuRevert,
      onSelect: () => requestConfirm(
        t.confirmRevertTitle(commit.hash),
        t.confirmRevertMessage,
        () => handleGitRevert(commit.hash),
        t.confirmRevertBtn,
        "bg-purple-600 hover:bg-purple-500"
      ),
    },
    {
      key: "soft",
      label: t.menuResetSoft,
      dividerBefore: true,
      onSelect: () => requestConfirm(
        t.confirmSoftResetTitle(commit.hash),
        t.confirmSoftResetMessage,
        () => handleGitReset(commit.hash, "soft"),
        t.confirmSoftResetBtn,
        "bg-cyan-600 hover:bg-cyan-500"
      ),
    },
    {
      key: "hard",
      label: t.menuResetHard,
      danger: true,
      onSelect: () => requestConfirm(
        t.confirmHardResetTitle(commit.hash),
        t.confirmHardResetMessage,
        () => handleGitReset(commit.hash, "hard"),
        t.confirmHardResetBtn,
        "bg-rose-600 hover:bg-rose-500"
      ),
    },
    { key: "tag", label: t.menuCreateTag, dividerBefore: true, onSelect: () => setInputModal({ mode: "tag", commit }) },
    { key: "branch", label: t.menuCreateBranch, onSelect: () => setInputModal({ mode: "branch", commit }) },
    { key: "copysha", label: t.menuCopySha, dividerBefore: true, onSelect: () => handleCopy(commit.hash, "sha") },
    { key: "copymsg", label: t.menuCopyMessage, onSelect: () => handleCopy(commit.message, "message") },
  ];
```

> 註：`t.toastCheckedOut`、`t.confirmCheckoutTitle/Btn`、`t.confirmRevertTitle/Btn`、`t.confirmSoftResetTitle/Btn`、`t.confirmHardResetTitle/Btn` 均為既有 key（取自原 Workspace Actions 按鈕）。

- [ ] **Step 3: 把 onCommitContextMenu 傳給 GitGraph**

在 `<GitGraph ... />` 的 props 加入：

```typescript
              onCommitContextMenu={(commit, x, y) => setContextMenu({ commit, x, y })}
```

- [ ] **Step 4: 渲染 CommitContextMenu 與 CommitInputModal**

在 App return 的最外層容器內（靠近 `<AiSettingsModal ... />` 的位置）加入：

```typescript
      {contextMenu && (
        <CommitContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildCommitMenuItems(contextMenu.commit)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {inputModal?.mode === "tag" && (
        <CommitInputModal
          open
          title={t.tagModalTitle}
          fields={[
            { key: "name", label: t.tagNameLabel, placeholder: "v1.0.0", required: true },
            { key: "message", label: t.tagMessageLabel, multiline: true },
          ]}
          confirmLabel={t.modalConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={(values) => {
            const commit = inputModal.commit;
            setInputModal(null);
            handleCreateTag(commit, values.name.trim(), (values.message ?? "").trim());
          }}
          onClose={() => setInputModal(null)}
        />
      )}

      {inputModal?.mode === "branch" && (
        <CommitInputModal
          open
          title={t.branchModalTitle}
          fields={[{ key: "name", label: t.branchNameLabel, placeholder: "feature/my-branch", required: true }]}
          confirmLabel={t.modalConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={(values) => {
            const commit = inputModal.commit;
            setInputModal(null);
            handleCreateBranchAt(commit, values.name.trim());
          }}
          onClose={() => setInputModal(null)}
        />
      )}
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire commit context menu, create-tag/branch and copy actions"
```

---

## Task 10: App.tsx — ref 右鍵選單與刪除 handlers

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 新增刪除 handlers**

在其他 handler 附近加入：

```typescript
  const handleDeleteTag = (name: string) => {
    requestConfirm(
      t.confirmDeleteTagTitle(name),
      t.confirmDeleteTagMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/tag/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to delete tag");
          showToast(t.toastTagDeleted(name));
          refreshState();
        } catch (err: any) {
          showToast(err.message, true);
        }
      },
      t.confirmDeleteTagBtn,
      "bg-rose-600 hover:bg-rose-500"
    );
  };

  const handleDeleteBranch = (name: string, force: boolean) => {
    requestConfirm(
      force ? t.confirmForceDeleteBranchTitle(name) : t.confirmDeleteBranchTitle(name),
      force ? t.confirmForceDeleteBranchMessage(name) : t.confirmDeleteBranchMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/branch/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, force }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to delete branch");
          showToast(t.toastBranchDeleted(name));
          refreshState();
        } catch (err: any) {
          showToast(err.message, true);
        }
      },
      force ? t.confirmForceDeleteBranchBtn : t.confirmDeleteBranchBtn,
      "bg-rose-600 hover:bg-rose-500"
    );
  };
```

- [ ] **Step 2: 組裝 ref 選單項目**

在 component 內（return 之前）加入：

```typescript
  const buildRefMenuItems = (refName: string, kind: string): CommitContextMenuItem[] => {
    if (kind === "tag") {
      return [{ key: "deltag", label: `${t.menuDeleteTag} ${refName}`, danger: true, onSelect: () => handleDeleteTag(refName) }];
    }
    // branch
    return [
      { key: "delbranch", label: `${t.menuDeleteBranch} ${refName}`, onSelect: () => handleDeleteBranch(refName, false) },
      { key: "forcedel", label: `${t.menuForceDeleteBranch} ${refName}`, danger: true, onSelect: () => handleDeleteBranch(refName, true) },
    ];
  };
```

- [ ] **Step 3: 把 onRefContextMenu 傳給 GitGraph**

在 `<GitGraph ... />` 的 props 加入：

```typescript
              onRefContextMenu={(ref, x, y) => setRefMenu({ refName: ref.name, kind: ref.kind, x, y })}
```

- [ ] **Step 4: 渲染 ref 選單**

在剛剛 commit 選單渲染處旁邊加入：

```typescript
      {refMenu && (
        <CommitContextMenu
          x={refMenu.x}
          y={refMenu.y}
          items={buildRefMenuItems(refMenu.refName, refMenu.kind)}
          onClose={() => setRefMenu(null)}
        />
      )}
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire ref context menu for deleting tags and branches"
```

---

## Task 11: 手動測試（驗收 gate）

**Files:** 無程式改動。

> 需啟動 app（`npm run tauri dev`）並在一個有多個分支/tag 的 repo 操作。所有 git 寫入操作須實際測過才算完成。

- [ ] **Step 1: 啟動**

Run: `npm run tauri dev`
Expected: app 開啟、開一個 git repo，線圖正常顯示。

- [ ] **Step 2: 線圖標籤裝飾**

操作：觀察 commit 列。
Expected：當前分支顯示 emerald HEAD chip、其他本地分支 cyan、tag amber（含 tag 圖示）、remote 灰色。顏色與類型正確。

- [ ] **Step 3: 右鍵呼出選單**

操作：右鍵 commit 節點圓點，及右鍵 commit 列。
Expected：游標位置浮出選單；點外面 / 按 Esc / 再右鍵都會關閉；選單不超出視窗。

- [ ] **Step 4: 自然語言確認**

操作：依序點 Checkout、Reset --soft、Reset --hard、Revert、Cherry-pick。
Expected：每個都跳出含白話說明的確認 dialog（reset --hard / force 有 ⚠️）；取消不執行、確認才執行並 refresh。

- [ ] **Step 5: Cherry-pick**

操作：在分支 A，右鍵分支 B 上的一個 commit → Cherry-pick → 確認。
Expected：目前分支多一個新 commit。製造衝突情境再試一次 → 紅色 toast 顯示 git 衝突訊息。

- [ ] **Step 6: 建立 tag（有/無訊息）**

操作：右鍵 commit → 在這裡打 tag → 只填名稱 / 填名稱+訊息。
Expected：lightweight / annotated tag 建立成功，refresh 後線圖出現 amber tag chip；重名時紅色 toast。

- [ ] **Step 7: 從 commit 開分支**

操作：右鍵 commit → 從這裡開分支 → 填名稱。
Expected：建立並切換到新分支，HEAD chip 移到該 commit；重名時 toast 報錯。

- [ ] **Step 8: 複製**

操作：Copy SHA / Copy message → 貼到別處驗證。
Expected：剪貼簿內容正確，toast 提示已複製。

- [ ] **Step 9: 刪除 tag / 分支**

操作：右鍵 tag chip → Delete tag；右鍵 branch chip → Delete branch（已合併）/ Force delete（未合併）。
Expected：刪除成功 chip 消失；安全刪除未合併分支被 git 擋並 toast；force 成功；嘗試刪目前分支被 git 拒並 toast。

- [ ] **Step 10: 確認面板**

操作：選一個 commit。
Expected：下方面板無 Workspace Actions 按鈕，仍顯示詳情 + 更動檔案 + diff。

- [ ] **Step 11: 全部通過後勾完本任務**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 cherry-pick / tag create / branch-at | Task 2 |
| §4.1 tag delete / branch delete | Task 3 |
| §4.1 git_log %d 解析 refs + GitRef | Task 1 |
| §4.2 shim 5 路由 | Task 4 |
| §4.3 CommitContextMenu | Task 5 |
| §4.3 CommitInputModal | Task 6 |
| §4.3 GitGraph 右鍵 + ref chip | Task 7 |
| §4.3 App state / handlers / 移除面板 | Task 8, 9, 10 |
| §4.4 選單 9 項與順序 | Task 9 Step 2 |
| §4.5 自然語言確認（含刪除） | Task 8 Step 3/4, Task 9, Task 10 |
| §5 檔案清單（types.ts、i18n） | Task 7, 8 |
| §7 測試矩陣 | Task 11 |

**型別一致性：** `GitRef{name,kind}`（Rust）↔ `refs:{name,kind}[]`（TS）一致；`CommitContextMenuItem` / `CommitInputModal` props 在 Task 5/6 定義、Task 9/10 使用，命名一致；API 路由與 body 欄位（commit/name/message/force）在 Task 2-4 與 Task 9-10 一致。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。

**已知相依：** Task 8 移除 Workspace Actions 後，`handleGitReset`/`handleGitRevert` 在 Task 9 重新由選單引用（本專案 tsconfig 未開 noUnusedLocals，中間狀態不報錯）。
