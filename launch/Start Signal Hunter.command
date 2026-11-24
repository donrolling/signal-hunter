#!/bin/sh
# Runs Signal Hunter in your browser, without Live. Close this window to stop it.
cd "$(dirname "$0")"
# files unzipped from a download are quarantined by macOS; this folder is ours, so clear it once
xattr -dr com.apple.quarantine . 2>/dev/null
ARCH=$(uname -m); [ "$ARCH" = arm64 ] || ARCH=x64
exec "./bin/node-darwin-$ARCH" server.js --open
