#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Native local voice currently requires macOS. Typed input is available.' >&2
  exit 1
fi
command -v swiftc >/dev/null || { echo 'Install Apple Command Line Tools (xcode-select --install), then rerun.' >&2; exit 1; }
APP="$ROOT/native/build/ParliBotVoice.app"
mkdir -p "$APP/Contents/MacOS"
cp "$ROOT/native/Info.plist" "$APP/Contents/Info.plist"
swiftc -swift-version 5 -O "$ROOT/native/VoiceHelper.swift" -o "$APP/Contents/MacOS/ParliBotVoice" -framework Speech -framework AVFoundation -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/native/Info.plist"
codesign --force --sign - --identifier local.parlibot.voice "$APP"
echo 'Built ad-hoc signed ParliBot Voice. Probing only, no permission prompt or recording:'
"$APP/Contents/MacOS/ParliBotVoice" --probe
echo 'Use the app Start Microphone button to request macOS Speech Recognition and Microphone permissions.'
