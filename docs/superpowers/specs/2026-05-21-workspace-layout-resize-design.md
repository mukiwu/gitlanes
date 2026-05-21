# 工作區三橫欄 layout 與 resize handle 設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-21 |
| 範圍 | 主工作區改為上下三橫欄（Commit 線圖 / 工作區 / Terminal），新增 3 條可拖拉 resize handle；Terminal 面板先做占位，PTY 留給 Spec B |
| 預估工時 | 約半個工作天（含手動測試） |
| 後續 | Spec B（另開）：嵌入 xterm.js + PTY 後端，把 Terminal placeholder 換成真 terminal |

---

## 1. 背景與動機

目前主工作區是上下兩段：上半 Commit 線圖（固定 43% 高度）、下半工作區（CodeEditor 內部寫死「左 files / 右 editor」兩欄）。使用者無法拖拉調整：

- 工作區內 **files 列 / editor** 之間的寬度。
- 線圖 / 工作區 之間的高度。
- 也沒有可內嵌的 Terminal 區。

目標：把主工作區改成**上下三橫欄**（Commit 線圖 / 工作區 / Terminal），加入 **3 條 resize handle** 讓使用者調整各段大小；Terminal 區本次只做**面板容器 + 收合**，內容用 placeholder 佔位，Spec B 再接 PTY。

---

## 2. 目標

- 主工作區改為三橫欄：**Commit 線圖** ↕ **工作區（內含 files | editor）** ↕ **Terminal**
- 三條 resize handle：
  1. 線圖 ↔ 工作區（水平 handle，拖動改線圖高度）
  2. 工作區內 files ↔ editor（垂直 handle，拖動改 files 欄寬度）
  3. 工作區 ↔ Terminal（水平 handle，拖動改 Terminal 高度）
- Handle 樣式：**永遠顯示的細條**（4 px、hover/active 變亮）、對應 `cursor: row-resize / col-resize`。
- Terminal 面板**預設收合**：只顯示一條底部 bar；點擊展開，預設高度 240 px。
- 各 split 尺寸**寫入 localStorage**，重開保留。
- Spec B 之後會把 Terminal 內容區的 placeholder 換成 xterm.js + PTY；本 spec 只負責容器、收合、與 resize。
- 中英 i18n。

---

## 3. 不做（YAGNI）

- **PTY / xterm.js 整合**：留給 Spec B。
- Terminal 多 tab 或多會話。
- 把 split 比例同步到雲端 / 跨裝置。
- 工具列拖拉重排面板（不做 dockable）。
- 上下三欄的折疊（除了 Terminal 預設收合外，線圖與工作區不提供收合按鈕）。

---

## 4. 架構

### 4.1 新元件 `src/components/Resizer.tsx`

通用 resize handle，水平/垂直共用。

```typescript
interface ResizerProps {
  orientation: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;   // 每次 pointermove 觸發，遞增量
  onResizeEnd?: () => void;              // 釋放時觸發（用來 persist 到 localStorage）
}
```

行為：
- 在 element 上監聽 `onPointerDown` → `setPointerCapture` → 監聽 `pointermove`/`pointerup`。
- `pointermove` 計算自上次的 delta（`current - last`），呼叫 `onResize(delta)`；垂直 handle 用 `clientX`，水平 handle 用 `clientY`。
- `pointerup` 釋放 capture、呼叫 `onResizeEnd`。
- 拖動期間在 `document.body` 加 class（`select-none cursor-row-resize` 或 `cursor-col-resize`），釋放時移除——避免拖到一半變成選取文字。

樣式：
- 水平：`h-1 w-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-row-resize transition-colors`
- 垂直：`w-1 h-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-col-resize transition-colors`

### 4.2 App.tsx layout 改動

#### state（新）

```typescript
const [graphHeight, setGraphHeight] = useState<number>(() =>
  Number(localStorage.getItem("gitlanes.layout.graphHeight")) || 360
);
const [terminalHeight, setTerminalHeight] = useState<number>(() =>
  Number(localStorage.getItem("gitlanes.layout.terminalHeight")) || 240
);
const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(
  localStorage.getItem("gitlanes.layout.terminalOpen") === "true"
);
const [workspaceFilesWidth, setWorkspaceFilesWidth] = useState<number>(() =>
  Number(localStorage.getItem("gitlanes.layout.filesWidth")) || 280
);
```

