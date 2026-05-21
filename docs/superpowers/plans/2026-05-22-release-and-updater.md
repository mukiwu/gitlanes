# Release 流程 + Tauri Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立本機一鍵發版的 release 管道（build → notarize → 上傳 GitHub Release），並嵌入 Tauri updater 讓 app 自動探測新版並一鍵安裝；第一個正式發版本為 `v0.1.0`。

**Architecture:** 後端加 `tauri-plugin-updater`、`tauri.conf.json` 設 `endpoints` 指向 GitHub release 的 `latest.json`；前端用 `@tauri-apps/plugin-updater` API + 自家 `UpdateModal`（不用 plugin 內建對話框）。發版用本機 `scripts/release.sh`：`tauri build` 帶簽名 → `xcrun notarytool` 公證 → `stapler` 釘附 → 重新打包重簽 .tar.gz → 產 latest.json → `gh release create`。私鑰存使用者本機 `~/.gitlanes/updater-key.json`，不入 repo。

**Tech Stack:** Rust (Tauri 2 + tauri-plugin-updater v2), TypeScript/React, Bash, Apple xcrun toolchain, GitHub CLI (`gh`)。

**前置：** 在 `feat/release-updater` 分支執行；使用者本機 Keychain 有 Apple Developer ID Application 憑證；`gh auth status` 已登入。

**驗收紀律：** 一次性建置（key、conf）走編譯通過 + 文件清晰；release.sh 用 Task 9 在真實 release `v0.1.0` 走過一遍才算完成；updater UI 走 `npx tsc --noEmit` + 手動 modal 測試 + Task 9 之後拿 `v0.1.0` 安裝模擬發 `v0.1.1` 跑端到端。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src-tauri/Cargo.toml` | 加 `tauri-plugin-updater = "2"` | Modify |
| `src-tauri/src/lib.rs` | builder 鏈加 `.plugin(tauri_plugin_updater::Builder::new().build())` | Modify |
| `src-tauri/tauri.conf.json` | 加 `plugins.updater`（pubkey + endpoints + dialog:false） | Modify |
| `package.json` | version 0.0.0 → 0.1.0；加 `@tauri-apps/plugin-updater` | Modify |
| `.gitignore` | 加 `*.key` / `updater-key*.json` 防誤入 repo | Modify |
| `src/components/UpdateModal.tsx` | 新版提示 modal（風格對齊 CommitInputModal） | Create |
| `src/App.tsx` | 啟動 5 秒背景檢查、齒輪選單入口、modal 渲染、i18n、handlers | Modify |
| `scripts/release.sh` | build → notarize → stapler → re-tar/re-sign → latest.json → gh release | Create |
| `CHANGELOG-NEXT.md` | 第一版 release notes 草稿 | Create |
| `docs/RELEASING.md` | 發版流程說明：env vars、私鑰備份、首次設定、semver | Create |

**型別契約：**
- TS：`UpdateModalProps { open, version, currentVersion, notes, onInstall, onLater, isInstalling, labels }`，`UpdateModalLabels { available, current, notes, viewFullNotes, install, later, installing }`。
- `latest.json` schema：`{ version, pub_date, platforms: { "darwin-aarch64": { signature, url } } }`。
- 簽名 key 路徑（約定）：`~/.gitlanes/updater-key.json`；env：`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`、`TAURI_SIGNING_PRIVATE_KEY`。

---

## Task 1: 後端 — tauri-plugin-updater 依賴與註冊

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 Cargo 依賴**

在 `src-tauri/Cargo.toml` `[dependencies]` 末尾加：

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: 註冊 plugin**

在 `src-tauri/src/lib.rs` 的 `pub fn run()` 內，找到 `tauri::Builder::default()` 後接的 `.plugin(tauri_plugin_dialog::init())`，在它之後加一行：

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
```

