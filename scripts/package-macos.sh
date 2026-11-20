#!/bin/bash
# Rebuild with: bash scripts/package-macos.sh (macOS Apple Silicon + Xcode CLT).
set -euo pipefail
export LC_ALL=C TZ=UTC COPYFILE_DISABLE=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Build on an Apple Silicon Mac with Xcode Command Line Tools.' >&2; exit 1; }
for tool in swiftc codesign zip shasum; do command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }; done
mkdir -p "$ROOT/dist"
STAGE="$(mktemp -d "$ROOT/dist/.package.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
SOURCE="$STAGE/source/ParliBot-source"
APP="$STAGE/macos/ParliBot.app"
RES="$APP/Contents/Resources/app"
mkdir -p "$SOURCE" "$RES" "$APP/Contents/MacOS"
# Deliberately explicit file whitelist. Never archive the repo, home, or arbitrary docs.
RUNTIME_FILES=(
 package.json public/app.js public/audio.js public/engine.js public/index.html public/styles.css public/views.js
 server/index.js server/model.js server/prompts.js server/speech.js server/coaching.js server/coach-contract.js
 scripts/mac-launch.sh scripts/mac-runtime.mjs
 native/VoiceHelper.swift native/Info.plist
)
SOURCE_FILES=(
 "${RUNTIME_FILES[@]}" README.md scripts/package-macos.sh scripts/install-macos.sh scripts/MacLauncher.swift
 scripts/setup-voice.sh scripts/start.sh
 tests/packaging.test.js tests/audio.test.js tests/coaching.test.js tests/engine.test.js tests/server.test.js tests/ui.test.js
 tests/browser.acceptance.mjs tests/browser.local-round.mjs tests/browser.local-smoke.mjs tests/coach.local-acceptance.mjs
)
copy_file() {
  local relative="$1" destination="$2"
  [[ -f "$ROOT/$relative" && ! -L "$ROOT/$relative" ]] || { echo "Missing or symlinked source: $relative" >&2; exit 1; }
  # Reject parent-directory symlinks too, even when the final file is regular.
  local parent="$(dirname "$relative")"
  while [[ "$parent" != . ]]; do
    [[ ! -L "$ROOT/$parent" ]] || { echo "Symlinked source directory: $parent" >&2; exit 1; }
    parent="$(dirname "$parent")"
  done
  mkdir -p "$destination/$(dirname "$relative")"
  cp "$ROOT/$relative" "$destination/$relative"
  chmod 644 "$destination/$relative"
}
for item in "${SOURCE_FILES[@]}"; do copy_file "$item" "$SOURCE"; done
for item in "${RUNTIME_FILES[@]}"; do copy_file "$item" "$RES"; done
VOICE="$RES/native/build/ParliBotVoice.app"
mkdir -p "$VOICE/Contents/MacOS"
cp "$RES/native/Info.plist" "$VOICE/Contents/Info.plist"
swiftc -target arm64-apple-macosx13.0 -swift-version 5 -O "$RES/native/VoiceHelper.swift" -o "$VOICE/Contents/MacOS/ParliBotVoice" -framework Speech -framework AVFoundation -Xlinker -no_uuid -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$VOICE/Contents/Info.plist"
codesign --force --sign - --timestamp=none --identifier local.parlibot.voice "$VOICE"
swiftc -target arm64-apple-macosx13.0 -swift-version 5 -O "$SOURCE/scripts/MacLauncher.swift" -o "$APP/Contents/MacOS/ParliBot" -framework AppKit -Xlinker -no_uuid
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.parlibot.desktop</string>
<key>CFBundleName</key><string>ParliBot</string>
<key>CFBundleDisplayName</key><string>ParliBot</string>
<key>CFBundleExecutable</key><string>ParliBot</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
cp "$ROOT/scripts/install-macos.sh" "$STAGE/macos/Install ParliBot.command"
chmod 755 "$STAGE/macos/Install ParliBot.command" "$RES/scripts/mac-launch.sh"
cat > "$STAGE/macos/INSTALL.txt" <<'DOC'
ParliBot for Apple Silicon macOS

