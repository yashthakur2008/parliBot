#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$HERE/ParliBot.app"
DEST="$HOME/Applications/ParliBot.app"
trap 'echo "Installation failed. Your previous app, if any, is preserved as a backup in ~/Applications. Read the error above." >&2' ERR
[[ -d "$SOURCE/Contents/MacOS" && -f "$SOURCE/Contents/Info.plist" ]] || { echo 'Keep Install ParliBot.command beside ParliBot.app in the extracted ZIP folder.' >&2; exit 1; }
# A running server keeps its working directory inside this bundle. Never replace
# executable/static/helper files underneath it. This is a read-only process check.
if [[ -d "$DEST" ]]; then
  # macOS lsof can print matching PIDs yet exit 1 (partial search failures).
  # Output takes precedence over the exit status. Never discard matching PIDs.
  result=0
  ACTIVE="$(/usr/sbin/lsof -t +D "$DEST" 2>/dev/null)" || result=$?
  if [[ -n "$ACTIVE" ]]; then
    echo 'ParliBot is still in use. Stop its Node server in Activity Monitor, then rerun this installer. No process was stopped and the app was not changed.' >&2
    exit 1
  fi
  [[ "$result" == 0 || "$result" == 1 ]] || { echo 'Could not check whether the installed app is running. Installation cancelled safely.' >&2; exit 1; }
fi
mkdir -p "$HOME/Applications"
# Stage the new bundle completely before moving an existing installation.
STAGE="$(mktemp -d "$HOME/Applications/.ParliBot-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
/usr/bin/ditto "$SOURCE" "$STAGE/ParliBot.app"
if [[ -e "$DEST" || -L "$DEST" ]]; then
  BACKUP="$HOME/Applications/ParliBot-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$DEST" "$BACKUP"
  echo "Previous installation backed up to: $BACKUP"
fi
mv "$STAGE/ParliBot.app" "$DEST"
echo "Installed: $DEST"
echo 'Open ~/Applications/ParliBot.app in Finder when ready. This installer does not launch it.'
echo 'Requires Node.js 22+ and Ollama installed separately. Models are never downloaded automatically.'
echo 'The app is ad-hoc signed, not notarized. If macOS blocks it, review its source and follow your organization’s security policy. This installer does not alter Gatekeeper or quarantine.'
