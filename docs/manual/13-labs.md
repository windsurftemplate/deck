# 13. Labs: features you turn on

**Settings > Labs** holds features that start off. Turn on only what you want. Whatever you turn on, the locked rules still apply: anything that leaves your machine needs your approval, and outside content is treated as data.

## Complexity routing

Simple requests (thanks, quick lookups, "create an issue") go to the **cheap** model; anything that needs thinking, writing or delegation goes to the **heavy** one. The decision uses plain signals, not an extra model call, and picks heavy when unsure. Saves tokens on everyday chat.

## Local models (Ollama)

Run models on your own computer, free, with nothing leaving the machine.

1. Install Ollama from ollama.com and start it.
2. Pull a model in a terminal: `ollama pull llama3.2` (or any model you like).
3. Turn on **Local models** in Labs and press **Check connection**.
4. In Settings > Models, pick **Ollama (local, Labs)** for any role and press Load models.

Local models are slower and less capable than the large hosted ones. Good fits: the cheap role (checking, summaries) or private notes. Web research and pictures need a hosted model.

## Parallel work

The Chief of Staff can hand 2 to 4 independent tasks to the crew at once, for example researching four companies. Each task is still checked. Faster, and uses tokens faster.

## Crew votes

For judgement calls. Each crew member answers on its own without seeing the others, then each ranks the other answers. A Borda count picks the winner, and the Chief of Staff reports it with any strong dissent. Start one in **Crew chat** (choose **Vote** instead of Discussion), or the Chief of Staff can call one. Talk only; no tools run.

## Plugins (MCP servers)

Connect outside tools that speak MCP, such as a ticketing system or a CRM.

1. Turn on **Plugins**, press **Add plugin**, and enter a name and the server's MCP address (https, or http on this computer).
2. Add a token if the server needs one. It goes to the keychain.
3. **Save and connect** lists the plugin's tools.

The Chief of Staff can then use them. **Every call asks you first**, unless you tick **Trust read-only** for that plugin, in which case tools the server marks read-only run without asking. Results are wrapped and scanned as untrusted. Plugins run on their own servers with whatever access their token has, so add only ones you trust.

## Agent pull requests (GitHub)

Engineering can read one repository and propose changes.

1. Create a fine-grained GitHub token limited to that repository with **Contents** and **Pull requests** read and write.
2. Turn on **Agent pull requests**, enter `owner/name` and the token, and save.

Engineering can list and read files, and propose a change: deck creates a new branch, commits the files, and opens a pull request labelled `agent-proposal`. Opening a pull request always asks you first. deck never merges, never pushes to the default branch, and never deletes.

## Gmail and Calendar

The Chief of Staff can search and read mail, see your calendar, and save Gmail drafts. It cannot send: deck does not ask Google for permission to send.

1. In Google Cloud Console, create a project, enable the Gmail API and Google Calendar API, configure the consent screen, and create an **OAuth client** of type **Desktop app**.
2. Turn on **Gmail and Calendar** in Labs, paste the client id and client secret, and save.
3. Press **Connect Google** and finish in your browser. The sign-in comes back to a one-time page on your own computer.

Mail and calendar content is treated as untrusted. Saving a draft asks you first. **Disconnect** removes access from deck; you can also revoke it in your Google account.

## Federation (trusted crews on other computers)

Your crew can talk to crews on other computers you trust, such as a co-founder's deck.

1. Both sides turn on **Federation**, set a crew name, and save.
2. Each side enters the address others reach it at (a LAN address, or a Tailscale name) and presses **Make my invite**.
3. Swap invite codes, and each side pastes the other's under **Add a trusted crew**.
4. Ask the Chief of Staff to message the other crew, or it suggests it. Messages appear in **Crew chat > Federation**.

How it stays safe:

- No discovery: only crews you added by invite can talk to yours. Unknown senders are refused.
- Every message is encrypted and signed; old or replayed messages are dropped.
- Every message you send needs your approval, and secrets and personal data are removed first.
- When another crew asks something, you approve twice: once to let the Chief of Staff draft an answer, and again on the exact answer before it goes.

Use it on a private network. deck listens on the port you set (default 7787) only while Federation is on.

## Camera tours

A **Tour** button on the deck flies through every station, pausing at each. Press **Stop tour** to end it.

## 3D power-up screen

The start-up check as a 3D reactor that lights segment by segment and glows when models are online.

## Sandboxed shell

Engineering can run commands inside your operating system's sandbox: `sandbox-exec` on macOS, bubblewrap on Linux. Not available on Windows; without a sandbox, nothing runs.

| Command kind | Examples | What happens |
|---|---|---|
| Read only | ls, cat, rg, git status, git log, git diff | Runs |
| Changes files in the workspace | editing, building, tests, git commit | Follows your approval preset |
| Uses the network | npm install, pip install, git clone, git push | Always asks you; undo window; network allowed for that command only |
| Blocked | sudo, keychain or SSH access, remote shells, piped installers, startup persistence, commands built at run time | Never runs |

Inside the sandbox, commands can change files only in the workspace folder (default `~/deck-workspace`; deck refuses your home, Desktop, Documents or system folders), cannot read the rest of your home folder, get a clean environment with no keys or tokens, and stop after 2 minutes (5 for network commands). Output is treated as untrusted and keys are removed from it.

### Working on a project

When the shell is on, Engineering works from the project in the workspace (the workspace itself, or its only project folder):

- **The project's own guide.** Its AGENTS.md, CLAUDE.md, README, contributing guide and decision records, plus the build and test commands from them (or from package.json, Makefile, Cargo.toml, go.mod or pyproject.toml). Where deck's memory disagrees, the project's files win.
- **Code search.** Engineering finds code by exact name or by what it does. The index splits code into functions, classes and types, lives in your encrypted workspace, and is brought up to date before every search; a result whose file changed is never shown. Code is never memorized: results point at the file and lines, and Engineering reads the file before changing it. If you use OpenAI for memory search, indexing also sends code pieces to OpenAI for embedding; the default local model keeps them on your computer.
- **What a change affects.** Before changing a function, class or type, Engineering lists its callers, the files that import it and the tests that reach it (directly or through a caller), then runs those tests. Calls are matched by name, so each caller says whether the match is sure (same file, imported, or the only definition with that name).
- **Fixes that worked.** When a failing test passes after a change, deck remembers the error, what fixed it and the files it changed. If the same error comes back, the earlier fix is shown with the failing output, marked possibly stale when those files have changed since.
- **Tests decide.** A code change counts as finished only when the project's test command passes after the last change. deck reads the real exit code from the sandbox, not the agent's report.

## Isolated browser

Research and the Chief of Staff can browse using Chrome, Chromium, Edge or Brave with a separate, empty profile: none of your cookies, logins or saved passwords, no extensions or sync, downloads off. Every request to this computer or your local network is blocked, including images and scripts on a page.

The agent reads each page as text plus numbered links, buttons and fields:

| Action | What happens |
|---|---|
| Open a page, read it, follow links | Runs |
| Type into a field, press an ordinary button | Follows your approval preset |
| Press a button that buys, pays, sends, posts, submits, signs up or deletes | Always asks you; undo window; refused if the page changed since you approved |
| Password, card, PIN or ID fields | Never filled; hidden from the agent |

The browser closes after 10 idle minutes and whenever you press Stop all agents. Turn on "Show the browser window" to watch it work.
