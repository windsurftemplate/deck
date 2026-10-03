# Build plan

Source of truth for what gets built, in what order, and which file is next.
Full design lives in the plan doc: Personal Agent Swarm: System Architecture & Plan.
Every change is logged in `UPDATES.md`.

Status keys: `todo`, `doing`, `done`, `blocked`.

## Next file

**Your Mac: run the app end to end** (`pnpm install && pnpm --filter @deck/engine build && pnpm --filter @deck/desktop tauri dev`).
Then step 1.5, engine packaging, so the installed app needs no Node.

## Phase 1: Core (weeks 1 to 2)

Gate to leave Phase 1: the daily brief is useful 5 workdays in a row.

### Step 0: Repo scaffold

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 0.1 | `package.json`, `pnpm-workspace.yaml` | Monorepo root, workspace list | `pnpm install` runs clean | done |
| 0.2 | `turbo.json` | Build, test, lint pipelines across packages | `pnpm turbo build` runs | done |
| 0.3 | `mise.toml` | Pinned Node, pnpm, Rust versions | Same versions on every machine | done (verify with `mise install`) |
| 0.4 | `.gitignore`, `.gitleaks.toml` | Keeps DB, `.env`, keys, memory exports out | Gitleaks pre-commit blocks a fake key | done |
| 0.5 | `AGENTS.md` | Conventions for humans and coding agents | Claude Code follows it on a test task | doing |
| 0.6 | `.github/workflows/ci.yml` | Lint, typecheck, tests, gitleaks on every PR | A PR shows green checks | doing |

### Step 1: Desktop shell

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 1.1 | `apps/desktop/src-tauri/tauri.conf.json` | Tauri 2 app config, window, permissions | App opens on Mac | done |
| 1.2 | `apps/desktop/src-tauri/src/main.rs` | Tray icon, background mode, keychain plugin | App keeps running with window closed | done (run on your Mac to confirm tray and keychain) |
| 1.3 | `apps/desktop/src/App.tsx` | Shell UI: chat panel, status, settings stub | Window shows the shell | done (2D) |
| 1.4 | `apps/desktop/src-tauri/src/engine.rs` | Starts the engine, relays JSON lines, forwards events, stop-all reaches the engine | Round trip with a real Node process | done |
| 1.5 | Engine packaging | Ship the engine with the app (bundled Node runtime as a Tauri sidecar, signed) | Installed app starts the engine with no Node on the machine | done (Linux installer verified here; macOS and Windows via the release workflow) |
| 1.6 | Recovery code | Show the workspace key once as a recovery code; restore it on a new machine or after a keychain reset | A wiped keychain plus the code opens the old workspace | done (Settings > Recovery key; Restore on the power-up screen) |
| 1.7 | One-click installers: `Install deck.command` (Mac), `Install deck.cmd` (Windows), `install-linux.sh` (Linux), with uninstallers | Private Node and Rust, system prerequisites, build, install, open | Double-click installs and opens deck | done (Linux run end to end here; Mac and Windows not yet run) |
### Step 2: Memory

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 2.1 | `packages/memory/schema.sql` | Tables: episodes, facts, edges, skills, goals, feedback, conversations | Migration creates all tables | done |
| 2.2 | `packages/memory/db.ts` | SQLite + sqlite-vec + FTS5, SQLCipher key from keychain | Encrypted DB opens and closes | done |
| 2.3 | `packages/memory/write.ts` | Log episode, extract facts, gate (dedupe, specific, contradicts), supersede | Contradiction lands in Needs-you | done |
| 2.4 | `packages/memory/read.ts` | Hybrid retrieval: vector + keyword + one graph hop, token budget | Returns cited memories for a query | done |
| 2.5 | `packages/memory/src/store.ts` | `MemoryStore` interface; SQLite and in-memory adapters; contract suite; export, import and `migrateMemory` | Both adapters pass the contract; SQLite to other store and back keeps everything | done |
| 2.6 | `packages/tracker/src/store.ts` | `TrackerStore` interface; SQLite and in-memory adapters; contract suite | Both adapters pass the contract | done |

