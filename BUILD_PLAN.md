# Build plan

Source of truth for what gets built, in what order, and which file is next.
Full design lives in the plan doc: Personal Agent Swarm: System Architecture & Plan.
Every change is logged in `UPDATES.md`.

Status keys: `todo`, `doing`, `done`, `blocked`.

## Next file

**`apps/desktop/src-tauri/tauri.conf.json` (step 1.1, desktop shell).**
Step 0 is built and verified, except the two rows marked `doing` that need a check on your machine or GitHub.

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
| 1.1 | `apps/desktop/src-tauri/tauri.conf.json` | Tauri 2 app config, window, permissions | App opens on Mac | todo |
| 1.2 | `apps/desktop/src-tauri/src/main.rs` | Tray icon, background mode, keychain plugin | App keeps running with window closed | todo |
| 1.3 | `apps/desktop/src/App.tsx` | Shell UI: chat panel, status, settings stub | Window shows the shell | todo |

### Step 2: Memory

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 2.1 | `packages/memory/schema.sql` | Tables: episodes, facts, edges, skills, goals, feedback, conversations | Migration creates all tables | todo |
| 2.2 | `packages/memory/db.ts` | SQLite + sqlite-vec + FTS5, SQLCipher key from keychain | Encrypted DB opens and closes | todo |
| 2.3 | `packages/memory/write.ts` | Log episode, extract facts, gate (dedupe, specific, contradicts), supersede | Contradiction lands in Needs-you | todo |
| 2.4 | `packages/memory/read.ts` | Hybrid retrieval: vector + keyword + one graph hop, token budget | Returns cited memories for a query | todo |

### Step 3: Models and Gateway

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 3.1 | `packages/models/adapter.ts` | One interface: chat, vision, embed, decide | Claude call works through the adapter | todo |
| 3.2 | `packages/models/gateway.ts` | All calls through VaultProof Gateway with a scoped token | No raw key anywhere in the app | todo |
| 3.3 | `packages/models/roles.ts` | Heavy and cheap roles, spend caps, fallbacks | Cap stops calls when hit | todo |

### Step 4: Orchestrator

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 4.1 | `packages/core/taskboard.ts` | Tasks: create, claim, update, hand off, emit events | Task moves through every state | todo |
| 4.2 | `packages/core/events.ts` | Event bus feeding chat, UI and logs | UI updates live from events | todo |
| 4.3 | `packages/core/scheduler.ts` | Daily brief time, nightly jobs | Brief fires at set time | todo |
| 4.4 | `packages/core/agent-loop.ts` | Claude Agent SDK loop with hooks | Agent runs a tool and stops | todo |

### Step 5: Chief of Staff agent

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 5.1 | `packages/agents/core-rules.md` | Shared rules layer for every prompt | Loaded first in every prompt | todo |
| 5.2 | `packages/agents/chief-of-staff/prompt.md` | Role file: mission, done means, ask vs act, style | Passes first 5 eval questions | todo |
| 5.3 | `packages/agents/chief-of-staff/tools.json` | Allowed tools and scopes | Out-of-scope tool call refused | todo |
| 5.4 | `packages/agents/prompt-builder.ts` | Assembles the 7 prompt layers, cache-friendly order | Top layers hit the prompt cache | todo |

### Step 6: Connectors

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 6.1 | `packages/connectors/gmail.ts` | Read inbox, draft (no send yet) | Brief lists today's important emails | todo |
| 6.2 | `packages/connectors/calendar.ts` | Read today and tomorrow | Brief lists meetings | todo |
| 6.3 | `packages/connectors/linear.ts` | Read and create issues | Brief lists open issues | todo |
| 6.4 | `packages/connectors/github.ts` | Read PRs and checks | Brief lists PRs waiting on review | todo |

### Step 7: Safety basics

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 7.1 | `packages/gate/secret-scan.ts` | Scans every outbound prompt for keys and secrets | Planted key is redacted | todo |
| 7.2 | `packages/gate/approvals.ts` | Approval queue for external actions | Draft needs approval before send | todo |
| 7.3 | `packages/gate/undo.ts` | 60-second undo window on external actions | Undo cancels a send | todo |
| 7.4 | `packages/gate/idempotency.ts` | Keys on side-effect tools | Retry never double-sends | todo |

### Step 8: Chat front door

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 8.1 | `packages/chat/telegram.ts` | Bot: /brief, /tasks, /approve, /reject, /kill, /status | Approve works from phone | todo |
| 8.2 | `packages/chat/voice-notes.ts` | Transcribe voice notes (local Whisper) | Voice note becomes a task | todo |

### Step 9: Boot and onboarding

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 9.1 | `packages/core/startup-checks.ts` | The 14 startup checks, plain code | Each check reports pass, degraded or blocking | todo |
| 9.2 | `apps/desktop/src/boot/PowerUp.tsx` | Ship power-up in 2D, driven by the checks | Segments light as checks pass | todo |
| 9.3 | `apps/desktop/src/onboarding/` | Connect LLM, interview, connect accounts, first win | New install reaches first brief | todo |

### Step 10: Measure

| # | File | What it does | Done when | Status |
|---|------|--------------|-----------|--------|
| 10.1 | `evals/memory/questions.json` | 5 starter questions with fixture answers | Runs in CI | todo |
| 10.2 | `evals/runner.ts` | Scores evals, posts diff on PRs | Regression blocks a PR | todo |

## Later phases (detail added when Phase 1 passes its gate)

- **Phase 2, swarm and safety:** GTM, Code, Ops agents; Jev routing; Laya gate; kill switches; model settings; verifier.
- **Phase 3, learning:** reflection, skill capture, consolidation, prompt evolution, quarantined reader, honeytokens.
- **Phase 4, world and research:** 3D command deck (look decision pending), research agent, voice push-to-talk, camera snapshots.
- **Phase 5, expand:** workspace packs, full onboarding, signed installers, open source, hands-free voice.

## How to use this file

1. Pick the row marked as the next file. Set it to `doing`.
2. Build it on a branch, open a PR.
3. When merged, set it to `done`, add an entry to `UPDATES.md`, and point **Next file** at the next `todo` row.
