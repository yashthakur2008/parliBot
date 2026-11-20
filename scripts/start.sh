#!/bin/sh
# Dependency-free app launcher. Start `ollama serve` separately if needed.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'ParliBot needs Node.js 22 or newer.' >&2
  exit 1
fi
exec node server/index.js