### Step 3: Models and Gateway

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 3.1 | `packages/models/adapter.ts` | One interface: chat, vision, embed, decide | Claude call works through the adapter | done |
| 3.2 | `packages/models/gateway.ts` | All calls through VaultProof Gateway with a scoped token | No raw key anywhere in the app | on hold (Gateway API paused; client kept) |
| 3.3 | `packages/models/roles.ts` | Heavy and cheap roles, spend caps, fallbacks | Cap stops calls when hit | done |
| 3.4 | `packages/settings/src/schema.ts` | Settings file (no secrets): VaultProof MCP URL and on/off, boot options; validation | Unsafe URLs refused; cannot turn on without a URL | done |
| 3.5 | `packages/connectors/src/vaultproof.ts` | VaultProof MCP check: handshake, session id, tools list, sign-in needed, not live yet | Each state reported; never blocks boot | done (needs the live server) |
| 3.6 | `apps/desktop/src/SettingsPanel.tsx` | Systems panel: VaultProof URL, connect toggle, saved to app data | Settings survive restart; boot shows off or waiting | done |
| 3.7 | VaultProof sign-in (OAuth in the browser, session in keychain) | Sign in to the MCP server | Signed-in check shows connected | blocked: VaultProof MCP server not live |
| 3.8 | `packages/models/src/direct.ts` | Direct Claude client using a developer key read from the keychain at call time | Key only in the x-api-key header; rejected key explained | done |
| 3.9 | `apps/desktop/src/ModelKeys.tsx` | Settings: API key fields for Anthropic, OpenAI, Gemini, OpenRouter (keychain, last 4 shown) | Wrong-provider key refused; full key never in the UI | done |
| 3.10 | `packages/models/src/embeddings.ts` | OpenAI embeddings with the keychain key | Unit vectors in input order | done |
| 3.11 | `packages/embed-local` | Local embedding model (free, private, 384 dims) | Memory evals 5/5 with the real model | done |
| 3.12 | Settings: embeddings, Telegram, preset, onboarding | Choice of memory search model, bot token and chat id, approval preset | Validated; bad sections fall back on their own | done |
| 3.13 | `packages/models/src/providers.ts` | OpenAI, Gemini and OpenRouter chat adapters; one factory; model lists read from each provider | Each adapter maps turns and usage; bad key and missing model explained | done |
| 3.14 | `apps/desktop/src/ModelRoles.tsx` | Settings: provider and model for heavy work, quick tasks and a backup, with model lists from your keys | Switching saves and the engine reloads; backup takes over when the main model fails | done |
| 3.15 | `packages/agents/src/commands.ts` + engine proposals | Switch models from the chat box ("switch heavy work to Gemini"); confirm card in the app, /apply in Telegram | Nothing changes until confirmed; next reply uses the new model | done |

### Step 4: Orchestrator

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 4.1 | `packages/core/taskboard.ts` | Tasks: create, claim, update, hand off, emit events | Task moves through every state | done |
| 4.2 | `packages/core/events.ts` | Event bus feeding chat, UI and logs | UI updates live from events | done |
| 4.3 | `packages/core/scheduler.ts` | Daily brief time, nightly jobs | Brief fires at set time | done |
| 4.4 | `packages/core/agent-loop.ts` | Claude Agent SDK loop with hooks | Agent runs a tool and stops | done (fake runner tested; real SDK run pending) |
| 4.5 | `apps/engine/src/main.ts` | Agent engine sidecar: opens memory, routes models, runs the Chief of Staff, talks to the UI over stdio | Boot checks come from the engine; chat gets a real reply | done (real process tested over stdio) |
### Step 5: Chief of Staff agent

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 5.1 | `packages/agents/core-rules.md` | Shared rules layer for every prompt | Loaded first in every prompt | done |
| 5.2 | `packages/agents/chief-of-staff/prompt.md` | Role file: mission, done means, ask vs act, style | Passes first 5 eval questions | done |
| 5.3 | `packages/agents/chief-of-staff/tools.json` | Allowed tools and scopes | Out-of-scope tool call refused | done |
| 5.4 | `packages/agents/prompt-builder.ts` | Assembles the 7 prompt layers, cache-friendly order | Top layers hit the prompt cache | done |

