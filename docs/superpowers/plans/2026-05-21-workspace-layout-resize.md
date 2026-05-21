# 工作區三橫欄 layout 與 resize handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主工作區改成上下三橫欄（線圖 / 工作區 / Terminal），加 3 條 resize handle（永遠顯示細條）、Terminal 預設收合用 placeholder 佔位，各 split 尺寸寫入 localStorage 重啟保留。

**Architecture:** 新增通用 `Resizer` 元件（水平/垂直共用，pointer capture + delta-based）與 `TerminalPanel`（收合 bar + placeholder 內容區）。App.tsx 用 4 個 localStorage-backed state 控制三段尺寸與 terminal 開合；CodeEditor 加可選 prop 讓 files 欄寬度由 App 控制並接 vertical resizer。PTY 真正接入留給 Spec B（同介面）。

**Tech Stack:** React + TypeScript + Tailwind（無新後端、無新 npm 依賴）。

**前置：** 建立在 `feat/commit-context-menu` 分支之上 — 但依使用者規劃，本 spec 完成後將 **A → merge 到 main → 再開新分支做 Spec B（PTY）**。

**驗收紀律：** 純 UI/layout 改動；走 `npx tsc --noEmit` + 手動驗收（Task 6）。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/components/Resizer.tsx` | 通用 resize handle | Create |
| `src/components/TerminalPanel.tsx` | Terminal 容器、收合 bar、placeholder | Create |
| `src/components/CodeEditor.tsx` | 加 `filesPanelWidth`/`onFilesPanelResize` prop；內部 layout 對應 | Modify |
| `src/App.tsx` | 4 個 layout state、主工作區三橫欄結構、3 個 resizer、TerminalPanel 渲染、i18n | Modify |

**型別契約：**
```typescript
interface ResizerProps {
  orientation: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
}
interface TerminalPanelLabels { title: string; expand: string; collapse: string; }
interface TerminalPanelProps {
  open: boolean;
  height: number;
  onToggle: () => void;
  labels: TerminalPanelLabels;
}
```

**localStorage keys（皆 string）：**
- `gitlanes.layout.graphHeight`（預設 360）
- `gitlanes.layout.terminalHeight`（預設 240）
- `gitlanes.layout.terminalOpen`（"true" / "false"，預設 false）
- `gitlanes.layout.filesWidth`（預設 280）

**最小值常數：**
- graphHeight ≥ 180
- terminalHeight（展開時）≥ 160
- workspaceFilesWidth ≥ 200
- 工作區隱含最小 220（透過動態 max 控制）

---

## Task 1: Resizer 元件

**Files:**
- Create: `src/components/Resizer.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/Resizer.tsx`：

```typescript
import React from "react";

interface ResizerProps {
  orientation: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
}

