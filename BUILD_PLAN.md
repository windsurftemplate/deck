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
- **Phase 5, expand:** workspace packs, full onboarding, signed installers, open source, hands-free voice.

## How to use this file

1. Pick the row marked as the next file. Set it to `doing`.
2. Build it on a branch, open a PR.
3. When merged, set it to `done`, add an entry to `UPDATES.md`, and point **Next file** at the next `todo` row.
