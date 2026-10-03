#!/usr/bin/env bash
# Removes deck. Your memory, settings and issues are kept unless you type DELETE.
set -uo pipefail
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
pkill -x deck >/dev/null 2>&1 || true
if command -v dpkg >/dev/null 2>&1 && dpkg -s deck >/dev/null 2>&1; then $SUDO apt-get remove -y deck && echo "Removed deck."
elif command -v rpm >/dev/null 2>&1 && rpm -q deck >/dev/null 2>&1; then $SUDO dnf remove -y deck && echo "Removed deck."
elif [ -f "$HOME/Applications/deck.AppImage" ]; then rm -f "$HOME/Applications/deck.AppImage" "$HOME/.local/share/applications/deck.desktop" && echo "Removed deck."
else echo "deck was not found."; fi
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/dev.deck.desktop"
read -r -p "Also delete your memory, settings and issues in $DATA? This cannot be undone. Type DELETE to confirm, or press Return to keep them: " ans
if [ "${ans:-}" = "DELETE" ]; then rm -rf "$DATA" && echo "Deleted. Keyring entries named dev.deck.app stay; remove them in your keyring app if you want."; else echo "Kept your data."; fi
read -r -p "Remove the build tools in ~/.deck-tools? [y/N] " t
[ "${t:-}" = "y" ] && rm -rf "$HOME/.deck-tools" && echo "Removed ~/.deck-tools."