export const Resizer: React.FC<ResizerProps> = ({ orientation, onResize, onResizeEnd }) => {
  const isHorizontal = orientation === "horizontal";

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = isHorizontal ? e.clientY : e.clientX;

    const cursorClass = isHorizontal ? "cursor-row-resize" : "cursor-col-resize";
    document.body.classList.add(cursorClass, "select-none");

    const move = (ev: PointerEvent) => {
      const current = isHorizontal ? ev.clientY : ev.clientX;
      const delta = current - last;
      last = current;
      if (delta !== 0) onResize(delta);
    };

    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      document.body.classList.remove(cursorClass, "select-none");
      onResizeEnd?.();
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  if (isHorizontal) {
    return (
      <div
        onPointerDown={onPointerDown}
        className="h-1 w-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-row-resize transition-colors shrink-0"
        role="separator"
        aria-orientation="horizontal"
      />
    );
  }
  return (
    <div
      onPointerDown={onPointerDown}
      className="w-1 h-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-col-resize transition-colors shrink-0"
      role="separator"
      aria-orientation="vertical"
    />
  );
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（元件未引用，僅檢查語法/型別）。

- [ ] **Step 3: Commit**

```bash
git add src/components/Resizer.tsx
git commit -m "feat: add generic Resizer component (horizontal/vertical)"
```

---

## Task 2: TerminalPanel 元件（占位）

**Files:**
- Create: `src/components/TerminalPanel.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/TerminalPanel.tsx`：

```typescript
import React from "react";
import { ChevronUp, ChevronDown, TerminalSquare } from "lucide-react";

export interface TerminalPanelLabels {
  title: string;
  expand: string;
  collapse: string;
}

interface TerminalPanelProps {
  open: boolean;
  height: number;
  onToggle: () => void;
  labels: TerminalPanelLabels;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ open, height, onToggle, labels }) => {
  return (
    <div className="flex flex-col shrink-0 border-t border-slate-800">
      {/* Title bar (always shown, 32px tall) */}
      <button
        onClick={onToggle}
        title={open ? labels.collapse : labels.expand}
        className="h-8 flex items-center justify-between px-3 bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
      >
        <span className="flex items-center gap-1.5 text-[12px] font-mono font-bold uppercase tracking-wider text-slate-400">
          <TerminalSquare className="h-3.5 w-3.5" />
          {labels.title}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-500" />}
      </button>

      {/* Content (only when open) */}
      {open && (
        <div
          style={{ height }}
          className="bg-slate-950 border-t border-slate-800/60 overflow-hidden flex items-center justify-center"
        >
          <span className="text-[12px] font-mono text-slate-600 italic px-4 text-center">
            Terminal will live here (PTY integration in next spec)
          </span>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalPanel.tsx
git commit -m "feat: add TerminalPanel container with collapse and placeholder"
```

---

## Task 3: CodeEditor 加可選 filesPanelWidth prop

**Files:**
- Modify: `src/components/CodeEditor.tsx`

**Read `src/components/CodeEditor.tsx` first.** The root JSX is `<div id="code-editor-component" className="flex h-full ...">`, with a fixed-width files panel `<div className="w-[180px] ...">` followed by an editor area. We'll let App.tsx override that width and inject a `Resizer` between them.

- [ ] **Step 1: 加 props**

在 `CodeEditorProps` 介面加：
```typescript
  filesPanelWidth?: number;
  onFilesPanelResize?: (deltaPx: number) => void;
  onFilesPanelResizeEnd?: () => void;
```
在 component 解構參數加：
```typescript
  filesPanelWidth,
  onFilesPanelResize,
  onFilesPanelResizeEnd,
```

- [ ] **Step 2: import Resizer**

在 `src/components/CodeEditor.tsx` 頂部 import 區加：
```typescript
import { Resizer } from "./Resizer";
```

- [ ] **Step 3: 替換 files 欄寬度寫死、插入 Resizer**

找到既有：
```tsx
      <div className="w-[180px] bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 select-none">
```
改成（移除 `w-[180px]`、改為 inline `style.width`、保留其他 class，移除 `border-r`，因為 Resizer 自己有分隔線視覺）：
```tsx
      <div
        style={{ width: filesPanelWidth ?? 180 }}
        className="bg-slate-950 flex flex-col shrink-0 select-none min-w-[200px]"
      >
```

在這個 `<div>` 的閉合標籤之後、editor 區的開始之前，插入 Resizer（只有 App 有給 callback 才渲染）：
```tsx
      {onFilesPanelResize && (
        <Resizer orientation="vertical" onResize={onFilesPanelResize} onResizeEnd={onFilesPanelResizeEnd} />
      )}
```

> 注意：editor 區的開頭是另一個 `<div>`（緊接在 files 欄之後），把上面的 Resizer 插在這之間即可。其他內部結構不動。

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/components/CodeEditor.tsx
git commit -m "feat: allow CodeEditor files panel width to be controlled with resizer"
```

---

## Task 4: App.tsx — state、i18n、import

**Files:**
- Modify: `src/App.tsx`

**Read `src/App.tsx` first.** Existing constants: the main workspace block lives in `<div className="flex-1 flex flex-col p-4 overflow-hidden gap-4">` (around line 2208); the graph wrapper is currently `<div className={isGraphMaximized ? "flex-1 min-h-0" : "h-[43%] min-h-[220px]"}>`; the workspace section is the `<>...</>` fragment under `{!isGraphMaximized && (`.

- [ ] **Step 1: import 新元件**

在 App.tsx 的 component imports 附近加入：
```typescript
import { Resizer } from "./components/Resizer";
import { TerminalPanel, TerminalPanelLabels } from "./components/TerminalPanel";
```

- [ ] **Step 2: 新增 layout state**

在 `isGraphMaximized` state 宣告附近加入：
```typescript
  const [graphHeight, setGraphHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem("gitlanes.layout.graphHeight"));
    return Number.isFinite(v) && v > 0 ? v : 360;
  });
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem("gitlanes.layout.terminalHeight"));
    return Number.isFinite(v) && v > 0 ? v : 240;
  });
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(
    localStorage.getItem("gitlanes.layout.terminalOpen") === "true"
  );
  const [workspaceFilesWidth, setWorkspaceFilesWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("gitlanes.layout.filesWidth"));
    return Number.isFinite(v) && v > 0 ? v : 280;
  });
