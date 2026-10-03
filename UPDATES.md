# Updates

Newest first. One entry per meaningful change: what changed, files touched, decisions, what is next.

## 2026-10-02: Steps 1 to 10, Phase 1 packages

**Changed**
- `packages/memory`: encrypted SQLite (SQLCipher) with sqlite-vec and FTS5; episodes, facts with time validity, graph edges, skills, goals, feedback, review queue. Write gate (vague, duplicate, near-duplicate, update, contradiction to owner), supersede never overwrite, /forget, hybrid recall with citations and a token budget.
- `packages/models`: Gateway client that refuses raw provider keys and plain http, prompt-cache markers, retryable vs fatal errors; router with role fallback chains and daily spend caps.
- `packages/core`: event bus, task board (valid transitions, scope can only narrow, kill switch), scheduler, agent-loop interface plus Gateway env for the Claude Agent SDK, 14 startup checks with dependency holds.
- `packages/agents`: core rules, Chief of Staff role and tool policy, 7-layer prompt builder with one cache marker, untrusted-content wrapper, morning briefing composer with a plain-list fallback.
- `packages/connectors`: Gmail and Google Calendar sources over MCP (read only).
- `packages/gate`: secret scanner, approval queue (expiry, kill switch), 60-second undo window, idempotent side effects.
- `packages/chat`: Telegram client and bot (owner-only, approval buttons, voice notes), local whisper.cpp transcriber.
- `evals`: fake fixtures, 5 memory questions, CI fails on any drop below baseline.
- `apps/desktop`: Tauri 2 shell (tray with Stop all agents, close-to-tray, keychain commands, native power and keychain checks), React UI with the 2D power-up ring and a chat shell. CI job for Rust.

**Verified**
- 63 TypeScript tests and 1 Rust test pass; `pnpm check` runs 30 tasks green; Rust shell compiles (`cargo test`).
- Memory file is unreadable without the key; superseded and forgotten facts never come back in recall.
- Prompt injection text in an email subject stays inside its untrusted wrapper.
- Memory evals: 5/5.
- Desktop UI renders and works in a browser preview (boot, chat, stop all).
- No secrets in the repo (gitleaks); fake test values are marked inline.

**Not verified yet (needs you or real accounts)**
- Running the desktop app on your Mac (`pnpm --filter @deck/desktop tauri dev`).
- Real model calls through VaultProof Gateway.
- Gmail and Calendar over real MCP with OAuth; Telegram with a real bot.
- whisper.cpp voice notes.

**Decisions**
- Rust toolchain moved to stable: some Tauri dependencies need Rust 1.85 or newer.
- Built the TypeScript packages before the Tauri shell so most logic is tested without a desktop.
- Kept the dark ship theme in the app for now; the Kenney look is still pending.

**Open**
- VaultProof Gateway API: the client assumes `POST {base}/anthropic/v1/messages` with `Authorization: Bearer vp-proj-...`. Confirm or correct.
- Which MCP servers for Linear and GitHub (steps 6.3 and 6.4).
- Embedding model for memory (provider and dimension).

**Next**
- Step 4.5: `apps/engine/src/main.ts`, the agent engine sidecar.

## 2026-10-02: Step 0, repo scaffold

**Changed**
- Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `mise.toml`, `README.md`.
- Safety: `.gitignore` (DB, `.env`, keys, memory exports), `.gitleaks.toml` (default rules plus a `vp-proj-` token rule), `.githooks/pre-commit` (blocks secrets on commit, installed by `pnpm install`).
- Rules: `AGENTS.md`, `CLAUDE.md` pointing to it.
- CI: `.github/workflows/ci.yml` with a secrets job and a lint, typecheck, test job.
- Placeholder `packages/core` with one test so the pipeline has something to run; `evals/` workspace with fixtures folder.

**Verified**
- `pnpm install` and `pnpm install --frozen-lockfile` run clean.
- `pnpm check` runs lint, typecheck and test across the workspace: all pass.
- `memory.db` and `.env` are ignored by git.
- Pre-commit hook blocked a commit with a fake Anthropic key, and separately one with only a fake `vp-proj-` token (custom rule works).
- `ci.yml` passes actionlint; full-history gitleaks scan finds no leaks.

**Not verified yet**
- `mise install` (mise not available in the build sandbox).
- CI on GitHub (needs the repo pushed).
- Claude Code following `AGENTS.md` (needs a real session).

**Decisions**
- Codename `deck`, package scope `@deck/*`, until the product name is chosen.
- Git hook via `core.hooksPath`, no extra dependency.

**Next**
- Step 1.1: `apps/desktop/src-tauri/tauri.conf.json`.

## 2026-10-02: Planning and prototypes

**Changed**
- Wrote the system plan: architecture, agents, memory, learning loop, research agent, security, settings, onboarding, models, voice and vision, workspaces, roadmap.
- Built three prototypes:
  - Ship power-up boot sequence: https://claude.ai/artifact/UpxffynSVvsSfz1DtnuA5M
  - Dark command deck (3D): https://claude.ai/artifact/2R4nddegL7tZGWvEf3AV9o
  - Space station (3D, Kenney Space Station Kit, CC0): https://claude.ai/artifact/JU47DF7LrPriqmEyQGCznU
- Started `BUILD_PLAN.md` with Phase 1 broken into files.

**Decisions**
- App is general; VaultProof is the first workspace pack.
- Sci-fi ship theme across the whole app; facility bulbs dropped.
- Stack: Tauri 2, TypeScript, Claude Agent SDK, SQLite + sqlite-vec, all model calls through VaultProof Gateway.
- Safety controls that stay locked on: keys through the Gateway, intent gate on external actions, secret scanner, kill switches, mic and camera indicators, observe-only for unsigned skills, DB encryption.

**Open**
- Visual look: dark command deck or Kenney space station. Revisit later.
- Product name (Tandem, Hearth, Cohort, Relay, Orbit or other).
- Repo home: VaultProof org or personal GitHub, and collaborator IP assignment.

**Next**
- Step 0.1: `package.json` + `pnpm-workspace.yaml` (done, see entry above).

## Entry template

```
## YYYY-MM-DD: Short title

**Changed**
- What was built or edited, with file paths.

**Decisions**
- Anything decided, and why in one line.

**Open**
- Questions still unanswered.

**Next**
- The next file from BUILD_PLAN.md.
```