#### 鉗制函式

```typescript
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// 拖動時呼叫：
const onGraphResize = (dy: number) => setGraphHeight(h => clamp(h + dy, 180, /* dynamic max calculated against container */));
// onResizeEnd 時 persist：
const persistGraph = () => localStorage.setItem("gitlanes.layout.graphHeight", String(graphHeight));
```

實際的 max 用 `containerRef.current?.clientHeight` 算（減去 terminal、其他固定高度與 padding），允許使用者把單一面板拖到接近滿版但保留最小高度給其他面板。

最小值：
- `graphHeight` ≥ 180、`terminalHeight`（展開時）≥ 160、工作區隱含最小高度 220（透過動態 max 控制）。
- `workspaceFilesWidth` ≥ 200 且 ≤ 容器寬度 − 280。

#### 主工作區 JSX 結構

把既有 `<div className="flex-1 flex flex-col p-4 overflow-hidden gap-4">` 內容改成：

```typescript
<div className="flex-1 flex flex-col overflow-hidden">
  {/* Top: Commit graph — fixed pixel height */}
  <div style={{ height: graphHeight }} className="min-h-[180px] shrink-0">
    <GitGraph ... />
  </div>

  {/* Resizer A: graph ↔ workspace */}
  <Resizer
    orientation="horizontal"
    onResize={(dy) => setGraphHeight(h => clamp(h + dy, 180, maxGraph))}
    onResizeEnd={persistGraph}
  />

  {/* Middle: workspace (DiffViewer / CodeEditor / commit inspector) — flex-1 */}
  <div className="flex-1 min-h-[220px] overflow-hidden">
    {/* existing isWorkspaceOpen / diffTarget / selectedCommit branches */}
    ...
    {/* CodeEditor: pass filesPanelWidth + onFilesPanelResize callbacks */}
    <CodeEditor
      ...existing props
      filesPanelWidth={workspaceFilesWidth}
      onFilesPanelResize={(dx) => setWorkspaceFilesWidth(w => clamp(w + dx, 200, maxFiles))}
      onFilesPanelResizeEnd={persistFilesWidth}
    />
  </div>

  {/* Resizer B: workspace ↔ terminal (only when terminal open) */}
  {isTerminalOpen && (
    <Resizer
      orientation="horizontal"
      onResize={(dy) => setTerminalHeight(h => clamp(h - dy, 160, maxTerminal))}
      onResizeEnd={persistTerminal}
    />
  )}

  {/* Bottom: terminal panel (collapsed = 32px bar; expanded = bar + content) */}
  <TerminalPanel
    open={isTerminalOpen}
    height={terminalHeight}
    onToggle={() => setIsTerminalOpen(v => !v)}
    labels={{ title: t.terminal, expand: t.expandTerminal, collapse: t.collapseTerminal }}
  />
</div>
```

> 注意：`dy` 的符號——拖動 Resizer A 向下 = 線圖高度增加，所以 `h + dy`；拖動 Resizer B 向下 = terminal 高度**減少**，所以 `h - dy`。

### 4.3 `TerminalPanel`（新元件，src/components/TerminalPanel.tsx）

```typescript
interface TerminalPanelProps {
  open: boolean;
  height: number; // 展開時內容區的 px 高度
  onToggle: () => void;
  labels: { title: string; expand: string; collapse: string };
}
```

結構：
- 32 px 高的標題列（永遠顯示）：左邊 `▸ Terminal` 標題、右邊「展開/收合」按鈕。
- 展開時，下方加 `height` px 的內容區：暫放 placeholder「Terminal will live here (PTY integration in next spec)」。
- 點標題列或展開鈕 → `onToggle()` → App 更新 `isTerminalOpen`。
- 切換時把新值寫進 `localStorage.setItem("gitlanes.layout.terminalOpen", String(open))`。

