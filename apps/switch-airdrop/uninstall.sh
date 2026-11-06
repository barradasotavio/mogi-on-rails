#!/bin/bash
set -euo pipefail

DOMAIN="io.github.barradasotavio.switch-airdrop"
launchctl bootout "gui/$(id -u)/$DOMAIN" 2>/dev/null || true
rm -f -- "$HOME/Library/LaunchAgents/$DOMAIN.plist"
rm -rf -- "$HOME/Applications/Switch AirDrop.app"
defaults delete "$DOMAIN" 2>/dev/null || true
tccutil reset SystemPolicyDownloadsFolder "$DOMAIN" 2>/dev/null || true
echo "Switch AirDrop is uninstalled. Your moved files and log are kept."
