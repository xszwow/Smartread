#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM_ID="${IOS_DEVELOPMENT_TEAM:-${APPLE_TEAM_ID:-}}"
SCHEME="${IOS_SCHEME:-App}"
CONFIGURATION="${IOS_CONFIGURATION:-Release}"
EXPORT_METHOD="${IOS_EXPORT_METHOD:-development}"
PROJECT_PATH="${IOS_PROJECT_PATH:-$ROOT/ios/App/App.xcodeproj}"
ARCHIVE_PATH="${IOS_ARCHIVE_PATH:-$ROOT/release/ios/SmartRead.xcarchive}"
EXPORT_PATH="${IOS_EXPORT_PATH:-$ROOT/release/ios}"
EXPORT_OPTIONS="${IOS_EXPORT_OPTIONS_PLIST:-$EXPORT_PATH/ExportOptions.plist}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS signing requires macOS with Xcode." >&2
  exit 1
fi

if [[ -z "$TEAM_ID" ]]; then
  echo "Set IOS_DEVELOPMENT_TEAM or APPLE_TEAM_ID to your Apple Developer Team ID." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Install Xcode and run xcode-select --switch if needed." >&2
  exit 1
fi

mkdir -p "$EXPORT_PATH"

if [[ -x "$ROOT/node_modules/.bin/cap" ]]; then
  (cd "$ROOT" && "$ROOT/node_modules/.bin/cap" sync ios)
elif [[ -f "$ROOT/node_modules/@capacitor/cli/bin/capacitor" ]]; then
  (cd "$ROOT" && node "$ROOT/node_modules/@capacitor/cli/bin/capacitor" sync ios)
else
  (cd "$ROOT" && npx cap sync ios)
fi

cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>$EXPORT_METHOD</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
PLIST

xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH"

echo "iOS export complete: $EXPORT_PATH"