### Step 6: Connectors

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 6.1 | `packages/connectors/gmail.ts` | Read inbox, draft (no send yet) | Brief lists today's important emails | done (needs Gmail OAuth to run) |
| 6.2 | `packages/connectors/calendar.ts` | Read today and tomorrow | Brief lists meetings | done (needs Calendar OAuth to run) |
| 6.3 | `packages/tracker/src/tracker.ts` | Built-in issue tracker (replaces Linear): keys, priority, labels, history, search | Brief lists open issues | done |
| 6.4 | `packages/connectors/github.ts` | Read PRs and checks | Brief lists PRs waiting on review | skipped for now |
### Step 7: Safety basics

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 7.1 | `packages/gate/secret-scan.ts` | Scans every outbound prompt for keys and secrets | Planted key is redacted | done |
| 7.2 | `packages/gate/approvals.ts` | Approval queue for external actions | Draft needs approval before send | done |
| 7.3 | `packages/gate/undo.ts` | 60-second undo window on external actions | Undo cancels a send | done |
| 7.4 | `packages/gate/idempotency.ts` | Keys on side-effect tools | Retry never double-sends | done |

### Step 8: Chat front door

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 8.1 | `packages/chat/telegram.ts` | Bot: /brief, /tasks, /approve, /reject, /kill, /status | Approve works from phone | done (needs bot token and your chat id) |
| 8.2 | `packages/chat/voice-notes.ts` | Transcribe voice notes (local Whisper) | Voice note becomes a task | done (needs whisper.cpp and ffmpeg installed) |

### Step 9: Boot and onboarding

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 9.1 | `packages/core/startup-checks.ts` | The 14 startup checks, plain code | Each check reports pass, degraded or blocking | done |
| 9.2 | `apps/desktop/src/boot/PowerUp.tsx` | Ship power-up in 2D, driven by the checks | Segments light as checks pass | done (2D, native checks in Rust) |
| 9.3 | `apps/desktop/src/onboarding/` | Connect LLM, interview, connect accounts, first win | New install reaches first brief | done (LLM key, interview, preset) |
### Step 10: Measure

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 10.1 | `evals/memory/questions.json` | 5 starter questions with fixture answers | Runs in CI | done (5/5) |
| 10.2 | `evals/runner.ts` | Scores evals, posts diff on PRs | Regression blocks a PR | doing (score gate in CI done; PR comment todo) |

## Phase 2: Swarm and safety (in progress)

Gate to leave Phase 2: no raw key anywhere in the app or logs, and every external action went through approval.

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| P2.1 | `packages/models` tool calling | Tools on Claude, OpenAI and Gemini (Gemini thought signatures replayed) | Each provider maps tool calls and results | done |
| P2.2 | `packages/agents/src/act.ts` | Agent loop with the action gate: reads run, writes follow the preset, external always waits for approval | Approved actions run later; rejected never run; secrets stripped from results | done |
| P2.3 | Chief of Staff tools | Issues (list, create, update, comment) and memory (search, remember) | Works from the chat box and Telegram, with approval cards | done |
| P2.4 | Email drafts and calendar holds | Draft replies and hold times, both behind approval | Approve in the app sends the draft | blocked: Google sign-in |
| P2.5 | GTM, Code and Ops agents | Role files, tools, handoffs from the Chief of Staff | A delegated task finishes with a report | done (GTM, Ops, Engineering; Engineering plans only until repo tools exist) |
| P2.6 | Jev routing and Laya intent check | Decide which agent and check each action matches the task | Off-task actions are stopped | blocked: needs your Jev access (API key) and a decision on Laya |
| P2.8 | Crew rules you can change | Settings > Crew (instructions, your rules, each tool Allowed / Ask me / Off, history, undo) and from chat (proposal, then Apply); tool-list ask-first now honored | Changes can only make agents more careful; locked rules shown read-only | done |
| P2.8 | Crew rules | Settings > Crew (instructions, your rules, tools Allowed, Ask me or Off; locked rules shown), chat proposals with Apply, history and undo; tool lists' ask-first honored | Changes only narrow an agent; nothing changes before you confirm | done |
| P2.7 | Verifier | Check work against done-when before reporting done | Unfinished work is not reported done | done |
## Phase 3: Learning (in progress)

