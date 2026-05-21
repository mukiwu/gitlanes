# 嵌入式 PTY Terminal 設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-22 |
| 範圍 | 把 `TerminalPanel` 的 placeholder 換成完整互動式 PTY terminal（VSCode 等級）：xterm.js 前端 + portable-pty 後端，跑使用者系統的 `$SHELL`，可跑 vim/htop、Ctrl-C 中斷、resize 跟隨 |
| 預估工時 | 約 1–1.5 個工作天（含手動測試） |
| 前置 | 建立在 main 之上（Spec A 已 merge）；本工作在分支 `feat/terminal-pty` 進行 |

---

## 1. 背景與動機

Spec A 把工作區改成上下三橫欄並預留了 `TerminalPanel`，內容區暫放 placeholder「Terminal will live here (PTY integration in next spec)」。本 spec 完成這塊：把 placeholder 換成真正互動式 PTY，讓使用者能在 app 內：

- 跑常用 git/構建/檔案系統指令，不必跳出去用外部 terminal。
- 跑互動 TUI（vim、less、`git rebase -i`、`htop` 等）。
- 用 Ctrl-C / Ctrl-D / Ctrl-L 等控制鍵；Cmd-C/V 走系統剪貼簿。
- 看 ANSI 色碼與進度更新（cargo / npm）。
- shell 行為與終端機尺寸保持一致（`stty size`、reflow 正確）。

---

## 2. 目標

