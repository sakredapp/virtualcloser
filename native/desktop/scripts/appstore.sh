#!/usr/bin/env bash
# Mac App Store build for ONE edition of the Suite CXO desktop app.
#
#   APPLE_TEAM_ID=<team> MAC_PROVISION_PROFILE=<path> ./scripts/appstore.sh suitecxo
#   APPLE_TEAM_ID=<team> MAC_PROVISION_PROFILE=<path> ./scripts/appstore.sh pinnacle
#
# MAC_BUILD_NUMBER=<n> sets CFBundleVersion (must advance on every upload of the
# same marketing version). Output: a signed .pkg for Transporter / altool.
# Same recipe as scripts/mac-appstore.sh in the CRM repo: App Sandbox,
# hardened runtime, embedded profile, Apple Distribution + Mac Installer
# Distribution certificates, universal binary.
set -euo pipefail
cd "$(dirname "$0")/.."

EDITION="${1:-}"
case "$EDITION" in
  suitecxo) APP_NAME="Suite CXO"; BUNDLE_ID="com.suitecxo.app" ;;
  pinnacle) APP_NAME="Pinnacle";  BUNDLE_ID="com.suitecxo.pinnacle" ;;
  *) echo "✗ usage: scripts/appstore.sh <suitecxo|pinnacle>" >&2; exit 1 ;;
esac
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is unset}"
: "${MAC_PROVISION_PROFILE:?MAC_PROVISION_PROFILE is unset (Mac App Store profile for $BUNDLE_ID)}"
[ -f "$MAC_PROVISION_PROFILE" ] || { echo "✗ no file at $MAC_PROVISION_PROFILE" >&2; exit 1; }

if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
TARGET="${MAC_TARGET:-universal-apple-darwin}"

echo "▶ Building $APP_NAME ($TARGET)"
npx tauri build --target "$TARGET" --config "src-tauri/tauri.${EDITION}.conf.json"

APP="src-tauri/target/${TARGET}/release/bundle/macos/${APP_NAME}.app"
[ -d "$APP" ] || { echo "✗ no .app at $APP" >&2; exit 1; }
id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
[ "$id" = "$BUNDLE_ID" ] || { echo "✗ bundle id is $id, expected $BUNDLE_ID" >&2; exit 1; }

if [ -n "${MAC_BUILD_NUMBER:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $MAC_BUILD_NUMBER" "$APP/Contents/Info.plist"
fi
cp "$MAC_PROVISION_PROFILE" "$APP/Contents/embedded.provisionprofile"

ENT="$(mktemp -t cxo-ent).plist"
cp src-tauri/entitlements/appstore.entitlements "$ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string ${APPLE_TEAM_ID}.${BUNDLE_ID}" "$ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string ${APPLE_TEAM_ID}" "$ENT"

APP_CERT="$(security find-identity -v -p codesigning | grep -E 'Apple Distribution|3rd Party Mac Developer Application' | head -1 | sed -E 's/.*"(.*)"/\1/')"
INST_CERT="$(security find-identity -v | grep -E '3rd Party Mac Developer Installer|Mac Installer Distribution' | head -1 | sed -E 's/.*"(.*)"/\1/')"
echo "▶ Signing with: $APP_CERT / $INST_CERT"
codesign --force --deep --timestamp --options runtime --entitlements "$ENT" --sign "$APP_CERT" "$APP"
codesign --verify --strict --verbose=2 "$APP"
rm -f "$ENT"

OUT="src-tauri/target/${TARGET}/release/bundle/pkg"
mkdir -p "$OUT"
PKG="$OUT/${APP_NAME// /-}-${EDITION}.pkg"
productbuild --component "$APP" /Applications --sign "$INST_CERT" "$PKG"
echo "✓ $PKG"