```

- [ ] **Step 3: 加 layout 鉗制與 persist helpers**

在其他 handler 附近加：
```typescript
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const persistGraphHeight = () => localStorage.setItem("gitlanes.layout.graphHeight", String(graphHeight));
  const persistTerminalHeight = () => localStorage.setItem("gitlanes.layout.terminalHeight", String(terminalHeight));
  const persistFilesWidth = () => localStorage.setItem("gitlanes.layout.filesWidth", String(workspaceFilesWidth));

  const toggleTerminal = () => {
    setIsTerminalOpen((v) => {
      const next = !v;
      localStorage.setItem("gitlanes.layout.terminalOpen", String(next));
      return next;
    });
  };
```

- [ ] **Step 4: 新增 i18n keys（en 與 zh，鍵集相同）**

en 區塊加：
```typescript
    terminal: "Terminal",
    expandTerminal: "Expand terminal",
    collapseTerminal: "Collapse terminal",
```
zh 區塊加：
```typescript
    terminal: "終端機",
    expandTerminal: "展開終端機",
    collapseTerminal: "收合終端機",
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（新 state/import 暫未使用；下一 Task 接上）。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add layout state, helpers and i18n for workspace resize"
```

---

## Task 5: App.tsx — 三橫欄 layout、3 resizer、TerminalPanel 渲染

**Files:**
- Modify: `src/App.tsx`

**Read App.tsx first** to find the main workspace block (around line 2208–2240+).

- [ ] **Step 1: 改寫主工作區結構**

把這段：
```tsx
        <div className="flex-1 flex flex-col p-4 overflow-hidden gap-4">
          
          {/* Top Panel: Git history DAG graph and node analysis */}
          <div className={isGraphMaximized ? "flex-1 min-h-0" : "h-[43%] min-h-[220px]"}>
            <GitGraph ... />
          </div>

          {/* Bottom Panel + CLI 在線圖最大化時整批收起 ... */}
          {!isGraphMaximized && (
          <>
          {/* Bottom Panel: ... */}
          {isWorkspaceOpen ? (
            ...workspace JSX...
          ) : (
            ...collapsed JSX...
          )}
          </>
          )}

        </div>
```
改成：
```tsx
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Top: Commit graph */}
          <div
            style={isGraphMaximized ? undefined : { height: graphHeight }}
            className={isGraphMaximized ? "flex-1 min-h-0 p-4 pb-2" : "shrink-0 min-h-[180px] p-4 pb-2"}
          >
            <GitGraph ... />
          </div>

          {/* Resizer A: graph ↔ workspace (hidden when graph maximized) */}
          {!isGraphMaximized && (
            <Resizer
              orientation="horizontal"
              onResize={(dy) => setGraphHeight((h) => clamp(h + dy, 180, 2000))}
              onResizeEnd={persistGraphHeight}
            />
          )}

          {/* Middle: workspace — only when graph not maximized */}
          {!isGraphMaximized && (
            <div className="flex-1 min-h-[220px] overflow-hidden flex flex-col p-4 pt-2">
              {isWorkspaceOpen ? (
                ...existing workspace JSX (DiffViewer / commit inspector / CodeEditor branches)...
              ) : (
                ...existing collapsed JSX...
              )}
            </div>
          )}

          {/* Resizer B: workspace ↔ terminal (only when graph not maximized AND terminal open) */}
          {!isGraphMaximized && isTerminalOpen && (
            <Resizer
              orientation="horizontal"
              onResize={(dy) => setTerminalHeight((h) => clamp(h - dy, 160, 2000))}
              onResizeEnd={persistTerminalHeight}
            />
          )}

          {/* Bottom: terminal panel (always present so the toggle bar is reachable) */}
          {!isGraphMaximized && (
            <TerminalPanel
              open={isTerminalOpen}
              height={terminalHeight}
              onToggle={toggleTerminal}
              labels={{
                title: t.terminal,
                expand: t.expandTerminal,
                collapse: t.collapseTerminal,
              } satisfies TerminalPanelLabels}
            />
          )}

        </div>
