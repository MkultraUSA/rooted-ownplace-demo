#!/usr/bin/env bash
# Copy the google-drive-sim package to Google Drive via rclone.
# Hostinger only: requires the rooted_drive: remote (scope drive.file).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
rclone copy "$ROOT/demo/stores/google-drive-sim/" "rooted_drive:Rooted OwnPlace Demo/" --timeout 30s
rclone ls "rooted_drive:Rooted OwnPlace Demo" --timeout 30s