- 後端用 [`portable-pty`](https://crates.io/crates/portable-pty) crate 開真正的 PTY，spawn 使用者系統的 `$SHELL`（fallback `/bin/zsh`）。
- 前端用 [`@xterm/xterm`](https://www.npmjs.com/package/@xterm/xterm) 嵌入、`@xterm/addon-fit` 自動 reflow、`@xterm/addon-web-links` 讓 URL 可點。
- stdin / stdout / resize 透過 Tauri events / commands 串接。
- **單一 session**：同時只跑一個 shell（多 tab 留給未來）。
- 初始 **cwd = 目前 repo 根目錄**。
- **切 repo 自動殺舊開新** shell（用 `key={workspacePath}` 強制 React remount）。
- **shell 退出**（使用者輸入 `exit` 或 process crash）→ 顯示「(process exited)」訊息；不自動重啟，使用者收合再展開即可重啟。
- **app 關閉 → 結束 shell**（SIGHUP child，不留孤兒 process）。
- Ctrl-C / Ctrl-D / Ctrl-L / Ctrl-U / Ctrl-W 等控制鍵全部正常送入 PTY；Cmd-C / Cmd-V 走系統剪貼簿。
- xterm 主題對齊 app 的 Vitesse Dark Soft 配色。
- 中英 i18n（terminal exited 訊息、可能的錯誤 toast）。

---

## 3. 不做（YAGNI）

- 多 tab / 多 session（並列開多個 shell）。
- Session 跨重啟保留（app 關閉 → 結束 shell；下次重開是新的）。
- Terminal 設定 UI（字型、字體大小、theme、shell 選擇）—— 全部硬寫合理預設，下版要才加。
- Search-in-terminal、scrollback 匯出。
- `bracketed paste` 偵測之外的特殊輸入模式自定。
- Shell hyperlinks（OSC 8）—— xterm 預設不開，本次不啟用。
- Windows 支援（目前 GitLanes 主要對 macOS；portable-pty 跨平台理論可行，但本次只在 macOS 驗收）。

---

## 4. 架構

```
┌──────── XTermView (React) ────────┐         ┌─────── SessionManager (Rust) ───┐
│  xterm.js + FitAddon + WebLinks   │         │  Arc<Mutex<Option<Session>>>     │
│                                    │  cmd    │                                  │
│  term.onData ─── invoke ─────────┼────────►│ terminal_write(bytes)            │
│                                    │         │   └─► PTY master writer          │
│  ResizeObserver ─ invoke ─────────┼────────►│ terminal_resize(cols, rows)      │
│                                    │         │   └─► PTY master.resize()        │
│                                    │         │                                  │
│  listen("terminal:data") ◄────────┼─event───┤ reader thread:                   │
│    term.write(bytes)               │         │   read master → emit data       │
│                                    │         │                                  │
│  mount → invoke terminal_start ────┼────────►│ spawn $SHELL in cwd              │
│  unmount → invoke terminal_kill ───┼────────►│ SIGHUP child + clear state       │
└────────────────────────────────────┘         └──────────────────────────────────┘
```

### 4.1 後端（Rust）

#### 依賴
`src-tauri/Cargo.toml` 加：
```toml
portable-pty = "0.8"
base64 = "0.22"
```
（`base64` 用來把 PTY 的二進位輸出安全包成 JSON 字串送過 IPC——直接送 UTF-8 字串會在多 byte 字元邊界 panic。stdin 反向亦同。）

#### 新模組 `src-tauri/src/terminal.rs`

```rust
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

pub struct SessionManager {
    inner: Mutex<Option<Session>>,
}

impl SessionManager {
    pub fn new() -> Self { Self { inner: Mutex::new(None) } }

    pub fn start(&self, app: AppHandle, cwd: &str) -> Result<(), String> {
        // Kill any previous session first.
        self.kill();

        let pty = native_pty_system();
        let pair = pty.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        // Launch as login shell so the user's normal env is loaded.
        cmd.arg("-l");
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // Slave handle no longer needed after spawn.
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        // Reader thread: forward bytes to frontend.
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
            // Reader EOF = shell exited.
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
            sess.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn kill(&self) {
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(mut sess) = guard.take() {
            // Best-effort: kill the child; reader thread will EOF and self-terminate.
            let _ = sess.child.kill();
            let _ = sess.child.wait();
        }
    }
}
```

#### Tauri commands（加在 `lib.rs`）

```rust
mod terminal;

#[tauri::command]
async fn terminal_start(app: AppHandle, state: State<'_, Arc<terminal::SessionManager>>, cwd: String) -> Result<(), String> {
    if cwd.trim().is_empty() {
        return Err("cwd is required".to_string());
    }
    state.start(app, cwd.trim())
}

#[tauri::command]
async fn terminal_write(state: State<'_, Arc<terminal::SessionManager>>, data: String) -> Result<(), String> {
    state.write(&data)
}

#[tauri::command]
async fn terminal_resize(state: State<'_, Arc<terminal::SessionManager>>, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(cols, rows)
}

#[tauri::command]
async fn terminal_kill(state: State<'_, Arc<terminal::SessionManager>>) -> Result<(), String> {
    state.kill();
    Ok(())
}
```

`run()` 中 `app.manage(Arc::new(terminal::SessionManager::new()));` 並把 4 個 command 加進 `generate_handler![...]`。

#### App 結束時清理
在 Tauri 的 `setup` 或 `on_window_event(CloseRequested)` 中呼叫 `SessionManager::kill()` 確保關 app 時 shell 結束、不留孤兒。

### 4.2 Tauri shim 路由

不增加 fetch shim 路由——直接用 Tauri `invoke`（前端 xterm 元件需要這個底層 API），保持與既有 `/api/...` shim 的職責分離（shim 適合一次性 request/response、terminal 是雙向串流）。

### 4.3 前端

#### 依賴
`package.json` 加：
```json
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0",
"@xterm/addon-web-links": "^0.11.0"
```

#### 新元件 `src/components/XTermView.tsx`

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
  exitedLabel: string; // i18n "(process exited)"
}

// Vitesse Dark Soft palette
const THEME = {
  background: "#0f172a",     // matches bg-slate-950
  foreground: "#cbd5e1",
  cursor: "#22d3ee",
  selectionBackground: "#1e293b",
  // ANSI colors aligned with the app's accent set
  black: "#0f172a", red: "#cb7676", green: "#4d9375",
  yellow: "#dbd7caee", blue: "#6394bf", magenta: "#d3869b",
  cyan: "#5eaab5", white: "#cdd6f4",
  brightBlack: "#475569", brightRed: "#e09b9b",
  brightGreen: "#7ab399", brightYellow: "#f0e7c7",
  brightBlue: "#8fb6d6", brightMagenta: "#e0a4b8",
  brightCyan: "#8cc0c9", brightWhite: "#f1f5f9",
};

const utf8ToBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const base64ToUtf8 = (b64: string) => {
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

    let killed = false;
    const encoder = new TextEncoder();

    // Pipe stdin → backend
    const onData = term.onData((d) => {
      invoke("terminal_write", { data: utf8ToBase64(encoder.encode(d)) }).catch(() => {});
    });

    // Listen for stdout from backend
    const unlistenDataP = listen<string>("terminal:data", (e) => {
      term.write(base64ToUtf8(e.payload));
    });
    const unlistenExitP = listen("terminal:exit", () => {
      term.writeln(`\r\n\x1b[2;90m${exitedLabel}\x1b[0m`);
    });

    // Start the shell, then fit and report initial size
    invoke("terminal_start", { cwd }).then(() => {
      fit.fit();
      invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    }).catch((err) => {
      term.writeln(`\x1b[31m[terminal] ${String(err)}\x1b[0m`);
    });

    // Reflow on container resize
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
      } catch { /* container hidden */ }
    });
    ro.observe(hostRef.current);

    return () => {
      killed = true;
      ro.disconnect();
      onData.dispose();
      unlistenDataP.then((u) => u());
      unlistenExitP.then((u) => u());
      invoke("terminal_kill").catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  return <div ref={hostRef} className="h-full w-full bg-slate-950" />;
};
```

#### App.tsx 整合

把 `TerminalPanel` 的 placeholder 內容換成 `<XTermView />`。Spec A 預留的介面（`open`, `height`, `onToggle`, `labels`）不動——只是把內部 placeholder 換成元件。`XTermView` 用 `key={workspacePath}` 來強制 unmount/remount，達成「切 repo 自動殺舊開新」。

```tsx
// In TerminalPanel content area (replacing the placeholder span):
{workspacePath ? (
  <XTermView key={workspacePath} cwd={workspacePath} exitedLabel={t.terminalExited} />
) : (
  <span className="text-[12px] font-mono text-slate-600 italic px-4">
    {t.terminalNoRepo}
  </span>
)}
```

> 注意：`TerminalPanel` 目前不知道 `workspacePath`——本 spec 會把 `XTermView` 的渲染從 `TerminalPanel` 內部抽到 App.tsx，TerminalPanel 維持「殼」、接收 children 或在內部直接接 props。簡單做法：`TerminalPanel` 新增 optional `children?: ReactNode` 渲染在內容區，由 App.tsx 傳入 `<XTermView />`。

#### i18n
```typescript
// en
terminalExited: "(process exited — collapse and expand to restart)",
terminalNoRepo: "Open a repository to start the terminal.",
// zh
terminalExited: "(shell 已結束 — 收合再展開可重新啟動)",
terminalNoRepo: "請先開啟 repository。",
```

### 4.4 Repo 切換時的行為

`key={workspacePath}` 讓 `XTermView` 在 workspacePath 變動時整個 unmount/remount：cleanup function 呼叫 `terminal_kill` → 新 effect 呼叫 `terminal_start(newCwd)`。與「殺舊 shell、開新的在新 repo」需求一致。

### 4.5 App 關閉時

Tauri 的 `setup` 內訂閱 main window 的 `WindowEvent::CloseRequested`：呼叫 `state.kill()`（`SessionManager`）。`portable-pty` 的 `Child::kill` 會發 SIGKILL（macOS 直接終結），shell 被殺後 reader thread EOF 結束。

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust | `src-tauri/Cargo.toml` | 加 `portable-pty = "0.8"` 與 `base64 = "0.22"` |
| Rust | `src-tauri/src/terminal.rs`（新檔） | `Session` / `SessionManager` |
| Rust | `src-tauri/src/lib.rs` | `mod terminal;`、`app.manage(...)`、4 個 command、window close hook、註冊 invoke_handler |
| 前端 | `package.json` | 加 `@xterm/xterm` / `@xterm/addon-fit` / `@xterm/addon-web-links` |
| 前端元件 | `src/components/XTermView.tsx`（新檔） | xterm 嵌入、IPC、resize、cleanup |
| 前端整合 | `src/components/TerminalPanel.tsx` | 內容區從寫死 placeholder 改為支援 `children` |
| 前端整合 | `src/App.tsx` | 將 `<XTermView key={workspacePath} cwd={workspacePath} ... />` 作為 `TerminalPanel` 的 children；補 i18n |

---

## 6. 錯誤處理 / 邊界

- `terminal_start` 失敗（找不到 shell / spawn error）：command 回 Err；前端把錯誤 inline 印在 xterm 紅字。
- Shell 自然退出（`exit`）/ 被 kill：reader 讀到 EOF → emit `terminal:exit` → xterm 印「(process exited — collapse and expand to restart)」灰字；後端 state 不自動清，下次 unmount/remount 才會清。
- 工作區未開 repo（`workspacePath` 為空）：不渲染 `XTermView`，顯示「請先開啟 repository」灰字。
- IPC 失敗（極少見）：xterm 紅字提示，不 crash app。
- Base64 編解碼確保二進位 / 多 byte UTF-8 安全。

---

## 7. 測試與驗收（手動，macOS）

| 場景 | 預期 |
|---|---|
| 開 app、展開 Terminal | 看到 `$SHELL` prompt（zsh 預設），`pwd` 顯示目前 repo 根 |
| `ls` / `git status` / `node -v` | 正常輸出，ANSI 色碼正確 |
| Ctrl-C 中斷 `sleep 10` | 立即中斷、回到 prompt |
| 跑 `vim ~/.zshrc` 進去、`:q` 離開 | 全螢幕 TUI 正常進入離開 |
| `git rebase -i HEAD~3` | 互動式 rebase 編輯器能正常使用 |
| Cmd-C / Cmd-V | 系統剪貼簿正常運作 |
| 拖 terminal 高度 / resize 視窗 | shell reflow 正確，`stty size` 反映新尺寸 |
| 切到別的 repo | 舊 shell 結束、在新 repo 開新 shell（`pwd` 顯示新路徑） |
| 在 terminal 輸入 `exit` | 出現「(process exited — collapse and expand to restart)」訊息 |
| 收合再展開 terminal | 重啟 shell |
| 關閉 app | 沒有孤兒 shell process（`ps aux \| grep zsh` 不該有 app 啟動的殘留） |
| 中文輸入 / 中文輸出 | 不亂碼（UTF-8 透過 base64 完整傳遞） |

---

## 8. 待釐清項目

- macOS bundled app（非 dev mode）的 entitlement：spawn 子行程不需特殊權限，但 sandbox 啟用時要關閉或加入適當 entitlement。Tauri 預設未啟用 sandbox，本次預期無問題；遇到再處理。
- portable-pty 的 cargo build 依賴 `pkg-config`／系統 lib：在 macOS 開發機上預設可用。CI 之後若加 Linux/Windows 建置需確認。
- xterm.js 字型顯示寬度（CJK 字元）對 PTY 認知的 cols 不一致可能導致游標漂移：使用內建邏輯，遇到再評估是否引入 `unicode11` addon。
