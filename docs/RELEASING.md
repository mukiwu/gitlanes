# GitLanes Release Guide

本機一鍵發版。第一次跑「首次設定」一次；之後每次只跑「升版步驟」。

## 首次設定（一次即可）

### 1. Apple Developer ID

確認 macOS Keychain 有 Developer ID Application 憑證：
```bash
security find-identity -v -p codesigning
```
應看到 `Developer ID Application: <Your Name> (<TEAM_ID>)`。

### 2. App-specific password

到 https://appleid.apple.com → Sign-In and Security → App-Specific Passwords，產一組標籤如 `gitlanes-notarize`。

### 3. 環境變數

加進 `~/.zshrc`：
```bash
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
```

### 4. Updater signing key

已存在 `~/.gitlanes/updater-key.json`（v0.1.0 spec 執行時生成）。
**重要**：把 `~/.gitlanes/updater-key.json` 與 `.pub` 備份到 1Password / 加密硬碟。**遺失私鑰 = 無法再發更新給現有使用者**。

公鑰已在 `src-tauri/tauri.conf.json`、進 repo，不需備份。

### 5. GitHub CLI

```bash
gh auth status   # 未登入則 gh auth login
```

---

## 升版步驟

### 1. 改版號（三處同步）

- `src-tauri/tauri.conf.json` → `"version"`
- `package.json` → `"version"`
- `src/App.tsx` → `APP_VERSION`

依 semver：patch（bug fix）/ minor（新功能）/ major（破壞性變更）。

### 2. 寫 release notes

編輯 `CHANGELOG-NEXT.md`。

### 3. Commit + push

```bash
git add -A
git commit -m "chore: release v<VERSION>"
git push origin main
```

### 4. 跑 release.sh

```bash
./scripts/release.sh
```

腳本會：build → notarize（5–15 分鐘）→ stapler → 重新打包重簽 → 產 latest.json → `gh release create` 上傳 4 個資產。

### 5. 歸檔 changelog（建議）

```bash
mkdir -p docs/changelogs
mv CHANGELOG-NEXT.md docs/changelogs/CHANGELOG-<VERSION>.md
touch CHANGELOG-NEXT.md
git add -A && git commit -m "chore: archive v<VERSION> changelog" && git push
```

---

## 故障排除

### Notarize timeout / 拒絕
```bash
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
xcrun notarytool log <id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

### Updater 簽名不符
私鑰換過了或對不上 pubkey → 使用者只能手動下載新版重建信任。

### 私鑰遺失（嚴重事件）
1. 生新 keypair
2. 更新 `tauri.conf.json` pubkey
3. 發新版（使用者 updater 會失敗，需手動下載；release notes 標明）

---

## 私鑰備份建議

1Password / Bitwarden 加密附件、外接加密硬碟（FileVault）。**不要**放 iCloud 明文、不要 commit、不要 email。
