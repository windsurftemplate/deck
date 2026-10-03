#!/bin/bash
# One-click installer for deck on macOS.
# Double-click this file in Finder. It sets up everything it needs in ~/.deck-tools
# (nothing is installed system-wide except Apple's Command Line Tools), builds the app
# from this folder, and puts deck.app in your Applications folder.
# First run takes about 10 to 20 minutes; later runs are faster.

set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"
TOOLS="$HOME/.deck-tools"
LOG="$HOME/Library/Logs/deck-install.log"
mkdir -p "$TOOLS/bin" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
fail() {
  printf "\n\033[1;31mInstall stopped: %s\033[0m\n" "$1"
  echo "Full log: $LOG"
  read -r -p "Press Return to close." _ || true
  exit 1
}
trap 'fail "a step failed (see the lines above)."' ERR

echo "deck installer, $(date)"
[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS."
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] && NODE_ARCH=arm64 || NODE_ARCH=x64
[ -f "$REPO/pnpm-workspace.yaml" ] || fail "run this from inside the unzipped deck folder."

step "1/6 Apple Command Line Tools"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "A window will ask to install the Command Line Tools. Click Install, then wait here."
  xcode-select --install || true
  until xcode-select -p >/dev/null 2>&1; do sleep 10; done
fi
echo "Ready."

step "2/6 Node.js 22 (private copy in ~/.deck-tools)"
NODE_DIR="$TOOLS/node"
if [ ! -x "$NODE_DIR/bin/node" ] || ! "$NODE_DIR/bin/node" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  BASE="https://nodejs.org/dist/latest-v22.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")"
  FILE="$(printf "%s\n" "$SUMS" | awk -v a="darwin-$NODE_ARCH.tar.gz" '$2 ~ a"$" {print $2; exit}')"
  [ -n "$FILE" ] || fail "could not find a Node.js download for this Mac."
  curl -fSL --progress-bar "$BASE/$FILE" -o "$TOOLS/$FILE"
  EXPECTED="$(printf "%s\n" "$SUMS" | awk -v f="$FILE" '$2 == f {print $1}')"
  ACTUAL="$(shasum -a 256 "$TOOLS/$FILE" | awk '{print $1}')"
  [ "$EXPECTED" = "$ACTUAL" ] || fail "the Node.js download did not match its checksum."
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$TOOLS/$FILE" -C "$NODE_DIR" --strip-components=1
  rm -f "$TOOLS/$FILE"
fi
export PATH="$NODE_DIR/bin:$TOOLS/bin:$PATH"
echo "Node $(node --version)."

step "3/6 pnpm"
export COREPACK_HOME="$TOOLS/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable --install-directory "$TOOLS/bin" pnpm
echo "pnpm $(pnpm --version)."

step "4/6 Rust (private copy via rustup)"
export RUSTUP_HOME="$TOOLS/rustup" CARGO_HOME="$TOOLS/cargo"
if [ ! -x "$CARGO_HOME/bin/cargo" ]; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
fi
export PATH="$CARGO_HOME/bin:$PATH"
rustup update stable --no-self-update >/dev/null 2>&1 || true
echo "$(rustc --version)."

step "5/6 Building deck (the slow part)"
pnpm install --frozen-lockfile
node scripts/package-engine.mjs
pnpm --filter @deck/desktop tauri build --bundles app --config src-tauri/tauri.bundle.conf.json

step "6/6 Installing to Applications"
APP="$REPO/apps/desktop/src-tauri/target/release/bundle/macos/deck.app"
[ -d "$APP" ] || fail "the build finished but deck.app was not found."
osascript -e 'tell application "deck" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "/Applications/deck.app"
cp -R "$APP" /Applications/
xattr -dr com.apple.quarantine /Applications/deck.app 2>/dev/null || true

trap - ERR
printf "\n\033[1;32mdeck is installed in Applications.\033[0m\n"
echo "Your memory, settings and keys are kept between installs. To update later, unzip the new version and run this again."
open /Applications/deck.app
read -r -p "Press Return to close." _ || true
