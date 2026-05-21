# 嵌入式 PTY Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `TerminalPanel` 的 placeholder 換成完整互動式 PTY terminal（VSCode 等級）：`portable-pty` 後端 + `xterm.js` 前端，能跑 vim/htop、Ctrl-C 中斷、跟隨 resize、Cmd-C/V 走系統剪貼簿。

**Architecture:** 後端新增 `terminal` 模組（`Session` + `SessionManager` 全局 state），spawn 使用者系統 `$SHELL` 在 repo cwd，stdin/stdout 透過 base64 + Tauri events 雙向串。前端新增 `XTermView` 元件，使用 `@xterm/xterm` + FitAddon + WebLinksAddon；以 `key={workspacePath}` 強制 remount 達成「切 repo 自動殺舊開新」。app 關閉時 SIGKILL child 避免孤兒。

**Tech Stack:** Rust (Tauri 2, portable-pty 0.8, base64 0.22), TypeScript/React, `@xterm/xterm` 5.5。

**驗收紀律：** PTY 行為依賴真實系統 shell，無法單元測；走 `cargo build` + `npx tsc --noEmit` + 手動測試矩陣（Task 8，含 vim/Ctrl-C/中文/resize/切 repo/關 app）。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/Cargo.toml` | 加 `portable-pty`、`base64` 依賴 | Modify |
| `src-tauri/src/terminal.rs` | `Session` / `SessionManager`：PTY 開關、stdin 寫入、reader thread、resize、kill | Create |
| `src-tauri/src/lib.rs` | `mod terminal;`、`app.manage(...)`、4 個 command、window close hook、註冊 invoke_handler | Modify |
| `package.json` | 加 xterm 三個套件 | Modify |
| `src/components/XTermView.tsx` | xterm 嵌入、IPC、ResizeObserver、cleanup | Create |
| `src/components/TerminalPanel.tsx` | 內容區改成支援 `children`（取代寫死 placeholder） | Modify |
| `src/App.tsx` | TerminalPanel 內塞 `<XTermView key={workspacePath} cwd={workspacePath} ... />`；補 i18n | Modify |

**型別契約（跨任務一致）：**

- Rust：`pub struct Session { master, writer, child }`；`pub struct SessionManager { inner: Mutex<Option<Session>> }`。
- Commands：`terminal_start(cwd: String)`、`terminal_write(data: String /* base64 */)`、`terminal_resize(cols: u16, rows: u16)`、`terminal_kill()`。
- Events：`terminal:data` payload = base64-encoded utf-8 bytes from PTY；`terminal:exit` payload = `()`。
- TS：`XTermViewProps { cwd: string; exitedLabel: string }`。

---

## Task 1: Cargo 依賴 + terminal 模組骨架

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/terminal.rs`
- Modify: `src-tauri/src/lib.rs`（加 `mod terminal;`）

- [ ] **Step 1: 加 Cargo 依賴**

在 `src-tauri/Cargo.toml` `[dependencies]` 區塊（在 `keyring = ...` 那行附近）加入：

```toml
portable-pty = "0.8"
base64 = "0.22"
```

- [ ] **Step 2: 建立 terminal.rs 骨架**

建立 `src-tauri/src/terminal.rs`：

```rust
use std::io::Write;
use std::sync::Mutex;

use portable_pty::{Child, MasterPty};

pub struct Session {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

pub struct SessionManager {
    pub inner: Mutex<Option<Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn kill(&self) {
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(mut sess) = guard.take() {
            let _ = sess.child.kill();
            let _ = sess.child.wait();
        }
    }
}
```

> 注意：本 task 只放骨架（含 `kill`），`start` / `write` / `resize` 在 Task 2 加入，避免單一 commit 過大。

- [ ] **Step 3: 在 lib.rs 註冊模組**

在 `src-tauri/src/lib.rs` 第 14 行 `mod ai_settings;` 之後加：

```rust
mod terminal;
```