Spec B 之後把 placeholder div 換成 `<XTermView />` 即可，介面不變。

### 4.4 `CodeEditor` 改動

`src/components/CodeEditor.tsx` 加兩個可選 prop：

```typescript
interface CodeEditorProps {
  ...existing
  filesPanelWidth?: number;             // 預設 280
  onFilesPanelResize?: (deltaPx: number) => void;
  onFilesPanelResizeEnd?: () => void;
}
```

內部把寫死 layout（files 列 + editor）改為：

```typescript
<div className="flex h-full">
  <div style={{ width: filesPanelWidth ?? 280 }} className="shrink-0 min-w-[200px] border-r border-slate-900 overflow-y-auto">
    {/* existing files list */}
  </div>

  {onFilesPanelResize && (
    <Resizer
      orientation="vertical"
      onResize={onFilesPanelResize}
      onResizeEnd={onFilesPanelResizeEnd}
    />
  )}

  <div className="flex-1 min-w-[280px] overflow-hidden">
    {/* existing editor area */}
  </div>
</div>
```

讀檔案結構時請對齊現有的 className/結構；本 spec 只規定外層三段（files / resizer / editor），內部既有元素保留。

### 4.5 i18n

en：
```typescript
terminal: "Terminal",
expandTerminal: "Expand terminal",
collapseTerminal: "Collapse terminal",
```

zh：
```typescript
terminal: "終端機",
expandTerminal: "展開終端機",
collapseTerminal: "收合終端機",
```

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| 元件 | `src/components/Resizer.tsx`（新檔） | 通用 resize handle |
| 元件 | `src/components/TerminalPanel.tsx`（新檔） | Terminal 容器與收合 |
| 元件 | `src/components/CodeEditor.tsx` | 加 `filesPanelWidth` / `onFilesPanelResize` prop；內部 layout 套用 |
| 整合 | `src/App.tsx` | 移除既有「線圖 43% / 工作區 + CLI（已先前移除）」結構；改三段 + 3 resizer + TerminalPanel；4 個 localStorage-backed state |
| i18n | `src/App.tsx`（translations） | terminal / expandTerminal / collapseTerminal |

---

## 6. 錯誤處理 / 邊界

- localStorage 讀到 NaN（壞值）→ fallback 預設。
- 視窗整體變小，使儲存的 graphHeight / filesWidth 超過合理上限：拖動時的 max 用容器即時尺寸計算（`containerRef.current.clientHeight/clientWidth`），自然鉗制；不額外做「resize 視窗即重算」（避免複雜，下次拖動就會自動收進範圍）。
- 拖動期間滑鼠移出視窗：`pointercapture` 保留事件，移到視窗外仍能正確接 `pointerup`。

---

## 7. 測試與驗收（手動）

| 場景 | 預期 |
|---|---|
| 啟動 app | 三段 layout 正常；Terminal 預設收合（只見 32px bar）；線圖預設高度 360 |
| 拖 graph↔workspace handle | 線圖高度變化；放開後重新整理 / 重開 app 仍保留 |
| 拖 files↔editor handle | files 欄寬度變化；持久化 |
| 展開 Terminal | bar 下方出現 240 px 內容區（placeholder）；icon 變收合方向；持久化 |
| 拖 workspace↔terminal handle（terminal 展開時） | terminal 高度變化；持久化 |
| 各 split 拖到極限 | 受最小值鉗制（線圖 ≥180、files ≥200、terminal ≥160），不會塌掉 |
| 拖動中游標 | row-resize / col-resize；放開後恢復 |

---

## 8. 待釐清項目

- Resizer 的 `cursor` 套在 body 上會短暫覆寫畫面所有元素的游標——這是預期行為（VSCode、Chrome DevTools 也是這樣），確保拖動體驗一致。
- Spec B（PTY）會把 `TerminalPanel` 的 placeholder 替換為 xterm.js 容器；本 spec 的 `height` prop 與 `onToggle` 介面屆時保持不變，避免 B 需要動 App layout 程式碼。