1. Install Node.js 22+ (nodejs.org) and Ollama (ollama.com) separately.
   Command-line tools are found in /opt/homebrew/bin, /usr/local/bin, or PATH.
2. Extract ParliBot-macOS.zip. Keep Install ParliBot.command beside ParliBot.app.
3. Double-click Install ParliBot.command, or in Terminal run:
   bash "/path/to/extracted/Install ParliBot.command"
   This copies to ~/Applications/ParliBot.app without sudo or launching it.
   Any previous app is preserved as ~/Applications/ParliBot-backup-*.app.
4. Open ~/Applications/ParliBot.app in Finder. It starts local services only if
   absent and opens http://127.0.0.1:3210 in your default browser.
   You can also open the app directly in its extracted folder.

Install any desired local Ollama model yourself. No runtime or model is bundled,
and no model is automatically downloaded. An empty model list is not generation
readiness. Typed input works without microphone permission. No permission is
requested until you explicitly start the microphone in the web app.

Logs: ~/Library/Logs/ParliBot/{launcher,server,ollama}.log
If a port is occupied by an unrecognized service, startup stops with an error.
No existing processes are killed. Closing the browser does not stop the detached
Node/Ollama services. They persist until you stop them yourself or log out/reboot.
An existing recognized ParliBot server is reused and may be an older version.
Stop that server yourself before switching versions. The installer refuses to replace an app while files or its working directory
are in use (checked with lsof). Use Activity Monitor to identify your Node/Ollama process.

Security: ad-hoc signed for local integrity, NOT Developer ID signed or notarized.
Gatekeeper may block a downloaded app or .command. No quarantine is removed and
no security controls are bypassed. Review source and follow your security policy.
This build targets Apple Silicon macOS 13+. Newer Node.js/Ollama versions may
require a newer macOS release. See BUILD.txt for the native build toolchain.

Rebuild: extract ParliBot-source.zip, then from ParliBot-source run:
  bash scripts/package-macos.sh
  PARLIBOT_PACKAGE_TESTS=1 node --test tests/packaging.test.js
Requires Apple Silicon macOS and Xcode Command Line Tools (swiftc). No npm install
is needed. Output archives have sorted entries and normalized timestamps. Native
binaries omit UUIDs and signing timestamps. Same source/toolchain builds are
expected to match. Different Xcode/SDK versions can change native binary bytes.
Verify downloads in their containing folder with: shasum -a 256 -c SHA256SUMS
DOC
{
 echo 'ParliBot macOS build toolchain (no runtime or model bundled)'
 swiftc --version
 echo "SDK: $(xcrun --show-sdk-version)"
 echo "Architecture: $(uname -m)"
} > "$STAGE/macos/BUILD.txt"
cp "$STAGE/macos/INSTALL.txt" "$SOURCE/PACKAGING.txt"
codesign --force --sign - --timestamp=none --identifier local.parlibot.desktop "$APP"
codesign --verify --deep --strict "$APP"
# Normalize ZIP metadata; ZIP contents do not include resource-fork/home metadata.
find "$STAGE/macos" "$STAGE/source" -type d -exec chmod 755 {} +
find "$STAGE/macos" "$STAGE/source" -exec touch -t 202001010000.00 {} +
(cd "$STAGE/macos" && find . -type f | sed 's|^./||' | sort | zip -X -q "$STAGE/ParliBot-macOS.zip" -@)
(cd "$STAGE/source" && find . -type f | sed 's|^./||' | sort | zip -X -q "$STAGE/ParliBot-source.zip" -@)
mv "$STAGE/ParliBot-macOS.zip" "$STAGE/ParliBot-source.zip" "$ROOT/dist/"
(cd "$ROOT/dist" && shasum -a 256 ParliBot-macOS.zip ParliBot-source.zip > SHA256SUMS)
echo "Built $ROOT/dist/ParliBot-macOS.zip and ParliBot-source.zip"
cat "$ROOT/dist/SHA256SUMS"