- [ ] **Step 4: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功（portable-pty 與 base64 下載並建置）。dead_code 警告對 `Session.master/.writer` 與 `SessionManager.inner` 是預期的（後續 task 接上），但 `Sync` bound 在 `Box<dyn Child + Send + Sync>` 可能讓 portable-pty 的 `Child` 對不上——若 cargo 報「the trait `Sync` is not implemented for `dyn Child`」，把 trait bound 改為 `Box<dyn Child + Send>` 即可（portable-pty 的 `Child` 只保證 Send）。Sync 不需要因為 Mutex 已序列化存取。也跑 `cargo test ref_tests`（expect 3 pass）確認既有測試未壞。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/terminal.rs src-tauri/src/lib.rs
git commit -m "feat: scaffold terminal module with portable-pty dependency"
```

---

## Task 2: SessionManager start / write / resize 實作

**Files:**
- Modify: `src-tauri/src/terminal.rs`

- [ ] **Step 1: 換掉 imports 並補上完整實作**

把 `src-tauri/src/terminal.rs` **整個替換**成：

```rust
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

pub struct Session {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
}

pub struct SessionManager {
    pub inner: Mutex<Option<Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn start(&self, app: AppHandle, cwd: &str) -> Result<(), String> {
        // Kill any previous session first.
        self.kill();

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        // Login shell so the user's normal env (rc files) is loaded.
        cmd.arg("-l");
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // Slave handle no longer needed after spawn.
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        // Reader thread: forward bytes to frontend as base64.
        let app_handle = app.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let encoded = B64.encode(&buf[..n]);
                        let _ = app_handle.emit("terminal:data", encoded);
                    }
                    Err(_) => break,
                }
            }
            let _ = app_handle.emit("terminal:exit", ());
        });

        let mut guard = self.inner.lock().expect("session mutex poisoned");
        *guard = Some(Session { master: pair.master, writer, child });
        Ok(())
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let bytes = B64.decode(data).map_err(|e| e.to_string())?;
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(sess) = guard.as_mut() {
            sess.writer.write_all(&bytes).map_err(|e| e.to_string())?;
            sess.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(sess) = guard.as_ref() {
            sess.master
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn kill(&self) {
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(mut sess) = guard.take() {
            let _ = sess.child.kill();
            let _ = sess.child.wait();
        }
    }
}
```

- [ ] **Step 2: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功。dead_code 警告對 `start` / `write` / `resize` 是預期（Task 3 才接 commands）。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/terminal.rs
git commit -m "feat: implement PTY session start, write, resize"
```

---

## Task 3: Tauri commands + state + window close hook

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: import Arc**

在 `src-tauri/src/lib.rs` 頂部 `std::{...}` import 區塊加入 `Arc`：

```rust
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
```

- [ ] **Step 2: 新增 4 個 command**

在 `lib.rs` 任一 commands 區（例如 `git_status` 之前或最後一個既有 command 之後）加入：

```rust
#[tauri::command]
async fn terminal_start(
    app: tauri::AppHandle,
    state: State<'_, Arc<terminal::SessionManager>>,
    cwd: String,
) -> Result<(), String> {
    if cwd.trim().is_empty() {
        return Err("cwd is required".to_string());
    }
    state.start(app, cwd.trim())
}

#[tauri::command]
async fn terminal_write(
    state: State<'_, Arc<terminal::SessionManager>>,
    data: String,
) -> Result<(), String> {
    state.write(&data)
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, Arc<terminal::SessionManager>>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(cols, rows)
}

#[tauri::command]
async fn terminal_kill(state: State<'_, Arc<terminal::SessionManager>>) -> Result<(), String> {
    state.kill();
    Ok(())
}
```

- [ ] **Step 3: manage state + window close hook**

找到 `pub fn run()` 內的 `.setup(|app| { ... })`。把它整段替換成：

```rust
        .setup(|app| {
            app.manage(AppState {
                repo_path: Mutex::new(None),
                git_history: Mutex::new(Vec::new()),
            });
            let session_manager = Arc::new(terminal::SessionManager::new());
            app.manage(session_manager.clone());

            // Kill any active shell when the main window closes, so we don't leak orphans.
            if let Some(window) = app.get_webview_window("main") {
                let sm = session_manager.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        sm.kill();
                    }
                });
            }
            Ok(())
        })
```

> 注意：`get_webview_window` 與 `WindowEvent::CloseRequested` 是 Tauri 2 API。若 main window 的 label 不是 `"main"`，從 `src-tauri/tauri.conf.json` 確認；GitLanes 預設應該是 `main`。

- [ ] **Step 4: 註冊 commands**

在 `tauri::generate_handler![...]` 清單末尾（`ai_test_connection` 之後）加入：

```rust
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_kill
```

> 注意：若上一行（`ai_test_connection`）沒有結尾逗號，要先加上逗號。

- [ ] **Step 5: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功，無 dead_code 警告（4 個 command 都有被 generate_handler 引用）。`cargo test ref_tests` 仍 3 pass。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register terminal Tauri commands and SIGHUP on window close"
```

---

## Task 4: 前端 xterm 套件依賴

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安裝套件**

Run: `npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links`
Expected: 三個套件加進 `dependencies`。

- [ ] **Step 2: 確認安裝**

Run: `npm ls @xterm/xterm @xterm/addon-fit @xterm/addon-web-links 2>&1 | head`
Expected: 列出三者版本，無 missing。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @xterm/xterm + fit + web-links dependencies"
```

> 注意：lockfile 名稱可能是 `package-lock.json` 或 `bun.lock`/`bun.lockb`，按專案實際使用的包管理器（README/既有 lock 檔判定）add 正確檔案。

---

## Task 5: XTermView 元件

**Files:**
- Create: `src/components/XTermView.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/XTermView.tsx`：

```typescript
import React, { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface XTermViewProps {
  cwd: string;
  exitedLabel: string;
}

// Vitesse Dark Soft palette — aligned with the rest of the app.
const THEME = {
  background: "#0f172a",
  foreground: "#cbd5e1",
  cursor: "#22d3ee",
  selectionBackground: "#1e293b",
  black: "#0f172a",
  red: "#cb7676",
  green: "#4d9375",
  yellow: "#dbd7caee",
  blue: "#6394bf",
  magenta: "#d3869b",
  cyan: "#5eaab5",
  white: "#cdd6f4",
  brightBlack: "#475569",
  brightRed: "#e09b9b",
  brightGreen: "#7ab399",
  brightYellow: "#f0e7c7",
  brightBlue: "#8fb6d6",
  brightMagenta: "#e0a4b8",
  brightCyan: "#8cc0c9",
  brightWhite: "#f1f5f9",
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export const XTermView: React.FC<XTermViewProps> = ({ cwd, exitedLabel }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      theme: THEME,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);

    const encoder = new TextEncoder();

    // stdin → backend
    const onData = term.onData((d) => {
      invoke("terminal_write", { data: bytesToBase64(encoder.encode(d)) }).catch(() => {});
    });

    // stdout / exit ← backend
    const unlistenDataP = listen<string>("terminal:data", (e) => {
      term.write(base64ToBytes(e.payload));
    });
    const unlistenExitP = listen("terminal:exit", () => {
      term.writeln(`\r\n\x1b[2;90m${exitedLabel}\x1b[0m`);
    });

    // Start the shell, then fit to container and report initial size.
    invoke("terminal_start", { cwd })
      .then(() => {
        try {
          fit.fit();
          invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
        } catch {
          // container hidden / sized 0; will catch up on next ResizeObserver tick.
        }
      })
      .catch((err) => {
        term.writeln(`\x1b[31m[terminal] ${String(err)}\x1b[0m`);
      });

    // Reflow on container resize.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
      } catch {
        // ignore
      }
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      onData.dispose();
      unlistenDataP.then((u) => u()).catch(() => {});
      unlistenExitP.then((u) => u()).catch(() => {});
      invoke("terminal_kill").catch(() => {});
      term.dispose();
    };
  }, [cwd, exitedLabel]);

  return <div ref={hostRef} className="h-full w-full bg-slate-950" />;
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。元件尚未被引用（Task 7 接上），不會報未使用（tsconfig 沒開 noUnusedLocals）。

- [ ] **Step 3: Commit**

```bash
git add src/components/XTermView.tsx
git commit -m "feat: add XTermView component with PTY IPC and resize reflow"
```

---

## Task 6: TerminalPanel 改成支援 children

**Files:**
- Modify: `src/components/TerminalPanel.tsx`

- [ ] **Step 1: 加 children prop 並改寫內容區**

把 `src/components/TerminalPanel.tsx` 整個替換成：

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
  children?: React.ReactNode;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ open, height, onToggle, labels, children }) => {
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
          className="bg-slate-950 border-t border-slate-800/60 overflow-hidden"
        >
          {children}
        </div>
      )}
    </div>
  );
};
```

> 變動：
> - 加 optional `children: React.ReactNode` prop。
> - 內容區的 `flex items-center justify-center` 移除（讓 children 自己決定 layout）。
> - 寫死的 placeholder span 由 children 取代——本 task 不附 fallback，由 App.tsx Task 7 負責「未開 repo 時顯示提示」。

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。既有 App.tsx 對 TerminalPanel 的呼叫沒傳 children → optional prop 預設 undefined → 內容區為空 div（暫時）；Task 7 會補。

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalPanel.tsx
git commit -m "feat: let TerminalPanel render arbitrary children in content area"
```

---

## Task 7: App.tsx 整合 — XTermView + i18n

**Files:**
- Modify: `src/App.tsx`

**Read `src/App.tsx` first** — focus on the existing `<TerminalPanel ... />` usage and the `translations` en/zh blocks.

- [ ] **Step 1: import XTermView**

在 App.tsx 既有的 component imports 旁加：

```typescript
import { XTermView } from "./components/XTermView";
```

- [ ] **Step 2: 加 i18n keys（en 與 zh 兩區塊，鍵集相同）**

en 區塊加：
```typescript
    terminalExited: "(process exited — collapse and expand to restart)",
    terminalNoRepo: "Open a repository to start the terminal.",
```
zh 區塊加：
```typescript
    terminalExited: "(shell 已結束 — 收合再展開可重新啟動)",
    terminalNoRepo: "請先開啟 repository。",
```

- [ ] **Step 3: 在 TerminalPanel 內塞 XTermView**

找到 `<TerminalPanel ... />`。把它從 self-closing 改為 wrapping，內塞依 `workspacePath` 決定的內容：

舊：
```tsx
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
```

新：
```tsx
            <TerminalPanel
              open={isTerminalOpen}
              height={terminalHeight}
              onToggle={toggleTerminal}
              labels={{
                title: t.terminal,
                expand: t.expandTerminal,
                collapse: t.collapseTerminal,
              } satisfies TerminalPanelLabels}
            >
              {workspacePath ? (
                <XTermView
                  key={workspacePath}
                  cwd={workspacePath}
                  exitedLabel={t.terminalExited}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[12px] font-mono text-slate-600 italic px-4 text-center">
                    {t.terminalNoRepo}
                  </span>
                </div>
              )}
            </TerminalPanel>
```

> 關鍵：`key={workspacePath}` 讓 React 在切 repo 時整個 unmount/remount XTermView → cleanup 呼叫 `terminal_kill` → 新 effect 呼叫 `terminal_start(newCwd)`。這就是「切 repo 殺舊開新」的機制。

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount XTermView inside TerminalPanel with repo-keyed remount"
```

---

## Task 8: 手動測試（驗收 gate）

**Files:** 無程式改動。

> 需 `npm run tauri dev`（**重啟**載入 Rust 改動）+ 一個 repo 來開。

- [ ] **Step 1: 啟動 + 展開 terminal**

操作：開 app、開 repo、點底部 Terminal bar 展開。
Expected：看到 `$SHELL` prompt；`pwd` 顯示 repo 根路徑；提示符與顏色正常。

- [ ] **Step 2: 基本指令**

操作：`ls`、`git status`、`node -v`（若有）。
Expected：輸出正常、ANSI 顏色正確。

- [ ] **Step 3: Ctrl-C 中斷**

操作：`sleep 30`，按 Ctrl-C。
Expected：立即中斷、回到 prompt（^C 顯示）。

- [ ] **Step 4: 互動式 TUI（vim）**

操作：`vim ~/.zshrc`（或任一檔），按 i 進編輯、Esc、`:q`。
Expected：全螢幕 TUI 正常進入/離開；游標位置正確。

- [ ] **Step 5: git rebase -i**

操作：`git rebase -i HEAD~3`（注意目前在的分支，可隨手 `git rebase --abort`）。
Expected：互動式 rebase 編輯器（用 vim/$EDITOR）正常開啟、能離開。

- [ ] **Step 6: 系統剪貼簿**

操作：選取 terminal 內文字 → Cmd-C；游標到 prompt → Cmd-V。
Expected：剪貼簿運作正常（Cmd-C 複製、Cmd-V 貼上）。

- [ ] **Step 7: 中文輸入 / 輸出**

操作：`echo "你好世界"`。
Expected：完整顯示，不亂碼。

- [ ] **Step 8: Resize 跟隨**

操作：拖 terminal 高度、resize 整個視窗。
Expected：shell reflow；在 terminal 跑 `stty size` 確認 cols/rows 反映新尺寸。

- [ ] **Step 9: 切換 repo**

操作：在 sidebar 切到別的 repo。
Expected：terminal 自動重啟，`pwd` 顯示新 repo 路徑。

- [ ] **Step 10: shell 退出**

操作：在 terminal 輸入 `exit`。
Expected：出現灰色「(shell 已結束 — 收合再展開可重新啟動)」訊息。

- [ ] **Step 11: 重啟 shell**

操作：點 Terminal bar 收合 → 再展開。
Expected：新 shell 啟動、又看到 prompt。

- [ ] **Step 12: 關閉 app 不留孤兒**

操作：關閉 app。在系統 terminal 跑 `ps aux | grep -E "zsh|bash|fish" | grep -v grep`。
Expected：沒有由 GitLanes 啟動的殘留 shell process（注意排除你自己的系統終端 process）。

- [ ] **Step 13: 全部通過後勾完本任務**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 portable-pty + base64 依賴 | Task 1 |
| §4.1 SessionManager（start/write/resize/kill）+ reader thread | Task 1, 2 |
| §4.1 4 Tauri commands | Task 3 |
| §4.1 window close hook（SIGHUP 避免孤兒） | Task 3 Step 3 |
| §4.3 xterm 三套件 | Task 4 |
| §4.3 XTermView 元件 | Task 5 |
| §4.3 TerminalPanel children | Task 6 |
| §4.3 App.tsx 渲染 + key={workspacePath} | Task 7 Step 3 |
| §4.4 切 repo 殺舊開新 | Task 7 Step 3（透過 React `key` 機制） |
| §4.3 i18n（terminalExited / terminalNoRepo） | Task 7 Step 2 |
| §7 測試矩陣（含 vim、Ctrl-C、resize、切 repo、關 app 清理） | Task 8 |

**型別一致性：** Rust `terminal_start(cwd)` / `terminal_write(data)` / `terminal_resize(cols, rows)` / `terminal_kill()` 與前端 `invoke("terminal_start", { cwd })` / `invoke("terminal_write", { data })` 等對齊；events `terminal:data`（base64 string）/ `terminal:exit`（unit）兩端一致；`SessionManager` 用 `Arc<>` 包裝以便同時放進 Tauri state 與 window close closure。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼與明確指令，無 TODO/TBD。

**已知相依：** Task 1 的 `Session.master` 在骨架階段不被讀取，但 `kill` 沒有用 master——只用 child；Task 2 補上 reader 後解掉。`Box<dyn Child + Send>`（移除 `Sync`）在 portable-pty 0.8 是正確簽名（Task 1 Step 4 已標示如何修正）。
