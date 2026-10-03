#!/bin/bash
# Removes deck.app. Your memory, settings and keys are kept unless you choose to delete them.
set -uo pipefail
osascript -e 'tell application "deck" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf /Applications/deck.app && echo "Removed /Applications/deck.app."
DATA="$HOME/Library/Application Support/dev.deck.desktop"
read -r -p "Also delete your memory, settings and issues in $DATA? This cannot be undone. Type DELETE to confirm, or press Return to keep them: " ans
if [ "${ans:-}" = "DELETE" ]; then
  rm -rf "$DATA" && echo "Deleted your data. Keychain entries (memory key, API keys) stay; remove 'dev.deck.app' items in Keychain Access if you want them gone."
else
  echo "Kept your data."
fi
read -r -p "Remove the build tools in ~/.deck-tools (Node, Rust copies)? [y/N] " t
[ "${t:-}" = "y" ] && rm -rf "$HOME/.deck-tools" && echo "Removed ~/.deck-tools."
read -r -p "Done. Press Return to close." _ || true
