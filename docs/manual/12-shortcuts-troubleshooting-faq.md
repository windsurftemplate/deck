# 12. Shortcuts, troubleshooting, FAQ and glossary

## Keyboard shortcuts

On Windows and Linux use <kbd>Ctrl</kbd> where this says <kbd>Cmd</kbd>.

| Keys | Does |
|---|---|
| <kbd>Cmd</kbd> + <kbd>K</kbd> | Search or jump to any page, action, chat or document |
| <kbd>Cmd</kbd> + <kbd>1</kbd> to <kbd>9</kbd> | Deck, Brain, Goals, Command center, Crew chat, Automations, Tools, List view, Help |
| <kbd>Cmd</kbd> + <kbd>N</kbd> | New chat |
| <kbd>Cmd</kbd> + <kbd>J</kbd> | Show or hide the chat panel |
| <kbd>Cmd</kbd> + <kbd>,</kbd> | Settings |
| <kbd>Esc</kbd> | Stop recording, turn hands-free off, close the search menu |
| Arrow keys and Return | Move and choose in the search menu |

## Troubleshooting

| Problem | Fix |
|---|---|
| macOS says it cannot verify the installer | Run it with `bash` in Terminal, or unblock the folder with `xattr -dr com.apple.quarantine <folder>` |
| "Permission denied" running the installer | Put `bash ` in front of the path |
| Install stops at signing: "detritus not allowed" | Fixed in the current installer. Use the latest zip |
| Windows SmartScreen blocks it | More info, then Run anyway; or unblock the zip in its Properties before unzipping |
| Models segment stays dark | Add a key in Settings > API keys and press Test |
| "The API key was rejected" | The key is wrong or revoked; paste a new one |
| Replies stop with a budget message | You reached the daily token budget; raise it in Settings > Models or wait until tomorrow |
| "The workspace exists but its key is missing" | Use the Restore box with your recovery key, or restore a backup |
| Web research says it needs Claude, OpenAI or Gemini | Your main model is on OpenRouter; switch the heavy model |
| Talk button missing | Turn on push-to-talk in Settings > Voice |
| "Microphone not available" | Allow microphone access for deck in your system privacy settings |
| Apple Notes import blocked | System Settings > Privacy & Security > Automation: allow deck to control Notes |
| A PDF is refused for having no text layer | It is a scan. Run it through OCR first, or paste the text |
| Automations did not run | deck must be open at the scheduled time |
| The deck is slow or blank | Switch to List view (<kbd>Cmd</kbd> + <kbd>8</kbd>) |

When asking for help, include the install log or a screenshot.

## FAQ

**Can the crew send emails or post for me?** Not without your approval, ever. Email sending also waits for the Google connection.

**Does deck train AI models on my data?** No. Your provider receives the requests deck sends, under your account's terms. deck itself sends nothing anywhere else.

**What does it cost?** deck is free (MIT license). You pay your model provider for tokens. The daily budget caps it.

**Can I use deck on two computers?** Make a backup on one and restore it on the other. Changes do not sync automatically.

**What happens if I lose my laptop?** Restore your latest backup on a new one with its passphrase.

**Can I change what an agent does?** Yes, in Settings > Crew, or by asking in chat. You can make agents more careful; you cannot give them more power.

**Why did the crew not finish a task?** Open Crew chat: the verifier lists exactly what was missing.

## Glossary

| Term | Meaning |
|---|---|
| Agent | A model given a role, tools and a loop that lets it act step by step |
| Approval | Your yes or no on an action that needs you |
| Chief of Staff | The agent you talk to; it plans and delegates |
| Crew | The agents that do delegated work |
| Done when | The list of checks that decide if a task is finished |
| Embedding | A list of numbers that captures meaning, used to search by meaning |
| Episode | A short log entry of something that happened |
| Fact | A short statement in memory, stated by you or inferred by the crew |
| Fallback | The model tried when the main one fails |
| Honeytoken (tripwire) | A planted fake secret that stops everything if used |
| Learned guidance | Tested, approved advice added to an agent's instructions |
| MCP | Model Context Protocol, a standard way to connect tools to AI |
| Preset | How much the crew asks before acting: Cautious, Balanced or Autonomous |
| Proposal | A change the crew suggests that you apply or cancel |
| Skill | An approved, reusable procedure |
| Token | A piece of text (about 4 characters of English) that models read and write and providers bill by |
| Untrusted | Content from outside, treated as data and never as instructions |
| Verifier | The cheaper model that checks work against its done-when list |
| Workflow | Steps across agents where each result feeds the next |
