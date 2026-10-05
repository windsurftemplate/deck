# 10. Safety, privacy and your data

## The rules that never change

These are in code, not settings. No preset, pack, crew rule, chat request or learned guidance can turn them off.

- Anything that leaves your machine needs your approval.
- Secrets (API keys, tokens, passwords) are stripped from anything sent to a model, and from tool results.
- Text from outside (web pages, documents, email) is wrapped and marked as data, never instructions.
- A planted secret (the tripwire, or honeytoken) stops all agents if any tool call ever contains it.
- Crew members cannot delegate. Every task stops after a set number of steps.

## Undo window and duplicate protection

Every approved action that leaves your machine waits out an undo window (60 seconds by default, 0 to 300 in Settings > CISO) before it runs. Press **Undo** in the bar at the bottom of the screen, send `/undo <id>` in Telegram, or press **Stop all agents**, and it never runs. Separately, deck remembers every outside action it has run for 24 hours: the same tool with the same details (ignoring case and spacing) is refused as "already done", and an identical request already waiting for you is not queued again.

## The CISO

A crew member dedicated to deck's own security. It gives a risk opinion (low, medium, high) on every approval card, answers security questions using a live security status (tripwire alerts, scanner flags, refused actions, approvals, Labs features, plugins, federation, Google and GitHub access, setup health), and runs a review every Monday at 09:30 that opens an issue for each high-risk finding. After a tripwire stop it posts an incident note. It advises only: it cannot approve, reject, block or change settings. Settings > CISO has the review switch, **Show security status** and **Run security review now**.

## The input scanner

Text from outside is checked for signs that it is trying to give orders: "ignore previous instructions", fake system messages, attempts to change the AI's persona, requests for keys, requests to hide something from you, image links that carry data out, and long encoded blocks. Hidden characters that can conceal instructions are removed. Flagged content carries a warning every time an agent reads it.

## The tripwire

On first start deck plants a fake "backup admin code" in memory. No legitimate task ever needs it. If any agent tries to use it in a tool call, the call is blocked, every agent stops, and you get a security alert. This catches injected instructions that got the model to go looking for secrets.

## Safety tests

deck runs a set of safety tests that assume the model fully obeys an attacker's instructions hidden in an email: a send waits for approval on every preset, a rejected send never runs, a denied tool is never offered, secrets never reach the model, the wrapper cannot be closed from inside, and the tripwire stops the run. Any change that lowers the score fails the build.

## Where your data lives

| What | Mac | Windows | Linux |
|---|---|---|---|
| Memory, chats, issues, goals, brain (encrypted) | `~/Library/Application Support/dev.deck.desktop/workspace.db` | `%APPDATA%\dev.deck.desktop\workspace.db` | `~/.local/share/dev.deck.desktop/workspace.db` |
| Settings | `settings.json` in the same folder | same | same |
| Memory key, API keys | Keychain (items named `dev.deck.app`) | Credential Manager | GNOME Keyring or KWallet |
| Backups | `~/Documents/deck-backups` | `Documents\deck-backups` | `~/Documents/deck-backups` |
| Build tools | `~/.deck-tools` | `%LOCALAPPDATA%\deck-tools` | `~/.deck-tools` |
| Install log | `~/Library/Logs/deck-install.log` | `%LOCALAPPDATA%\deck-install.log` | `~/.local/state/deck-install.log` |

## Recovery key

The memory key unlocks `workspace.db`. It lives in your keychain. If the keychain entry is ever lost, deck refuses to create a new key (which would lock your old data) and shows a **Restore** box where you paste your recovery key. Find it in Settings > Recovery key. Store it in a password manager.

## Backups

**Settings > Backups**:

- **Back up now** with a passphrase of 12 characters or more. The backup holds your workspace, memory key and settings, encrypted with your passphrase.
- **Restore backup**: pick a `.deckbak` file and enter its passphrase. Your current workspace is kept aside as `workspace.before-restore.db`, and deck restarts.

Without the passphrase, a backup cannot be opened, by anyone. Keep the passphrase in a password manager. Make a backup at least every two weeks; setup health reminds you.

## What leaves your machine

| What | Where it goes | When |
|---|---|---|
| Your messages, recalled memory, task briefs | Your model provider | Every model call |
| Pictures | Your model provider | Only when you attach them |
| Search questions (personal data removed) | Your model provider's search | Research tasks |
| Web pages you add | The site you linked | When you add them |
| Telegram messages | Telegram | Only if you turn it on |
| Text for quick decisions (requests, finished-work reports, approval details, documents you add), secrets removed | TypeSafe AI (Jev) | Only if you turn Jev on |

Speech never leaves your machine. Memory search runs locally unless you choose OpenAI embeddings.
