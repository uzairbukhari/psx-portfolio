#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEFAULT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)/companies
CONFIG_DIR="$HOME/.psx-research-helper"
CONFIG_FILE="$CONFIG_DIR/config.json"
PLIST="$HOME/Library/LaunchAgents/com.psx-research.helper.plist"

printf 'Private app URL (for example https://psx-sip-portfolio.suzairbukhari.chatgpt.site): '
read -r BASE_URL
printf 'Pairing token shown by Research Desk: '
stty -echo
read -r TOKEN
stty echo
printf '\n'
printf 'Sites bypass token for private hosted access (leave blank for local/public apps): '
stty -echo
read -r SITES_BYPASS_TOKEN
stty echo
printf '\n'
printf 'Companies folder [%s]: ' "$DEFAULT_ROOT"
read -r ROOT_INPUT
COMPANIES_ROOT=${ROOT_INPUT:-$DEFAULT_ROOT}

mkdir -p "$CONFIG_DIR" "$HOME/Library/LaunchAgents" "$CONFIG_DIR/logs"
chmod 700 "$CONFIG_DIR"
umask 077
printf '{"baseUrl":"%s","token":"%s","sitesBypassToken":"%s","companiesRoot":"%s"}\n' "$BASE_URL" "$TOKEN" "$SITES_BYPASS_TOKEN" "$COMPANIES_ROOT" > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.psx-research.helper</string>
<key>ProgramArguments</key><array><string>$(command -v node)</string><string>$SCRIPT_DIR/index.mjs</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$CONFIG_DIR/logs/output.log</string>
<key>StandardErrorPath</key><string>$CONFIG_DIR/logs/error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf 'PSX Research Helper is installed and running.\n'
