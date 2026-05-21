# Release 流程 + Tauri Updater 設計

| 項目 | 內容 |
|---|---|
| 日期 | 2026-05-22 |
| 範圍 | 本機 build + GitHub Release 發佈管道；嵌入 Tauri updater 讓 app 自動探測新版並一鍵更新 |
| 預估工時 | 1 個工作天（含首次發版實作驗證） |
| 平臺 | macOS Apple Silicon（arm64）only |
| 簽名 | 使用者本機 Keychain 已有 Apple Developer ID Application 憑證 |

---

## 1. 背景與動機

GitLanes 累積到 main 上的功能足以發出第一個正式版（commit/branch 右鍵、push/pull/fetch、三段 layout、嵌入式 PTY terminal 等）。目前狀態：
- 沒有 GitHub Release 紀錄
- 版號分散：`tauri.conf.json` `0.1.0`、`package.json` `0.0.0`
- 沒有自動更新機制——使用者更新只能重新去 release 頁下載
- 沒有 release 腳本，build 流程靠 `npm run tauri build` 手 cli

目標：建立可重複的「本機一鍵發版」流程，並讓 app 內建更新提示，往後新版用 `./scripts/release.sh` 就能完成 build → 簽名 → 公證 → 上傳 → 通知使用者更新。

---

## 2. 目標

### Updater
- App 內嵌 `tauri-plugin-updater`，公鑰寫進設定、私鑰存本機（不進 repo）。
- 啟動 app 後背景靜默檢查（延遲 5 秒）；有新版才跳 modal、提示更新並列出版號 / release notes 摘要。
- 齒輪選單加「Check for updates…」項目，使用者隨時手動觸發。
- 更新流程：使用者按「Install and restart」→ 下載 → 驗證 ed25519 簽名 → 替換 .app → 重啟。

### Release 管道
- 同步 `package.json` 版號到 `0.1.0`。
- 加 `scripts/release.sh`：build → notarize → 產 latest.json → `gh release create` 上傳。
- 產出資產：
  - `GitLanes_0.1.0_aarch64.dmg`（人類下載）
  - `GitLanes.app.tar.gz` + `.sig`（updater 用）
  - `latest.json`（updater endpoint 讀取）
- 寫 `docs/RELEASING.md`：notarize env vars、私鑰備份位置、發版步驟。

### i18n
- Updater UI 中英雙語（檢查中、有新版、無新版、下載中、安裝失敗）。

---

## 3. 不做（YAGNI）

- Universal binary（Apple Silicon + Intel）—— 只發 arm64。
- Windows / Linux build。
- GitHub Actions 自動化—— 本機 build。
- 多版本通道（stable / beta / nightly）—— 只一條 latest。
- 強制更新 / 自動下載安裝—— 一律使用者按按鈕才下載。
- App 內顯示完整 release notes（modal 顯示前 N 行；完整連到 GitHub release 頁）。
- Rollback / 降版機制。
- Update progress bar—— 顯示 indeterminate spinner 即可。

---

## 4. 架構

### 4.1 Updater plugin（後端）

**Rust 依賴**（`src-tauri/Cargo.toml`）：
```toml
tauri-plugin-updater = "2"
```

**`src-tauri/src/lib.rs`** 在 `tauri::Builder::default()` 鏈中加：
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

**JS 依賴**（`package.json`）：
```json
"@tauri-apps/plugin-updater": "^2"
```

### 4.2 Signing key

一次性產生：
```bash
npx @tauri-apps/cli signer generate -w ~/.gitlanes/updater-key.json
```

產出兩個檔：
- 私鑰：`~/.gitlanes/updater-key.json`（**不入 repo**；發版時用環境變數 `TAURI_SIGNING_PRIVATE_KEY` 指向其內容或路徑）
- 對應公鑰會印在 stdout

公鑰寫進 `src-tauri/tauri.conf.json`（見 4.3）。

`.gitignore` 加 `~` 範圍外的雙保險：
```
# Tauri updater signing private key (never commit)
*.key
updater-key*.json
```

### 4.3 tauri.conf.json 更新

```json
"plugins": {
  "updater": {
    "active": true,
    "pubkey": "<paste-public-key-here>",
    "endpoints": [
      "https://github.com/mukiwu/gitlanes/releases/latest/download/latest.json"
    ],
    "dialog": false
  }
}
```

`dialog: false` 讓我們自己控制更新提示 UI（要設計成 modal、要含 i18n）；不用 Tauri 內建簡陋對話框。

### 4.4 前端 updater UI

**新元件 `src/components/UpdateModal.tsx`**

```typescript
interface UpdateModalProps {
  open: boolean;
  version: string;
  currentVersion: string;
  notes: string;
  onInstall: () => void;
  onLater: () => void;
  isInstalling: boolean;
  labels: UpdateModalLabels;
}
```