```

> **保留** 既有的 workspace JSX（DiffViewer / 選中 commit 的 inspector / CodeEditor / 收合按鈕分支）— 只把外層容器換成上述新結構。內部如 `<DiffViewer />`、`<CodeEditor ... />` 等不要動（CodeEditor 的 prop 在 Step 2 處理）。

> 拖動方向約定：Resizer A 向下拖 = 線圖變高，故 `h + dy`；Resizer B 向下拖 = terminal 變矮，故 `h - dy`。

> 因為新結構移除了原本 `p-4 ... gap-4` 的 padding，已在每段 wrapper 內各自補 `p-4` 或 `p-4 pt-2/pb-2`，視覺接近原本但 resizer 沒被 padding 阻擋。

- [ ] **Step 2: 把 filesPanelWidth 等傳給 CodeEditor**

找到既有的 `<CodeEditor ... />` 使用（在 workspace JSX 內），新增 props：
```tsx
              <CodeEditor
                files={sandboxFiles}
                activeFile={activeFile}
                onSelectFile={(f) => setActiveFile(f)}
                onFileUpdated={refreshState}
                gitFiles={gitFiles}
                labels={{
                  workspace: t.workspaceTitle,
                  emptyFolder: t.emptyFolder,
                  editorTitle: t.codeEditorTitle,
                  editorHint: t.codeEditorHint,
                }}
                onCollapse={() => setIsWorkspaceOpen(false)}
                collapseTitle={t.collapseWorkspace}
                filesPanelWidth={workspaceFilesWidth}
                onFilesPanelResize={(dx) => setWorkspaceFilesWidth((w) => clamp(w + dx, 200, 800))}
                onFilesPanelResizeEnd={persistFilesWidth}
              />
```
（其他既有 props 保留；只在末尾追加 3 個新 prop。實際 prop 名以檔案中已存在的為準。）

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。若 `TerminalPanelLabels` import 因為 `satisfies` 用法有問題，可改為直接傳 object 不加 `satisfies`，但保持 import 以便型別檢查介面。

- [ ] **Step 4: 視覺快檢**

Run: `npm run tauri dev`（若已開可 HMR）
Expected：
- 啟動後三段 layout 正常。
- 線圖預設 360px 高、terminal bar 在最下面、點 bar 展開後出現 240px 內容區（顯示 placeholder 文字）。
- 拖三個 handle 都能調整對應大小。
- 重整 / 重啟後尺寸保留。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: switch main workspace to 3-row layout with 3 resizers and terminal panel"
```

---

## Task 6: 手動測試（驗收 gate）

**Files:** 無程式改動。

- [ ] **Step 1: 啟動**

Run: `npm run tauri dev`
Expected: 三段 layout 顯示；Terminal 預設收合（只見一條標題列）；線圖高度約 360。

- [ ] **Step 2: 拖 graph ↔ workspace handle**

操作：把 graph/workspace 之間的細條往上/下拖。
Expected：線圖高度即時變化；放開後刷新（或重啟 app）尺寸仍保留。

- [ ] **Step 3: 拖 files ↔ editor handle**

操作：在工作區開啟一個檔案進入 CodeEditor；拖 files / editor 之間的垂直細條。
Expected：files 欄寬度變化；持久化。

- [ ] **Step 4: 展開 / 收合 Terminal**

操作：點底部 Terminal 標題列。
Expected：展開時下方出現 240px 內容區（placeholder 文字）；icon 切換為「向下箭頭」；收合後只剩標題列；持久化。

- [ ] **Step 5: 拖 workspace ↔ terminal handle**

操作：terminal 展開時，拖 workspace / terminal 之間的細條。
Expected：terminal 內容區高度變化；持久化。

- [ ] **Step 6: 邊界鉗制**

操作：把任一 handle 拖到極限。
Expected：受最小值鉗制（graph ≥180、files ≥200、terminal ≥160）；不會塌掉。

- [ ] **Step 7: 游標**

操作：hover 與拖動 handle。
Expected：水平 handle 顯示 `row-resize`、垂直 handle 顯示 `col-resize`；拖動期間游標保持一致、文字不被選取；放開恢復正常。

- [ ] **Step 8: 全部通過後勾完本任務**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 Resizer 元件 | Task 1 |
| §4.3 TerminalPanel 元件 | Task 2 |
| §4.4 CodeEditor 加 filesPanelWidth prop | Task 3 |
| §4.2 App layout state、persist helpers | Task 4 Step 2-3 |
| §4.5 i18n（terminal / expand / collapse） | Task 4 Step 4 |
| §4.2 主工作區三段結構、3 resizer | Task 5 Step 1 |
| §4.2 把 prop 傳給 CodeEditor | Task 5 Step 2 |
| §7 測試矩陣 | Task 6 |

**型別一致性：** Resizer (`orientation`, `onResize`, `onResizeEnd`) 在 Task 1 定義、Task 3/5 使用；TerminalPanel props 與 labels 在 Task 2 定義、Task 5 使用；CodeEditor 新 prop (`filesPanelWidth`/`onFilesPanelResize`/`onFilesPanelResizeEnd`) 在 Task 3 定義、Task 5 傳入；localStorage keys 命名一致。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。

**已知相依：** Task 4 的 state/helpers/import 暫未使用，由 Task 5 接上；tsconfig 不報未使用。