Gate to leave Phase 3: eval scores rise two weeks running.

| # | What | Done when | Status |
|---|------|-----------|--------|
| P3.1 | Skills in memory: versions, draft until approved, success and failure counts, in every prompt's index, `load_skill` tool | A skill is used only after approval | done |
| P3.2 | Reflection after checked work proposes a skill (approval card) | Passing work can teach a skill; failing work never does | done |
| P3.3 | Nightly pass at 02:00 (and Run learning now): facts from recent work through the write gate, feedback review, retire failing skills, report to the owner | Runs once per episode; conflicts go to the owner | done |
| P3.4 | Quarantined reader for untrusted content (email, web) | Injected instructions never reach a tool call | blocked: needs the email connector (Google sign-in) |
| P3.5 | Honeytokens | A planted fake secret used anywhere stops the crew and alerts the owner | done |
| P3.6 | Prompt evolution with evals | A prompt change ships only if every eval suite holds or improves | blocked: needs task evals on real models |
| P3.7 | Task and safety eval suites | Replayed tasks and injection attempts scored in CI | safety done (9 cases); task evals need real models |

## Phase 4: World and research (in progress)

Gate to leave Phase 4: first agent PR merged after your review (needs repository tools).

| # | What | Done when | Status |
|---|------|-----------|--------|
| P4.1 | 3D command deck from the Kenney Space Station Kit (CC0): 8 stations, crew astronauts, live status rings and tags, station panel with Approve and Reject, vault beams on approvals, archive lights when the crew learns, core dims when stopped; List view toggle | Stations follow live engine events | done |
| P4.2 | Research agent: web research through Claude, OpenAI or Gemini search with sources (untrusted, 25 a day), crew track-record review, weekly self-review on Mondays | A delegated research task returns sourced findings | done |
| P4.3 | Crew walk to Command when they take a task and when they report back | Motion follows real handoffs | done (camera tours and 3D power-up later) |
| P4.4 | Voice push-to-talk in the app (local whisper.cpp) and camera snapshots | Off by default; indicators always on | voice done; camera todo (needs image input in the model layer) |
| P4.5 | Research agent builds and tests changes in a sandbox and opens PRs | Needs repository access | blocked: GitHub skipped |

## Code signing

- Not needed to build and run on your own Mac (apps you build yourself are not quarantined).
- Needed before sharing installers: without it, macOS blocks the app on first open (workaround: right-click > Open, or remove the quarantine flag) and keychain prompts can repeat after updates. Windows shows a SmartScreen warning.
- Apple Developer Program ($99 a year) when the app goes beyond a few testers; add the certificate as repo secrets and the release workflow signs and notarizes.
- Auto-updates use a separate, free Tauri signing key.

## Database upgrade path

1. Now: SQLite + sqlite-vec, superseded vectors removed so the index stays small.
2. When sqlite-vec's rescore index leaves alpha: turn it on (schema change plus re-index).
3. Only if memory passes about 1 million vectors, or the tracker needs sharing: add a Postgres + pgvector adapter, pass the contract suites, move data with `migrateMemory` and the tracker export.

