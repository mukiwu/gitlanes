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
# Key was generated without a password — explicitly empty so the CLI doesn't try to prompt.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
echo "→ Building..."
npx tauri build --target aarch64-apple-darwin

APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app"
DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/GitLanes_${VERSION}_aarch64.dmg"
TAR_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GitLanes.app.tar.gz"
SIG_PATH="${TAR_PATH}.sig"

[ -d "$APP_PATH" ] || { echo "✗ Built .app missing at $APP_PATH"; exit 1; }
[ -f "$DMG_PATH" ] || { echo "✗ Built .dmg missing at $DMG_PATH"; exit 1; }
[ -f "$TAR_PATH" ] || { echo "✗ Built .tar.gz missing at $TAR_PATH"; exit 1; }

# 3. Notarize the .dmg
# Tauri build (with macOS.signingIdentity + APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID envs) already
# notarizes + staples the .app during bundling. The .dmg is built afterwards and is NOT
# auto-notarized, so we do it explicitly here so users get no Gatekeeper warning on the .dmg.
echo "→ Notarizing .dmg (this may take a few minutes)..."
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "→ Stapling notarization ticket to .dmg..."
xcrun stapler staple "$DMG_PATH"

# 4. Tauri already produced & signed the .tar.gz containing the stapled .app during the build
# (because we set APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID env vars before invoking it).
# Just verify both files are there.
[ -f "$SIG_PATH" ] || { echo "✗ Updater signature missing at $SIG_PATH"; exit 1; }

# 5. Generate latest.json
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
echo "Next: rename CHANGELOG-NEXT.md → docs/changelogs/CHANGELOG-${VERSION}.md and start fresh for the next release."
