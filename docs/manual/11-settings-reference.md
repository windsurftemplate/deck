# 11. Settings reference

Open Settings from the sidebar or with <kbd>Cmd</kbd> + <kbd>,</kbd>. Every card, in order.

| Card | What you set | Notes |
|---|---|---|
| **API keys** | One key per provider | Stored in the keychain. Only the last 4 characters are ever shown. Remove deletes it from the keychain |
| **Models** | Heavy, cheap and fallback model; daily token budget | **Load models** lists what your key can use |
| **Memory search** | Local or OpenAI embeddings | Switching rebuilds search automatically |
| **Approvals** | Cautious, Balanced or Autonomous | Anything external always asks |
| **Telegram** | Bot token, your chat id, on or off | Only your chat id is answered |
| **VaultProof** | MCP address, on or off | Off by default. Connection status shows on the power-up screen |
| **Crew** | Per agent: instructions, rules, tool modes; history and undo; learned guidance | Changes only make agents more careful |
| **Learning** | Run learning now, Tune prompts now, last report | Nightly at 02:00, tuning Sunday nights |
| **Voice** | whisper.cpp program and model paths; push-to-talk; read replies aloud; hands-free and wake word | All speech stays on your machine |
| **Notifications** | Desktop notifications on or off | Only when deck is in the background |
| **Camera and pictures** | Allow snapshots and attachments | Off by default |
| **Backups** | Back up now; restore | Passphrase of 12 characters or more |
| **Recovery key** | Reveal; restore | Store it in a password manager |

## Settings you can change from chat

| You say | Result |
|---|---|
| "Switch heavy work to Claude Opus" | Proposal, Apply to confirm |
| "Use Gemini as the fallback" | Proposal |
| "From now on, Research should prefer primary sources" | Crew rule proposal |
| "Every Friday at 4, have Operations close stale issues" | Automation proposal |

Nothing changes until you press Apply.