完整片段會像：
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
```

- [ ] **Step 3: 編譯**

Run: `cd src-tauri && cargo build`
Expected: 成功（plugin crate 下載並建置）。`cargo test ref_tests`（expect 3 pass）確認既有未壞。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat: add tauri-plugin-updater and register builder"
```

---

## Task 2: 生成 updater signing key + 配置 tauri.conf.json

**Files:**
- Create: `~/.gitlanes/updater-key.json`（本機，不入 repo）
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.gitignore`

- [ ] **Step 1: 生 key**

```bash
mkdir -p ~/.gitlanes
npx @tauri-apps/cli signer generate -w ~/.gitlanes/updater-key.json
```
Expected: stdout 印出 base64 公鑰；`~/.gitlanes/updater-key.json` 與 `~/.gitlanes/updater-key.json.pub` 產出。

**複製公鑰**到剪貼簿備用（指令會印類似 `Public key:` 後面 base64 字串；也可從 `~/.gitlanes/updater-key.json.pub` 讀）。

- [ ] **Step 2: 更新 tauri.conf.json**

把 `src-tauri/tauri.conf.json` 的 `"app"` 區塊與 `"bundle"` 之間加上 `"plugins"`：

```json
  "app": {
    "windows": [
      {
        "title": "GitLanes",
        "width": 1280,
        "height": 820,
        "minWidth": 1024,
        "minHeight": 700
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "<paste-public-key-base64-here>",
      "endpoints": [
        "https://github.com/mukiwu/gitlanes/releases/latest/download/latest.json"
      ],
      "dialog": false
    }
  },
  "bundle": {
```

把 `<paste-public-key-base64-here>` 換成 Step 1 印出來的公鑰 base64。

- [ ] **Step 3: 加 .gitignore**

在 `.gitignore` 末尾加：
```
# Tauri updater signing private key (NEVER commit)
*.key
updater-key*.json
```

- [ ] **Step 4: 確認沒誤入 repo**

```bash
git status
```
Expected：只看到 `src-tauri/tauri.conf.json` 與 `.gitignore` 改動，`~/.gitlanes/*` 完全沒出現（因為在 home 下）。

跑 `cargo build`（updater plugin 會驗 pubkey 格式）。
Expected: 成功；若 pubkey 解析失敗會編譯時報錯。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json .gitignore
git commit -m "feat: configure updater pubkey and GitHub release endpoint"
```

---

## Task 3: 同步 package.json 版號 + JS plugin 依賴

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 改版號**

把 `package.json` 的 `"version": "0.0.0"` 改成 `"version": "0.1.0"`。

- [ ] **Step 2: 裝 JS plugin**

Run: `npm install @tauri-apps/plugin-updater`
Expected: 加入 `dependencies`，lockfile 更新。

- [ ] **Step 3: 驗 install**

```bash
npm ls @tauri-apps/plugin-updater
```
Expected: 列出版本（v2.x），無 missing。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: bump version to 0.1.0 and add plugin-updater JS dep"
```

---

## Task 4: UpdateModal 元件

**Files:**
- Create: `src/components/UpdateModal.tsx`

- [ ] **Step 1: 建立元件**

建立 `src/components/UpdateModal.tsx`：

```typescript
import React from "react";
import { X, Sparkles, Loader2, ExternalLink } from "lucide-react";

export interface UpdateModalLabels {
  available: (version: string) => string;
  current: (version: string) => string;
  notes: string;
  viewFullNotes: string;
  install: string;
  later: string;
  installing: string;
}

interface UpdateModalProps {
  open: boolean;
  version: string;
  currentVersion: string;
  notes: string;
  releaseUrl: string;
  onInstall: () => void;
  onLater: () => void;
  isInstalling: boolean;
  labels: UpdateModalLabels;
}

const NOTES_PREVIEW_CHARS = 600;

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  version,
  currentVersion,
  notes,
  releaseUrl,
  onInstall,
  onLater,
  isInstalling,
  labels,
}) => {
  if (!open) return null;

  const truncated = notes.length > NOTES_PREVIEW_CHARS;
  const preview = truncated ? notes.slice(0, NOTES_PREVIEW_CHARS).trimEnd() + "…" : notes;

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={isInstalling ? undefined : onLater} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            {labels.available(version)}
          </span>
          {!isInstalling && (
            <button onClick={onLater} className="text-slate-400 hover:text-slate-200 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="text-[12px] font-mono text-slate-500">{labels.current(currentVersion)}</div>

          <div>
            <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-slate-500">{labels.notes}</div>
            <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[12px] text-slate-300 whitespace-pre-wrap max-h-[260px] overflow-auto font-sans leading-relaxed">{preview}</pre>
            {(truncated || releaseUrl) && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
              >
                <ExternalLink className="h-3 w-3" />
                {labels.viewFullNotes}
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            onClick={onLater}
            disabled={isInstalling}
            className="rounded px-3 py-1.5 text-[12px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            {labels.later}
          </button>
          <button
            onClick={onInstall}
            disabled={isInstalling}
            className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
          >
            {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isInstalling ? labels.installing : labels.install}
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
git add src/components/UpdateModal.tsx
git commit -m "feat: add UpdateModal component for update prompts"
```

---

## Task 5: App.tsx — i18n + state + import

**Files:**
- Modify: `src/App.tsx`

**Read `src/App.tsx` first** to locate the `translations` en/zh blocks and the settings dropdown (around line 2002, the "AI Settings" button).

- [ ] **Step 1: imports**

加入：
```typescript
import { UpdateModal, UpdateModalLabels } from "./components/UpdateModal";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
```

> 注意：`@tauri-apps/plugin-process` 通常已存在；若 import 失敗執行時 `npm install @tauri-apps/plugin-process` 加入（plugin-updater 用到 relaunch）。在 Task 5 type-check 階段確認。

- [ ] **Step 2: state**

在其他 modal state 旁加：

```typescript
  const [updateState, setUpdateState] = useState<{
    open: boolean;
    version: string;
    notes: string;
    update: Update | null;
    releaseUrl: string;
  }>({ open: false, version: "", notes: "", update: null, releaseUrl: "" });
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
```

- [ ] **Step 3: i18n（en + zh，鍵集相同）**

en 區塊加：
```typescript
    checkForUpdates: "Check for updates…",
    noUpdateAvailable: "You're on the latest version.",
    updateAvailable: (v: string) => `Version ${v} is available`,
    updateCurrent: (v: string) => `Current: ${v}`,
    updateNotes: "Release notes",
    updateFullNotesLink: "View full release notes",
    updateInstall: "Install and restart",
    updateLater: "Later",
    updateInstalling: "Installing…",
    updateFailed: "Update failed",
    updateCheckFailed: "Couldn't check for updates",
```

zh 區塊加：
```typescript
    checkForUpdates: "檢查更新…",
    noUpdateAvailable: "已是最新版本。",
    updateAvailable: (v: string) => `有新版本 ${v}`,
    updateCurrent: (v: string) => `目前：${v}`,
    updateNotes: "更新說明",
    updateFullNotesLink: "查看完整更新說明",
    updateInstall: "安裝並重啟",
    updateLater: "之後再說",
    updateInstalling: "安裝中…",
    updateFailed: "更新失敗",
    updateCheckFailed: "無法檢查更新",
```

- [ ] **Step 4: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 若 `@tauri-apps/plugin-process` 不存在 → tsc 報錯；跑 `npm install @tauri-apps/plugin-process` 並把 `package.json`/lockfile 加進這個 commit。重跑 tsc 應乾淨。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx package.json package-lock.json
git commit -m "feat: add updater state, i18n and dependencies in App"
```

---

## Task 6: App.tsx — handlers + 啟動檢查 + 齒輪選單入口 + modal 渲染

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 加 handlers**

在其他 handler 附近加：

```typescript
  const APP_VERSION = "0.1.0"; // synced with tauri.conf.json; bumped per release

  const checkForUpdate = async (opts?: { silent?: boolean }) => {
    try {
      const update = await check();
      if (update) {
        setUpdateState({
          open: true,
          version: update.version,
          notes: update.body ?? "",
          update,
          releaseUrl: `https://github.com/mukiwu/gitlanes/releases/tag/v${update.version}`,
        });
      } else if (!opts?.silent) {
        showToast(t.noUpdateAvailable);
      }
    } catch (err: unknown) {
      if (!opts?.silent) {
        showToast(err instanceof Error ? err.message : t.updateCheckFailed, true);
      }
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateState.update) return;
    setIsInstalling(true);
    try {
      await updateState.update.downloadAndInstall();
      await relaunch();
    } catch (err: unknown) {
      setIsInstalling(false);
      showToast(err instanceof Error ? err.message : t.updateFailed, true);
    }
  };
```

- [ ] **Step 2: 啟動 5 秒延遲背景檢查**

在既有 `useEffect` 區（例如 `refreshState()` 那個附近）加入新的 useEffect：

```typescript
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdate({ silent: true });
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
```

- [ ] **Step 3: 齒輪選單加「Check for updates…」**

找到 settings dropdown 內「AI Settings」按鈕（`{t.aiSettings}`）。在其後加入新按鈕：

```typescript
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      checkForUpdate({ silent: false });
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 rounded font-mono cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    {t.checkForUpdates}
                  </button>
```

> 注意：上面用 `Sparkles` icon（一致性方便）。若想換成更新專屬 icon（例如 `Download` / `RefreshCw`）也可，但確保已 import。

- [ ] **Step 4: 渲染 UpdateModal**

在 App 的 return 樹中靠近其他 modal（`AiSettingsModal` / `CommitInputModal`）的位置加：

```typescript
      <UpdateModal
        open={updateState.open}
        version={updateState.version}
        currentVersion={APP_VERSION}
        notes={updateState.notes}
        releaseUrl={updateState.releaseUrl}
        onInstall={handleInstallUpdate}
        onLater={() => setUpdateState((s) => ({ ...s, open: false }))}
        isInstalling={isInstalling}
        labels={{
          available: t.updateAvailable,
          current: t.updateCurrent,
          notes: t.updateNotes,
          viewFullNotes: t.updateFullNotesLink,
          install: t.updateInstall,
          later: t.updateLater,
          installing: t.updateInstalling,
        } satisfies UpdateModalLabels}
      />
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire updater background check, manual trigger and modal"
```

---

## Task 7: release.sh + CHANGELOG-NEXT.md

**Files:**
- Create: `scripts/release.sh`
- Create: `CHANGELOG-NEXT.md`

- [ ] **Step 1: 建立 scripts/release.sh**

```bash
mkdir -p scripts
```

建立 `scripts/release.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Read version from tauri.conf.json (single source of truth).
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v${VERSION}"

echo "→ Releasing GitLanes ${TAG}"

# 1. Pre-flight checks
[ -z "${APPLE_ID:-}" ] && { echo "✗ APPLE_ID env not set"; exit 1; }
[ -z "${APPLE_PASSWORD:-}" ] && { echo "✗ APPLE_PASSWORD env not set (use app-specific password)"; exit 1; }
[ -z "${APPLE_TEAM_ID:-}" ] && { echo "✗ APPLE_TEAM_ID env not set"; exit 1; }
[ -f ~/.gitlanes/updater-key.json ] || { echo "✗ Updater private key missing at ~/.gitlanes/updater-key.json"; exit 1; }
[ -f CHANGELOG-NEXT.md ] || { echo "✗ CHANGELOG-NEXT.md missing (write release notes there first)"; exit 1; }
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "✗ Release $TAG already exists on GitHub"
  exit 1
fi

# 2. Build with signing + updater key in env
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.gitlanes/updater-key.json)
echo "→ Building..."
npm run tauri build -- --target aarch64-apple-darwin

APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app"
DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/GitLanes_${VERSION}_aarch64.dmg"
TAR_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app.tar.gz"
SIG_PATH="${TAR_PATH}.sig"

[ -d "$APP_PATH" ] || { echo "✗ Built .app missing at $APP_PATH"; exit 1; }
[ -f "$DMG_PATH" ] || { echo "✗ Built .dmg missing at $DMG_PATH"; exit 1; }
[ -f "$TAR_PATH" ] || { echo "✗ Built .tar.gz missing at $TAR_PATH"; exit 1; }

# 3. Notarize
echo "→ Notarizing (this may take a few minutes)..."
NOTARIZE_ZIP="/tmp/GitLanes-notarize-${VERSION}.zip"
ditto -c -k --keepParent "$APP_PATH" "$NOTARIZE_ZIP"
xcrun notarytool submit "$NOTARIZE_ZIP" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "→ Stapling notarization ticket..."
xcrun stapler staple "$APP_PATH"
xcrun stapler staple "$DMG_PATH"

# 4. Re-tar the stapled .app so the updater downloads the notarized version
echo "→ Re-packaging stapled .app for updater..."
( cd "$(dirname "$APP_PATH")" && tar -czf "$(basename "$TAR_PATH")" "$(basename "$APP_PATH")" )

# Re-sign the new .tar.gz (replaces the .sig produced during initial build)
echo "→ Re-signing tarball..."
npx @tauri-apps/cli signer sign --private-key-path ~/.gitlanes/updater-key.json "$TAR_PATH"

# 5. Generate latest.json
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGNATURE=$(cat "$SIG_PATH")
DOWNLOAD_URL="https://github.com/mukiwu/gitlanes/releases/download/${TAG}/GitLanes.app.tar.gz"
LATEST_JSON="/tmp/latest-${VERSION}.json"

cat > "$LATEST_JSON" <<EOF
{
  "version": "${VERSION}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    }
  }
}
EOF
# Upload uses fixed name "latest.json"
cp "$LATEST_JSON" /tmp/latest.json

# 6. Create release + upload assets
echo "→ Creating GitHub release..."
gh release create "$TAG" \
  --title "GitLanes ${VERSION}" \
  --notes-file CHANGELOG-NEXT.md \
  "$DMG_PATH" \
  "$TAR_PATH" \
  "$SIG_PATH" \
  "/tmp/latest.json"

echo "✅ Released ${TAG}"
echo ""
echo "Next step: rename CHANGELOG-NEXT.md → docs/changelogs/CHANGELOG-${VERSION}.md and start a fresh CHANGELOG-NEXT.md for the following version."
```

設執行權限：
```bash
chmod +x scripts/release.sh
```

- [ ] **Step 2: 建立 CHANGELOG-NEXT.md（第一版 release notes）**

建立 `CHANGELOG-NEXT.md`：

```markdown
# GitLanes 0.1.0 — First Public Release

🎉 GitLanes 的第一個正式版！一個給 macOS 的 Git GUI，內建互動式 terminal 與 AI 助手。

## Highlights

### Commit 線圖
- 互動式 DAG 視覺化，支援分支顯示與 commit 詳情
- 右鍵 commit：Checkout / Cherry-pick / Revert / Reset --soft|--hard / Create Tag / Create Branch here / Copy SHA / Copy message
- 右鍵 branch chip：Checkout / Merge into current / Rename / Copy / Delete / Force delete
- 右鍵 tag chip：Delete tag
- 所有破壞性操作含**自然語言確認對話框**，給不熟 git 的使用者也看得懂

### 同步
- Pull / Push / Fetch 按鈕（網路操作快速失敗、不卡住）
- 工具列分支名旁顯示 ↑n ↓n 領先/落後遠端

### 工作區
- 三段式 layout：Commit 線圖 / 工作區 / 內建 Terminal
- 可拖拉調整每段大小，記憶到 localStorage
- 內嵌 VSCode 等級的互動式 Terminal（基於 xterm.js + portable-pty），跟著系統 `$SHELL`、支援 vim/htop、Ctrl-C 中斷
- 切 repo 自動重啟 terminal 到新路徑

### AI 助手
- 可選 provider：Gemini / OpenAI / Anthropic / Ollama
- API key 存 OS keychain（不寫進磁碟、不外洩）
- AI 解釋 diff、AI 產生 commit message
- Markdown 渲染 + 跟隨 UI 語系（中/英）

### 其他
- 中英雙語介面
- Vitesse Dark Soft 主題
- 線圖列高、字級、配色等細節打磨

## 系統需求

- macOS 11+ (Apple Silicon)
- 已 notarize，雙擊 .dmg 即可使用

## 已知限制

- 目前只發 Apple Silicon (arm64)，Intel Mac 暫不支援
- AI 對話無歷史保留（每次重新提問）
- Terminal 為單一 session、無多分頁
```

- [ ] **Step 3: 不執行 release，只確認檔案就緒**

```bash
ls -la scripts/release.sh CHANGELOG-NEXT.md
```
Expected: 兩個檔案存在；release.sh 有執行權限（`-rwxr-xr-x`）。

> 真正執行 release 在 Task 9。本 task 只建立檔案。

- [ ] **Step 4: Commit**

```bash
git add scripts/release.sh CHANGELOG-NEXT.md
git commit -m "feat: add release.sh and v0.1.0 changelog draft"
```

---

## Task 8: docs/RELEASING.md

**Files:**
- Create: `docs/RELEASING.md`

- [ ] **Step 1: 建立文件**

建立 `docs/RELEASING.md`：

```markdown
# GitLanes Release Guide

本機一鍵發版流程。第一次設定請完整跑「首次設定」一次；之後每次發版只需「升版步驟」。

## 首次設定（一次即可）

### 1. Apple Developer ID

確認 macOS Keychain 內有 Apple Developer ID Application 憑證：
```bash
security find-identity -v -p codesigning
```
應看到 `Developer ID Application: <Your Name> (<TEAM_ID>)`。

### 2. App-specific password

到 https://appleid.apple.com → Sign-In and Security → App-Specific Passwords 產一組（標籤如 `gitlanes-notarize`）。

### 3. 環境變數

把以下加入 `~/.zshrc`（或 `~/.bashrc`）：
```bash
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # app-specific password from step 2
export APPLE_TEAM_ID="ABCDE12345"             # from `security find-identity` output
```
重開 terminal 或 `source ~/.zshrc`。

### 4. Updater signing key

```bash
mkdir -p ~/.gitlanes
npx @tauri-apps/cli signer generate -w ~/.gitlanes/updater-key.json
```
**重要**：把 `~/.gitlanes/updater-key.json` 與 `~/.gitlanes/updater-key.json.pub` 備份到安全位置（密碼管理員、加密硬碟等）。**遺失私鑰 = 無法再發更新給現有使用者**（他們必須手動下載新版）。

公鑰已寫進 `src-tauri/tauri.conf.json`，已在 repo 內，不需備份。

### 5. GitHub CLI

```bash
gh auth status
```
未登入則 `gh auth login`。

---

## 升版步驟

### 1. 改版號

兩處要同步：
- `src-tauri/tauri.conf.json` → `"version"`
- `package.json` → `"version"`
- 若有手動更新前端寫死的 `APP_VERSION`，也一起改（在 `src/App.tsx`）

依 semver 決定 bump：
- **patch**（0.1.0 → 0.1.1）：bug fix
- **minor**（0.1.0 → 0.2.0）：新增功能、相容
- **major**（0.1.0 → 1.0.0）：破壞性變更或正式版宣告

### 2. 寫 release notes

編輯 `CHANGELOG-NEXT.md`，寫這版的更新內容（Markdown，第一行是 H1 標題）。

### 3. Commit 並 push

```bash
git add -A
git commit -m "chore: release v<VERSION>"
git push origin main
```

### 4. 跑 release.sh

```bash
./scripts/release.sh
```

腳本會依序：
1. 檢查 env vars、私鑰、tag 不重複、CHANGELOG-NEXT.md 存在
2. `npm run tauri build -- --target aarch64-apple-darwin`
3. `xcrun notarytool submit --wait`（通常 5–15 分鐘）
4. `xcrun stapler staple` 把公證票釘到 .app 與 .dmg
5. 重新打包 .tar.gz（更新版含公證票）並用私鑰重簽
6. 產 `latest.json`（updater endpoint）
7. `gh release create` 上傳 .dmg / .app.tar.gz / .sig / latest.json

完成後 GitHub release 頁會看到 4 個資產。

### 5. 歸檔 changelog（建議）

```bash
mkdir -p docs/changelogs
mv CHANGELOG-NEXT.md docs/changelogs/CHANGELOG-<VERSION>.md
touch CHANGELOG-NEXT.md  # 開新檔給下版寫
git add -A
git commit -m "chore: archive v<VERSION> changelog"
git push
```

---

## 故障排除

### Notarize timeout / 拒絕
Apple notarytool 預設 timeout 較長；極少數情況卡住超過 15 分鐘可：
```bash
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```
看最近一筆狀態。拒絕通常是因為 hardened runtime 設定或 entitlements；查 `xcrun notarytool log <id> --apple-id ...` 看詳細。

### Updater 簽名不符
若使用者 app 顯示「更新失敗：signature mismatch」，多半是：
- 私鑰換過了（換 key 等同切換信任根）
- `tauri.conf.json` 的 pubkey 跟簽 release 用的私鑰不對應

只能讓使用者手動下載新版，重新建立信任。

### 私鑰遺失
這是嚴重事件。流程：
1. 生新 keypair。
2. 更新 `tauri.conf.json` 的 pubkey。
3. 發新版（使用者會看到「更新失敗」，因為新 signature 對不上舊 pubkey；他們**必須手動下載**才能繼續用 updater）。
4. 在 release notes 明確說明「請手動下載本版，之後即可恢復自動更新」。

---

## 私鑰備份建議

- 1Password / Bitwarden 等密碼管理員（加密附件）
- 外接加密硬碟（FileVault 加密）
- **不要**放在 iCloud Drive 明文、不要 commit、不要 email 給自己
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASING.md
git commit -m "docs: add release guide with first-time setup and bump steps"
```

---

## Task 9: 真實發 v0.1.0 release（驗收 gate）

**Files:** 無程式改動（執行 release.sh）。

> 這是 plan 的驗收關鍵。前 8 task 完成後，在本機跑 release.sh 真實發出第一個版本，並驗證 updater 端到端。

- [ ] **Step 1: 確認所有 env 與檔案就緒**

```bash
echo "APPLE_ID=$APPLE_ID, TEAM_ID=$APPLE_TEAM_ID"
[ -n "$APPLE_PASSWORD" ] && echo "APPLE_PASSWORD set" || echo "MISSING"
[ -f ~/.gitlanes/updater-key.json ] && echo "key OK" || echo "MISSING"
gh auth status
```
Expected: 三個 env 都有、key 在、`gh` 已登入。

- [ ] **Step 2: 把分支 merge 進 main 後跑**

依使用者偏好（之前的模式）先把 `feat/release-updater` merge 進 main（無衝突）再執行：
```bash
git checkout main
git merge --no-ff feat/release-updater
git push origin main
```
Expected: merge 成功、main 上 tauri.conf.json 是 0.1.0。

- [ ] **Step 3: 跑 release.sh**

```bash
./scripts/release.sh
```

Expected：
- pre-flight 通過
- build 成功（~3–5 分鐘）
- notarize 成功（~5–15 分鐘）
- stapler、重打包、重簽 OK
- `gh release create` 上傳 4 個資產
- 印 `✅ Released v0.1.0`

到 https://github.com/mukiwu/gitlanes/releases 確認 v0.1.0 上有：
- `GitLanes_0.1.0_aarch64.dmg`
- `GitLanes.app.tar.gz`
- `GitLanes.app.tar.gz.sig`
- `latest.json`

- [ ] **Step 4: DMG 安裝 + Gatekeeper 檢查**

從 release 頁下載 .dmg、雙擊掛載、把 GitLanes 拖到 Applications。
首次開啟：應該**不跳 Gatekeeper 警告**（已 notarize + staple）；若跳警告代表 stapler 沒釘到。

- [ ] **Step 5: 端到端 updater 驗證（模擬發 0.1.1）**

完成 0.1.0 release 後，要驗 updater：
1. 確保 app 內 (Applications/GitLanes.app) 是 0.1.0 版。
2. 改 `tauri.conf.json` 與 `package.json` → 0.1.1；改 `src/App.tsx` 的 `APP_VERSION` → "0.1.1"；寫一小段 `CHANGELOG-NEXT.md`（例如 "fix: minor polish"）。
3. `./scripts/release.sh` 發 v0.1.1。
4. 重開 0.1.0 版的 GitLanes（已裝在 /Applications）。
5. 5 秒後**應自動跳 UpdateModal**「v0.1.1 已可用」。
6. 按「安裝並重啟」→ app 下載、安裝、自動重啟到 0.1.1。
7. 啟動後 5 秒再次檢查 → 不再跳（已是最新）。
8. 齒輪選單 → 檢查更新 → 顯示「已是最新版本」toast。

> 若你還沒準備好真的發兩版（畢竟一個版會永久存在 GitHub release 上），可只發 0.1.0，把模擬升版 0.1.1 留待之後實際有改動時做。

- [ ] **Step 6: 全部通過後勾完**

---

## Self-Review

**Spec 覆蓋對照：**

| Spec 區塊 | 對應 Task |
|---|---|
| §4.1 updater plugin 後端 | Task 1 |
| §4.2 signing key + .gitignore | Task 2 |
| §4.3 tauri.conf.json plugins.updater | Task 2 |
| §4.3 package.json 版號 + JS plugin | Task 3 |
| §4.4 UpdateModal 元件 | Task 4 |
| §4.4 App 整合（state、handlers、檢查、modal） | Task 5, 6 |
| §4.5 i18n | Task 5 Step 3 |
| §4.6 release.sh | Task 7 Step 1 |
| §4.6 CHANGELOG-NEXT.md | Task 7 Step 2 |
| §4.7 docs/RELEASING.md | Task 8 |
| §7 測試矩陣（DMG / Gatekeeper / 模擬升版 e2e） | Task 9 |

**型別一致性：** `UpdateModalLabels` 在 Task 4 定義、Task 6 使用一致；`@tauri-apps/plugin-updater` 的 `check()` / `Update` / `downloadAndInstall()` 與 `@tauri-apps/plugin-process` 的 `relaunch()` 在 Task 5/6 引用；`latest.json` schema 在 Task 7 release.sh 產出、與 spec §4.3 一致（`darwin-aarch64` platform key）。

**Placeholder 掃描：** 各步驟皆含完整可執行程式碼/指令，無 TODO/TBD。`<paste-public-key-base64-here>` 是 Task 2 必須手動替換的 placeholder（已標示）。

**已知相依：** Task 5 引入 `@tauri-apps/plugin-process` 若不存在會在 tsc 階段發現並補裝，已在 Step 4 寫明。Task 9 Step 5（模擬升版 e2e）可選——使用者若不想浪費版號可跳過、之後實際升版時自然驗證。
