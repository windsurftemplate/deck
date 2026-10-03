#!/usr/bin/env bash
# One-click installer for deck on Linux (Ubuntu, Debian, Fedora; other distros get an AppImage).
# Run:  ./install-linux.sh   (or double-click it and choose "Run in terminal")
# Installs system libraries with your package manager (asks for your password), keeps private copies
# of Node and Rust in ~/.deck-tools, builds deck from this folder, installs it, and opens it.
# First run takes about 10 to 20 minutes.

set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"
TOOLS="$HOME/.deck-tools"
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/deck-install.log"
mkdir -p "$TOOLS/bin" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
fail() {
  printf "\n\033[1;31mInstall stopped: %s\033[0m\n" "$1"
  echo "Full log: $LOG"
  [ -t 0 ] && read -r -p "Press Return to close." _ || true
  exit 1
}
trap 'fail "a step failed (see the lines above)."' ERR

echo "deck installer, $(date)"
[ "$(uname -s)" = "Linux" ] || fail "this installer is for Linux."
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64) NODE_ARCH=arm64 ;; *) fail "unsupported processor $(uname -m)." ;; esac
[ -f "$REPO/pnpm-workspace.yaml" ] || fail "run this from inside the unzipped deck folder."
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

step "1/6 System libraries"
if command -v apt-get >/dev/null 2>&1; then
  PKG=deb
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq build-essential curl wget file pkg-config libssl-dev libxdo-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev ffmpeg
elif command -v dnf >/dev/null 2>&1; then
  PKG=rpm
  $SUDO dnf install -y -q gcc gcc-c++ make curl wget file pkgconf-pkg-config openssl-devel libxdo-devel webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel rpm-build
else
  PKG=appimage
  echo "No apt or dnf found. Install your distro's WebKitGTK 4.1, librsvg, libappindicator, xdo and OpenSSL development packages, then run this again if the build fails."
fi
echo "Ready ($PKG)."

step "2/6 Node.js 22 (private copy in ~/.deck-tools)"
NODE_DIR="$TOOLS/node"
if [ ! -x "$NODE_DIR/bin/node" ] || ! "$NODE_DIR/bin/node" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  BASE="https://nodejs.org/dist/latest-v22.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")"
  FILE="$(printf "%s\n" "$SUMS" | awk -v a="linux-$NODE_ARCH.tar.xz" '$2 ~ a"$" {print $2; exit}')"
  [ -n "$FILE" ] || fail "could not find a Node.js download for this machine."
  curl -fSL --progress-bar "$BASE/$FILE" -o "$TOOLS/$FILE"
  EXPECTED="$(printf "%s\n" "$SUMS" | awk -v f="$FILE" '$2 == f {print $1}')"
  ACTUAL="$(sha256sum "$TOOLS/$FILE" | awk '{print $1}')"
  [ "$EXPECTED" = "$ACTUAL" ] || fail "the Node.js download did not match its checksum."
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TOOLS/$FILE" -C "$NODE_DIR" --strip-components=1
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
pnpm --filter @deck/desktop tauri build --bundles "$PKG" --config src-tauri/tauri.bundle.conf.json

step "6/6 Installing"
OUT="$REPO/apps/desktop/src-tauri/target/release/bundle"
pkill -x deck >/dev/null 2>&1 || true
case "$PKG" in
  deb) f="$(ls -t "$OUT"/deb/*.deb | head -1)"; DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "$f"; RUN=deck ;;
  rpm) f="$(ls -t "$OUT"/rpm/*.rpm | head -1)"; $SUDO dnf install -y -q "$f"; RUN=deck ;;
  appimage)
    f="$(ls -t "$OUT"/appimage/*.AppImage | head -1)"
    mkdir -p "$HOME/Applications" "$HOME/.local/share/applications"
    cp "$f" "$HOME/Applications/deck.AppImage" && chmod +x "$HOME/Applications/deck.AppImage"
    printf "[Desktop Entry]\nName=deck\nExec=%s\nType=Application\nCategories=Utility;\n" "$HOME/Applications/deck.AppImage" > "$HOME/.local/share/applications/deck.desktop"
    RUN="$HOME/Applications/deck.AppImage" ;;
esac

if ! command -v secret-tool >/dev/null 2>&1 && ! pgrep -x gnome-keyring-d >/dev/null 2>&1 && ! pgrep -f kwalletd >/dev/null 2>&1; then
  echo "Note: deck keeps its encryption key in your system keyring (GNOME Keyring or KWallet). If none is running, deck will say so at startup."
fi

trap - ERR
printf "\n\033[1;32mdeck is installed.\033[0m\n"
echo "Your memory, settings and keys are kept between installs. To update, unzip the new version and run this again."
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then (nohup "$RUN" >/dev/null 2>&1 &); fi
[ -t 0 ] && read -r -p "Press Return to close." _ || true
