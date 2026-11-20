#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$HOME/Library/Logs/ParliBot"
mkdir -p "$LOGS"
exec >>"$LOGS/launcher.log" 2>&1
fail() {
  echo "$1"
  PARLIBOT_ERROR="$1 Logs: $LOGS" /usr/bin/osascript -e 'display alert "ParliBot could not start" message (system attribute "PARLIBOT_ERROR") as critical' || true
  exit 1
}
NODE=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do
  if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
    NODE="$candidate"; break
  fi
done
[[ -n "$NODE" ]] || fail 'Install Node.js 22 or newer from nodejs.org (or brew install node), then reopen ParliBot.'
OLLAMA="$(command -v ollama || true)"
[[ -n "$OLLAMA" ]] || fail 'Install Ollama from ollama.com (or brew install ollama), then reopen ParliBot. Models must be installed separately by you.'
cd "$ROOT"
"$NODE" "$ROOT/scripts/mac-runtime.mjs" "$OLLAMA" || fail 'Startup failed. Check launcher.log, server.log, and ollama.log in the logs folder. Port 3210 must be free or already running ParliBot. No existing process was stopped.'
