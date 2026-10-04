# deck

A local-first AI agent crew for your desktop. A Chief of Staff talks with you and hands work to a crew of specialists (GTM, Operations, Engineering, Research, CISO, and members you define). Everything they know lives in an encrypted file on your computer. Anything that leaves your machine waits for your approval.

Version 0.1.0 · MIT license · Mac, Windows and Linux

## Contents

1. [What deck does](#what-deck-does)
2. [Install](#install)
3. [First run](#first-run)
4. [The crew](#the-crew)
5. [How agents work](#how-agents-work)
6. [Features](#features)
7. [Labs (off until you turn them on)](#labs-off-until-you-turn-them-on)
8. [Safety and privacy](#safety-and-privacy)
9. [Models](#models)
10. [Limits](#limits)
11. [Evals and tests](#evals-and-tests)
12. [Architecture](#architecture)
13. [Development](#development)
14. [Documentation](#documentation)
15. [What deck will not do](#what-deck-will-not-do)
16. [Status and known gaps](#status-and-known-gaps)
17. [License, security and contributing](#license-security-and-contributing)

## What deck does

- **Chat with a Chief of Staff** that plans, remembers, and delegates to a crew. Replies stream as they are written; chats are saved.
- **Delegated work is checked.** Every task has a "done when" list; a separate model checks the result, retries once with what was missing, and escalates to a stronger model if needed.
- **Memory that lasts.** Facts, events, documents and skills in an encrypted SQLite file, searched by meaning and keywords, with history kept when facts change.
- **A second brain.** Add files, notes, web pages, Obsidian vaults, Notion exports and Apple Notes; capture business cards, whiteboards and documents with your camera; explore it all in a 3D map or an investigation board.
- **Goals, automations and workflows.** Big goals become milestones with weekly progress checks; jobs run on a schedule; multi-step workflows chain crew members.
- **Research.** Web research with sources, research swarms that search several angles at once, and meeting prep briefs from professional sources.
- **Learning without retraining.** Experience recall, failure lessons, an evolving playbook per agent, skills you approve, nightly learning and tested prompt tuning.
- **Safety by design.** Locked rules in code, an approval for every external action, a CISO that reviews each approval, an input scanner, a tripwire, a plan lock, and safety evals that assume the model is compromised.
- **A 3D command deck** showing who is working, what waits for you, and how much budget is used.

## Install

You need a Mac (Apple Silicon or Intel), Windows 10 or 11 (64-bit), or Linux, about 5 GB free for the first install, and an API key (OpenAI recommended; Anthropic, Google Gemini and OpenRouter also work). No coding needed.

### Mac

1. Unzip `deck.zip`.
2. Open Terminal, type `bash ` (with a space), drag **Install deck.command** into the window, press Return.
3. The first install takes 10 to 20 minutes. deck opens from Applications.

Running it through `bash` avoids macOS blocking a downloaded script. Or unblock the folder once: `xattr -dr com.apple.quarantine ~/Downloads/deck`. The installer keeps its own Node and Rust in `~/.deck-tools` and logs to `~/Library/Logs/deck-install.log`.

### Windows

1. Right-click `deck.zip`, Properties, tick **Unblock**, OK, then unzip.
2. Double-click **Install deck.cmd** (SmartScreen: More info, Run anyway).
3. It may install Microsoft's C++ build tools and WebView2 (several GB). First run: 20 to 40 minutes. Log: `%LOCALAPPDATA%\deck-install.log`.

### Linux

Run `./install-linux.sh`. Ubuntu and Debian get a `.deb`, Fedora an `.rpm`, others an AppImage in `~/Applications`. Needs GNOME Keyring or KWallet.

### Updating and uninstalling

Unzip the new version and run its installer the same way; memory, settings and keys are kept. **Uninstall deck.command**, **Uninstall deck.cmd** or `./uninstall-linux.sh` remove the app and only delete your data if you type `DELETE`.

Prebuilt installers (`.dmg`, `.msi`/`.exe`, `.deb`, AppImage) are produced by the release workflow when a tag like `v0.2.0` is pushed.

## First run

1. **Power-up check.** A ring (or a 3D reactor, in Labs) lights as each system checks out: keychain, memory, models, scheduler and more. Problems show a plain fix.
2. **Connect an LLM.** OpenAI is first. Paste your key; deck picks the newest OpenAI reasoning model for heavy work and the newest mini for quick work, and re-checks weekly. Keys go to the system keychain, never a file.
3. **Starting setup.** Pick a pack: Startup founder, Freelancer, Student, VaultProof, or blank. Packs can only make the crew more careful.
4. **About you.** Name, role, priorities, people, style. These become facts.
5. **How much to ask.** Cautious, Balanced (default) or Autonomous.
6. **Ready.** Save your recovery key in a password manager.

## The crew

| Agent | Does | Cannot |
|---|---|---|
| Chief of Staff | Talks with you, plans, delegates, keeps approvals in one place, proposes settings and schedules | Act outside your machine without approval |
| GTM | Leads, outreach drafts, follow-ups | Send email or contact anyone |
| Operations | Tracker hygiene, admin drafts, commitments | Send, delete, pay |
| Engineering | Breaks work into issues, records decisions, opens pull requests (Labs) | Merge or deploy |
| Research | Web research with sources, research swarms, weekly crew self-review | Contact anyone |
| CISO | deck's own security: a risk opinion on every approval, security status, weekly security review | Approve, reject, block or change anything (advice only) |
| Your crew members | Up to 8 you define: name, role, tools from a safe list | Delegate, send, or use tools outside the safe list |
| Helpers | Temporary agents created by any of the above for one task; dissolved after reporting | Create helpers, delegate, or do anything external |

Only the Chief of Staff delegates. Crew members (built-in or yours) can create up to 10 temporary helpers per task; keeping one as a crew member is your choice.

## How agents work

Every agent runs the same loop: **observe, think, act, reflect**.

1. **Observe.** A "Situation now" section: time, approvals waiting, goals, its recent misses, budget used, and notes prepared while you were idle. Plus memory recall and similar past tasks with their lessons.
2. **Think.** Complex work gets a short plan first (a call with no tools, so planning cannot act). Hard work (analysis, comparisons, decisions) also uses the model's built-in reasoning. Simple requests skip both. Summaries appear in Crew chat as "Thinks".
3. **Act.** Tool calls pass an action gate: permissions, your tool settings, approvals, the tripwire, and the plan lock (once outside content is in play, only planned tools can run).
4. **Reflect.** Failed or refused steps are reported back plainly so the agent revises its plan. A living to-do list restates the plan and progress every step.
5. **Check.** For delegated work, a separate model checks the result against the "done when" list; one retry with the gaps; then escalation to the strong model.

## Features

### Chat
Streaming replies, saved chats, pictures (snapshots and attachments, never stored), push-to-talk and hands-free voice with a wake word (transcribed on your machine with whisper.cpp), spoken replies, desktop notifications, and Telegram (only your chat id).

### Pages

| Page | What it is |
|---|---|
| Deck | 3D space station: crew at stations, status rings, approvals at the Vault, live screens. Optional camera tours |
| Brain | Second brain: add, capture and import; 3D map; notes with `[[links]]`; library |
| Board | Investigation board: people, companies, facts and documents pinned with string between them |
| Goals | Goals planned into milestone issues, progress bars, weekly checks |
| Command center | Setup health score with fixes, spend, crew performance, brain growth, issues |
| Crew chat | Every handoff, tool call, report, check, thought and approval; crew discussions and votes; federation messages |
| Automations | Scheduled jobs and multi-step workflows |
| Tools | Integrations, keys, model arena, who can use what |
| List view | The same information without 3D |
| Help and course | The user manual and a 15-chapter course on how AI agents work, with search and quizzes |

### Second brain
Files (PDF, Word, Markdown, text, CSV, JSON, HTML, 25 MB each), pasted text, web pages (private addresses refused), Obsidian or Markdown folders, Notion exports, Apple Notes, in-app notes, and camera capture of business cards, whiteboards and documents (text only; photos of people are refused). Everything is split into passages, searched by meaning and keywords, and given to the model as untrusted data. Nightly learning turns new files and notes into facts.

### Research
- **Web research** through the model provider's search tool, with sources; 25 searches a day; personal data removed from search questions.
- **Research swarm**: 2 to 5 searches in parallel, combined into one brief with numbered sources and disagreements noted.
- **Meeting prep**: by name, from your memory and calendar plus professional sources only; private life excluded and filtered; saved to the second brain.

### Goals, automations, workflows
Goals are planned into 3 to 7 dated milestones (as issues) and checked every Monday. Automations run Chief of Staff jobs, crew tasks or workflows on a schedule (while deck is open). Workflows chain 2 to 6 steps, each seeing earlier results; templates included.

### Learning
| Mechanism | What happens |
|---|---|
| Memory filter | Rejects vague facts, merges duplicates, keeps history when facts change, sends contradictions to review |
| Experience recall | Agents see similar past tasks, how they went, and failure lessons |
| Failure lessons | One sentence per failed task on what to do differently |
| Playbook (ACE) | Separate lessons per agent with helped and misled counts; added, never reworded; retired when they keep misleading |
| Skills | Proposed from checked work, used only after you approve; open SKILL.md format for import and export |
| Nightly learning (02:00) | Facts from events and new documents, rejection review, skill retirement |
| Prompt tuning (Sundays) | New lessons tested on practice runs of real tasks; adopted only with a clear win and your approval |
| Model arena | Compares your models on an agent's past tasks; one click gives that agent its own model |
| Idle-time notes | After 20 idle minutes, short notes per agent from facts and the crew's own history |

### Command center and setup health
A score out of 100 from twelve checks (key, fallback, backup, preset, tripwire, budget, learning, stale approvals, success rate, automations, Telegram, web research), each with a fix; daily history and alerts when a check starts failing. Charts for tokens, crew work and performance, brain growth and issues.

### Backups
Encrypted backups (workspace, memory key and settings, sealed with your passphrase using scrypt and AES-256-GCM) to Documents/deck-backups; restore on any computer with the file and the passphrase.

## Labs (off until you turn them on)

| Feature | What it adds |
|---|---|
| Complexity routing | Simple chat to the cheap model, real work to the heavy one |
| Local models (Ollama) | Free, private models on your computer |
| Parallel work | 2 to 4 delegated tasks at once |
| Crew votes | Independent answers, ranked by the crew (Borda count), with dissent |
| Plugins (MCP) | Outside MCP servers as tools; every call asks unless you trust read-only tools |
| Agent pull requests | Engineering opens pull requests on a new branch; asks first; never merges |
| Gmail and Calendar | Read mail and calendar, save drafts with approval; no send permission is ever requested |
| Federation | Invite-only, signed and encrypted messages with trusted crews; you approve everything outgoing |
| Camera tours, 3D power-up | Visual extras |

## Safety and privacy

**Locked rules** (in code; no setting, pack, prompt or learning can change them): anything that leaves your machine needs approval; secrets are stripped from prompts and tool results; outside text is wrapped as untrusted data; using the planted tripwire stops every agent; crew members cannot delegate; every run has a step limit.

**Layers**: per-agent permissions you can only narrow; an action gate on every tool call; approvals (on every preset for external actions); the CISO's risk opinion on every approval; an input scanner that flags instruction-like text and strips hidden characters; personal data removed from web searches; the plan lock; the tripwire; budgets; and a stop switch that rejects everything waiting.

**Your data stays local**:

| What | Where |
|---|---|
| Memory, chats, issues, goals, brain (encrypted with SQLCipher) | `workspace.db` in the app data folder (`dev.deck.desktop`) |
| Memory key and API keys | System keychain (shown only by their last 4 characters) |
| Backups | Documents/deck-backups |

What leaves your machine: requests to your model provider (messages, recalled memory, task briefs, pictures you attach), search questions (personal data removed), pages you add, and Telegram messages if you turn Telegram on. Speech never leaves.

## Models

| Role | Default |
|---|---|
| Heavy (Chief of Staff and crew) | Newest OpenAI reasoning model your key can use (auto-pick, re-checked weekly) |
| Cheap (checks, summaries, learning, CISO reviews) | Newest OpenAI mini model (auto-pick) |
| Fallback | Optional, ideally another provider |
| Escalation | When work fails on a smaller model, retried once on the strong model |
| Per agent | Set by the model arena |

Providers: OpenAI, Anthropic, Google Gemini, OpenRouter, and Ollama (Labs). Built-in reasoning is used on hard work with Claude, Gemini 2.5 and OpenAI reasoning models. Memory search runs a local embedding model by default (all-MiniLM-L6-v2, 384 dimensions) or OpenAI embeddings.

## Limits

| What | Limit |
|---|---|
| Agents | Chief of Staff, 5 built-in crew, up to 8 of yours, plus helpers |
| Delegation | One level; only the Chief of Staff delegates |
| Helpers | Up to 10 per task (setting: 1 to 20), 5 at once, one level, shared token budget (300,000 by default) |
| Steps per run | 6, plus one checker retry and one escalation |
| Parallel work (Labs) | 2 to 4 tasks |
| Workflows | 2 to 6 steps |
| Daily tokens | 2,000,000 by default (your setting) |
| Web searches | 25 a day |
| Never possible | Sending email, paying, merging code, deleting |
| When deck is closed | Nothing runs |

## Evals and tests

- **Memory evals** (`evals/`): a realistic history is loaded into a real encrypted store and 5 questions must return the right facts and not outdated ones; also run with the real local embedding model.
- **Safety evals** (`evals/`): a deliberately compromised model obeys an injected email; 9 cases check that sends wait for approval on every preset, rejected and denied actions never run, secrets never reach the model, the untrusted wrapper cannot be closed, the tripwire stops the run, and prompts are scrubbed.
- **Baseline gate**: `evals/baseline.json` holds the minimum scores (100% for both); a drop fails the build.
- **In the app**: the checker on every delegated task, practice runs for tuning and the arena with an adoption rule, and production signals in the Command center.
- **Tests**: 263 TypeScript tests across all packages and 6 Rust tests; `pnpm check` runs lint, type checks and tests. CI also runs a gitleaks secret scan on every push.

## Architecture

```
apps/desktop          Tauri 2 shell (Rust) + React UI
apps/engine           Agent engine (Node), JSON lines over stdio, bundled as a sidecar
packages/agents       Prompts, roles, the agent loop, action gate, crew rules, learning, tuning, routing, SKILL.md
packages/chat         Telegram bot, voice notes
packages/connectors   MCP client, GitHub, Google (OAuth with PKCE), VaultProof check
packages/core         Events, task board, scheduler, startup checks
packages/embed-local  Local embedding model
packages/gate         Secret scanner, input scanner, approvals, undo, idempotency
packages/ingest       Importers: PDF, Word, Markdown, web pages, Obsidian, Notion, Apple Notes
packages/memory       Encrypted SQLite + sqlite-vec + FTS5, MemoryStore port, documents, graph
packages/models       OpenAI, Anthropic, Gemini, OpenRouter, Ollama adapters; streaming; reasoning; router; auto-pick
packages/packs        Starting setups
packages/settings     Settings schema and validation
packages/tracker      Built-in issue tracker, TrackerStore port
evals/                Memory and safety evals with a baseline
docs/                 User manual and course (also inside the app)
scripts/              Engine packaging, Windows installer script
```

Key choices: all storage behind `MemoryStore` and `TrackerStore` interfaces with contract tests; keys only in the OS keychain; one chat interface over every provider; safety enforced in code, not prompts. App identifier `dev.deck.desktop`.

## Development

Toolchain is pinned with [mise](https://mise.jdx.dev): Node 22, pnpm 9.15, Rust stable, gitleaks.

```
mise install
pnpm install
pnpm check          # lint, type check and all tests
pnpm dev            # run in development
pnpm build          # build every package
pnpm secrets        # gitleaks scan
```

A pre-commit hook scans for secrets. `scripts/package-engine.mjs` bundles the engine with its Node runtime for the desktop app. Read `AGENTS.md` (rules for contributors and coding agents), `BUILD_PLAN.md` (what was built and why) and `UPDATES.md` (detailed change log).

## Documentation

Everything is also inside the app under **Help and course** (Cmd/Ctrl + 9), with search and quizzes. Start at [`docs/README.md`](docs/README.md).

- **User manual** (13 chapters): getting started, the basics, chat, the deck and Crew chat, the second brain, goals and automations, the command center, models and tools, learning, safety and privacy, settings reference, troubleshooting and FAQ, Labs.
- **Course: how AI agents work** (15 chapters, each with a lab on deck's code and a quiz): from what an agent is, through language models, context engineering, tools and MCP, the agent loop, memory and retrieval, multi-agent systems, learning, security and evals, to production engineering and forward deployed engineering (discovery, pilots, rollout and security reviews), ending with a capstone.

## What deck will not do

deck does not identify people from photos or faces, search faces online, or build profiles of people from pictures. Capture reads text from cards, boards and documents only; meeting prep works from a name and professional sources. deck also never sends email, pays, merges code or deletes on its own.

## Status and known gaps

- Built and tested here with stand-in models and servers; first runs against live providers happen on your machine.
- Live-model evals and eval cases for the newest features (plan lock, CISO reviews, helpers, playbook) are next.
- Automations run only while deck is open.
- The 3D deck shows built-in stations; your own crew members and helpers appear in Crew chat and the list view.
- Jev routing is waiting on its API docs (the key is already stored).

## License, security and contributing

MIT license (see `LICENSE`; third-party notices in `THIRD_PARTY_NOTICES.md`; 3D models from the Kenney Space Station Kit, CC0). Report vulnerabilities as described in `SECURITY.md`. See `CONTRIBUTING.md` to contribute.
