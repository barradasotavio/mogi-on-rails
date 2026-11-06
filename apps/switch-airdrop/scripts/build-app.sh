#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${1:-$PACKAGE_DIR/.build/app}"
mkdir -p -- "$OUT_DIR"
OUT_DIR="$(cd -- "$OUT_DIR" && pwd)"

cd -- "$PACKAGE_DIR"
swift build -c release >&2
BIN_DIR="$(swift build -c release --show-bin-path)"
APP="$OUT_DIR/Switch AirDrop.app"
mkdir -p -- "$APP/Contents/MacOS"
cp -- "$BIN_DIR/SwitchAirdrop" "$APP/Contents/MacOS/SwitchAirdrop"
cp -- "$PACKAGE_DIR/Resources/Info.plist" "$APP/Contents/Info.plist"
codesign --force --sign - --identifier io.github.barradasotavio.switch-airdrop "$APP" >&2
printf '%s\n' "$APP"
