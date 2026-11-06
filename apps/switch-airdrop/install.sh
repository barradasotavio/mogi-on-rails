#!/bin/bash
set -euo pipefail

PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="io.github.barradasotavio.switch-airdrop"
APP="$HOME/Applications/Switch AirDrop.app"
PLIST="$HOME/Library/LaunchAgents/$DOMAIN.plist"
GUI_DOMAIN="gui/$(id -u)"
BUILT_APP="$("$PACKAGE_DIR/scripts/build-app.sh")"

# Build successfully before stopping an existing installation.
launchctl bootout "$GUI_DOMAIN/$DOMAIN" 2>/dev/null || true
# bootout returns before the job is gone; bootstrap fails while it lingers.
for _ in {1..50}; do
    launchctl print "$GUI_DOMAIN/$DOMAIN" >/dev/null 2>&1 || break
    sleep 0.1
done
mkdir -p -- "$HOME/Applications" "$HOME/Library/LaunchAgents"
rm -rf -- "$APP"
ditto "$BUILT_APP" "$APP"

if ! defaults read "$DOMAIN" InstallCutoff >/dev/null 2>&1; then
    defaults write "$DOMAIN" InstallCutoff -int "$(date +%s)"
fi

# plutil stores the executable path as a plist value, including XML metacharacters.
TEMP_PLIST="$(mktemp "${TMPDIR:-/tmp/}switch-airdrop.plist.XXXXXX")"
trap 'rm -f -- "$TEMP_PLIST"' EXIT
cat > "$TEMP_PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>io.github.barradasotavio.switch-airdrop</string>
    <key>ProgramArguments</key><array/>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <dict><key>SuccessfulExit</key><false/></dict>
    <key>AssociatedBundleIdentifiers</key>
    <array><string>io.github.barradasotavio.switch-airdrop</string></array>
</dict>
</plist>
PLIST
plutil -insert ProgramArguments.0 -string "$APP/Contents/MacOS/SwitchAirdrop" "$TEMP_PLIST"
plutil -lint "$TEMP_PLIST" >/dev/null
cp -- "$TEMP_PLIST" "$PLIST"
chmod 644 "$PLIST"
echo "macOS will ask for Downloads access. Allow it so Switch AirDrop can move your screenshots."
launchctl bootstrap "$GUI_DOMAIN" "$PLIST"
echo "Switch AirDrop is installed and will start at login."