風格對齊既有 `CommitInputModal`：標題列 + 內容區（顯示「v0.1.1 已可用」+ notes 前 600 字 + 連到完整 release 連結） + 底部「安裝並重啟 / 之後再說」。

**App.tsx 整合**

```typescript
// app 啟動後 5 秒背景檢查
useEffect(() => {
  const t = setTimeout(() => checkForUpdate(/* silent: true */), 5000);
  return () => clearTimeout(t);
}, []);

const checkForUpdate = async (opts?: { silent?: boolean }) => {
  try {
    const update = await check();
    if (update?.available) {
      setUpdateModal({ open: true, ...update });
    } else if (!opts?.silent) {
      showToast(t.noUpdateAvailable);
    }
  } catch (err) {
    if (!opts?.silent) showToast(/* error */, true);
  }
};
```

**齒輪選單**：在「AI 設定…」項目附近加「Check for updates…」，呼叫 `checkForUpdate({ silent: false })`。

**安裝流程**：
```typescript
const onInstall = async () => {
  setIsInstalling(true);
  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    setIsInstalling(false);
    showToast(err.message, true);
  }
};
```

### 4.5 i18n（中英）

| key | en | zh |
|---|---|---|
| `checkForUpdates` | "Check for updates…" | "檢查更新…" |
| `noUpdateAvailable` | "You're on the latest version." | "已是最新版本。" |
| `updateAvailable` | (v: string) => `Version ${v} is available` | (v) => `有新版本 ${v}` |
| `updateCurrent` | (v: string) => `Current: ${v}` | (v) => `目前：${v}` |
| `updateNotes` | "Release notes" | "更新說明" |
| `updateFullNotesLink` | "View full release notes" | "查看完整更新說明" |
| `updateInstall` | "Install and restart" | "安裝並重啟" |
| `updateLater` | "Later" | "之後再說" |
| `updateInstalling` | "Installing…" | "安裝中…" |
| `updateFailed` | "Update failed" | "更新失敗" |

### 4.6 release.sh

`scripts/release.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# Read version from tauri.conf.json (single source of truth).
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v${VERSION}"

# 1. Pre-flight checks
[ -z "${APPLE_ID:-}" ] && { echo "APPLE_ID env not set"; exit 1; }
[ -z "${APPLE_PASSWORD:-}" ] && { echo "APPLE_PASSWORD env not set"; exit 1; }
[ -z "${APPLE_TEAM_ID:-}" ] && { echo "APPLE_TEAM_ID env not set"; exit 1; }
[ -f ~/.gitlanes/updater-key.json ] || { echo "Updater private key missing"; exit 1; }
gh release view "$TAG" >/dev/null 2>&1 && { echo "Release $TAG already exists"; exit 1; }

# 2. Build with signing + updater key in env
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.gitlanes/updater-key.json)
npm run tauri build -- --target aarch64-apple-darwin

# 3. Notarize the .app (tauri build creates the bundle but doesn't notarize)
APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app"
DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/GitLanes_${VERSION}_aarch64.dmg"
TAR_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app.tar.gz"
SIG_PATH="${TAR_PATH}.sig"

# Zip the .app for notarytool (it accepts .zip / .pkg / .dmg)
ditto -c -k --keepParent "$APP_PATH" /tmp/GitLanes-notarize.zip
xcrun notarytool submit /tmp/GitLanes-notarize.zip \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler staple "$DMG_PATH"

# Re-tar after stapling so updater downloads the stapled app
( cd "$(dirname "$APP_PATH")" && tar -czf "$(basename "$TAR_PATH")" "$(basename "$APP_PATH")" )
# Tauri build wrote the .sig before stapling; re-sign the post-staple tar.
npx @tauri-apps/cli signer sign -k ~/.gitlanes/updater-key.json "$TAR_PATH"

# 4. Generate latest.json
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGNATURE=$(cat "$SIG_PATH")
DOWNLOAD_URL="https://github.com/mukiwu/gitlanes/releases/download/${TAG}/GitLanes.app.tar.gz"

cat > /tmp/latest.json <<EOF
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

# 5. Create release + upload assets
gh release create "$TAG" \
  --title "GitLanes ${VERSION}" \
  --notes-file CHANGELOG-NEXT.md \
  "$DMG_PATH" \
  "$TAR_PATH" \
  "$SIG_PATH" \
  "/tmp/latest.json"

echo "✅ Released ${TAG}"
```

腳本特性：
- Pre-flight check：缺 env / 私鑰 / tag 已存在 → 即停。
- Notarize 用 Apple notarytool（`xcrun notarytool submit --wait` 阻塞至公證完成，免抓 UUID 輪詢）。
- Stapler 把 notarization ticket 釘進 .app + .dmg。
- **關鍵**：stapler 之後**重新打包並重簽** .tar.gz —— 否則 updater 拿到的會是未公證版本，雖然能用但安全性不對勁。
- `CHANGELOG-NEXT.md`：發版前手寫該版的 release notes；上傳後可改名為 `CHANGELOG-${VERSION}.md` 歸檔（這部分為人工流程，本 spec 不自動化）。