## Later phases (detail added when Phase 1 passes its gate)

- **Phase 2, swarm and safety:** GTM, Code, Ops agents; Jev routing; Laya gate; kill switches; model settings; verifier.
- **Phase 3, learning:** reflection, skill capture, consolidation, prompt evolution, quarantined reader, honeytokens.
- **Phase 4, world and research:** 3D command deck (look decision pending), research agent, voice push-to-talk, camera snapshots.
- **Phase 5, expand:** see the table below.

## Phase 5: Expand (in progress)

| # | What | Done when | Status |
|---|------|-----------|--------|
| P5.1 | Workspace packs (`packages/packs`): founder, freelancer, student, VaultProof, blank. Rules, tool limits (ask or off only), approved skills, starter issues, preset. Checked so packs can never loosen safety | Applying twice changes nothing; a loosening pack is refused | done |
| P5.2 | Onboarding "Starting setup" step: pick a pack; its interview hints and preset carry into the next steps | New install ends with the pack applied | done |
| P5.3 | One-click installers for Mac, Windows and Linux | Double-click installs and opens deck | done (Linux verified here) |
| P5.4 | Camera snapshots and picture attachments; images on Claude, OpenAI and Gemini | Off by default; camera on only while taking a picture, with a badge; pictures never stored | done |
| P5.5 | Open source the repo: MIT license, security policy, contributing guide, third-party notices | License chosen, full-history secret scan clean, no personal data | done (publish when you push) |
| P5.7 | Chat like a chat app: replies stream word by word with typing dots (Claude, OpenAI, Gemini); saved chats sidebar with rename and delete | Text appears as it is written; each chat keeps its own history | done |
| P5.8 | Second brain: drop files (PDF, Word, Markdown, text, HTML), paste text, add web pages, import Obsidian, Notion and Apple Notes, write notes; all searchable by the crew; 3D map of what it knows | Added content is recalled in chat, marked untrusted | done |
| P5.9 | Station life: asteroid in space with a ringed planet, extra props, blinking lights and beacon, live wall screens (tasks, issues, drafts, memory, tokens, approvals), crew typing at glowing consoles while working, idle crew walking around | Screens show engine numbers; working crew types | done |
| P5.10 | Command center: tokens per day, by model and agent, crew work per day, crew performance table, approvals, brain growth, issues opened and closed (7, 30 or 90 days) | Numbers come from the usage, task and message history | done |
| P5.11 | Crew chat: live feed of handoffs, tool calls, reports, checks, approvals and decisions; crew discussions you start (talk only) with a Chief of Staff summary; you can add to a discussion | Every step of delegated work appears in order | done |
| P5.12 | Tools page: every integration's state; Jev key (keychain) and API address; who can use what | Jev key saved; connection waits for Jev's API docs | done (Jev API todo) |
| P5.6 | Hands-free voice: wake word, request, spoken reply, follow-up without the wake word; desktop notifications in the background | Off by default; badge whenever the mic listens | done |
| P5.15 | Professional UI pass: sidebar navigation, top bar with search, ⌘K command menu, keyboard shortcuts, status bar, toasts, skeleton loading, empty states with one action, KPI trends, elevation by lighter surfaces, Inter + mono with aligned figures, one icon family | Every page uses the same tokens and parts | done |
| P5.13 | Automations: recurring jobs for any agent, set on a page or proposed from chat; results to chat, Crew chat, notifications and Telegram | Runs on schedule while the app is open | done |
| P5.14 | Learning: your documents become facts nightly; prompt tuning drafts guidance from misses, tests it on practice tasks (nothing changed or sent), adopts only a clear win with your approval | Tuned guidance shows in Settings, Crew, and can be removed | done |

## How to use this file

1. Pick the row marked as the next file. Set it to `doing`.
2. Build it on a branch, open a PR.
3. When merged, set it to `done`, add an entry to `UPDATES.md`, and point **Next file** at the next `todo` row.