### 4.7 文件 `docs/RELEASING.md`

寫清楚發版流程：
1. 首次設定：env vars（`APPLE_ID` 等）、`~/.gitlanes/updater-key.json` 私鑰備份建議。
2. 升版步驟：
   - 改 `src-tauri/tauri.conf.json` 的 version + `package.json` 的 version。
   - 寫 `CHANGELOG-NEXT.md`（這版的 release notes）。
   - `./scripts/release.sh`。
3. 私鑰遺失應對：須生新 key、所有用戶要手動下載新版（updater 簽名不符會拒絕）。
4. 何時 bump major / minor / patch（semver 提醒）。

---

## 5. 檔案改動清單

| 區塊 | 檔案 | 動作 |
|---|---|---|
| Rust | `src-tauri/Cargo.toml` | 加 `tauri-plugin-updater = "2"` |
| Rust | `src-tauri/src/lib.rs` | `.plugin(tauri_plugin_updater::Builder::new().build())` |
| Tauri 設定 | `src-tauri/tauri.conf.json` | 加 `plugins.updater`（pubkey + endpoints + dialog:false） |
| 版號同步 | `package.json` | version `0.0.0` → `0.1.0` |
| 前端 | `package.json` | 加 `@tauri-apps/plugin-updater` |
| 前端元件 | `src/components/UpdateModal.tsx`（新） | 更新提示 modal |
| 前端整合 | `src/App.tsx` | 啟動後背景檢查、齒輪選單入口、modal 渲染、i18n、handlers |
| Release | `scripts/release.sh`（新） | build + notarize + latest.json + gh release |
| Release | `CHANGELOG-NEXT.md`（新） | 第一版 release notes（commit 右鍵 / branch 右鍵 / push-pull-fetch / 三段 layout / PTY / AI provider 設定…） |
| 文件 | `docs/RELEASING.md`（新） | 發版流程說明、env vars、私鑰備份、semver 提醒 |
| 安全 | `.gitignore` | 加 `*.key`、`updater-key*.json` 防誤入 repo |

---

## 6. 錯誤處理 / 邊界

- App 離線：updater check 失敗 → 背景檢查靜默失敗；手動觸發顯示「無法檢查更新（網路問題）」toast。
- Latest.json 解析失敗（GitHub 伺服器暫時 5xx）：同上，靜默 / toast。
- 私鑰簽名與 latest.json signature 不符（攻擊或 key 遺失）：Tauri updater 拒絕安裝、回 `signature mismatch` 錯誤 → 顯示「更新失敗：簽名驗證失敗，請手動到 GitHub 下載新版」。
- 公證失敗（Apple 端 timeout / 拒絕）：`notarytool --wait` 回非零 exit → release.sh `set -euo pipefail` 立刻終止，沒有半成品 release 上傳。
- gh CLI 未登入：`gh release create` 報錯停止；release.sh 在最後一步才做，已建立的 build artifact 留在本機可重試。
- Tag 已存在：pre-flight check 擋掉，避免覆蓋已發 release。

---

## 7. 測試與驗收（手動）

| 場景 | 預期 |
|---|---|
| 首次跑 `./scripts/release.sh` | build / notarize / staple / latest.json / gh release create 全部成功；GitHub release 頁列 4 個資產（dmg, tar.gz, sig, latest.json） |
| DMG 雙擊 | 開啟正常、不跳 Gatekeeper 警告（已公證+staple） |
| 手動裝 `0.1.0` → 模擬發 `0.1.1`（修個小改）→ 用 0.1.0 開 app | 5 秒後跳 modal「v0.1.1 已可用」 |
| modal 按「安裝並重啟」 | 下載、自動替換、app 自動重啟到 0.1.1 |
| 齒輪 → 檢查更新（已是最新時） | 顯示「已是最新版本」toast |
| 齒輪 → 檢查更新（有新版） | 跳 modal |
| 離線 + 手動檢查 | 顯示網路錯誤 toast，不 crash |
| 篡改 latest.json 的 signature → 試裝 | Tauri 回 signature mismatch；UI 顯示更新失敗 toast |
| 切到中文 → 檢查更新 | 所有文字中文化 |

---

## 8. 待釐清項目

- macOS 公證有時會卡在 Apple 伺服器佇列（~5-15 分鐘）；`notarytool --wait` 處理，但若超過 15 分鐘 timeout 需手動 retry，release.sh 不做自動 retry。
- `tauri-plugin-updater` 用 GitHub release URL 當 endpoint 是官方支援模式；若日後想 host 在自有 server，只要改 `tauri.conf.json` 的 endpoints。
- 私鑰遺失是嚴重事件：使用者必須手動下載新版（不能 OTA 升）。spec §4.7 文件會強調備份的重要性。
