# AGENTS.md

Rules for anyone changing this repo: people, Claude Code, or other coding agents.
Read this before touching code. The full design is in the plan doc; the build order is in `BUILD_PLAN.md`.

## What this is

A local-first desktop app where a crew of AI agents does daily work, remembers it, and improves over time.
Codename `deck` until the product name is chosen. VaultProof is the first workspace pack.

## Hard rules

1. **No secrets in the repo.** No API keys, tokens, `.env` files, memory exports or real customer data. Fixtures are fake.
2. **Keys live only in the OS keychain.** Until VaultProof brokers credentials (MCP server, almost ready), developer API keys are entered in Settings and stored in the keychain. Never put a key in code, settings files, memory, logs or prompts; the UI only ever shows the last 4 characters.
3. **Locked-on safety stays locked on.** Keychain-only keys, intent gate on external actions, secret scanner, kill switches, mic and camera indicators, observe-only for unsigned skills, DB encryption. Do not add settings that disable them.
4. **External actions need approval.** Anything that sends, posts, merges, pays or deletes goes through the approval queue and the undo window.
5. **Evals gate changes.** A change to prompts, skills or memory policy must not lower any eval score.

## Layout

```
apps/desktop          Tauri 2 shell (UI, tray, keychain, engine bridge)
apps/engine           agent engine (Node): workspace DB, models, Chief of Staff, Telegram; JSON lines over stdio
packages/core         orchestrator, task board, events, scheduler, agent loop
packages/memory       schema, migrations, write and read paths
packages/models       provider adapters, roles, caps (Gateway client on hold)
packages/settings     settings schema and validation (no secrets)
packages/tracker      local issue tracker (replaces Linear)
packages/embed-local  local embedding model (free, private)
packages/agents       prompt layers and one folder per agent
packages/gate         secret scan, approvals, undo, idempotency
packages/connectors   MCP integrations
packages/chat         Telegram and Slack
evals/                memory, task and safety suites (fake fixtures only)
docs/decisions/       architecture decision records
```

## Modular by design

Every outside dependency sits behind an interface (a port) with swappable adapters. Logic never imports a database driver or vendor SDK directly.

| Port | Adapters today | Swap in later |
|------|----------------|---------------|
| `MemoryStore` (`@deck/memory`) | SQLite (encrypted), in-memory | Postgres + pgvector, LanceDB, a server |
| `TrackerStore` (`@deck/tracker`) | SQLite (same file), in-memory | Postgres, GitHub Issues sync |
| `Embedder` | test hash embedder | OpenAI, local model |
| `ChatModel` (`@deck/models`) | Claude direct, Claude via Gateway | OpenAI, Gemini, OpenRouter, local |
| `BriefSources` (`@deck/connectors`) | Gmail, Calendar, tracker | any source |
| `AgentRunner` (`@deck/core`) | fake runner | Claude Agent SDK |
| `BotActions` (`@deck/chat`) | Telegram | Slack |

Rules:
- A new adapter is done when it passes the port's contract suite (`@deck/memory/contract`, `@deck/tracker/contract`).
- Moving data between adapters uses the export and import methods (`migrateMemory` re-embeds when the vector size changes).
- Every port method is atomic on its own; no transactions leak across the interface.

## Conventions

- TypeScript, strict mode, ES modules. Node 22, pnpm 9 (see `mise.toml`).
- One package per area; avoid cross-package imports except through each package's `src/index.ts`.
- Tests sit next to code as `*.test.ts` and run with Vitest.
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
- Small PRs, one BUILD_PLAN row per PR when possible.
- Theme words never hide meaning: buttons say what they do.

## Workflow

1. Take the **Next file** from `BUILD_PLAN.md`, mark it `doing`.
2. Branch, build, run `pnpm check`.
3. Open a PR; CI must be green and one review is required.
4. After merge: mark the row `done`, add an entry to `UPDATES.md`, move **Next file**.

## Commands

```
mise install       # toolchain
pnpm install       # dependencies, also installs the secret-scan git hook
pnpm check         # lint, typecheck, test across all packages
pnpm secrets       # scan the whole repo for secrets
node scripts/package-engine.mjs                          # bundle the engine + Node runtime for this platform
pnpm --filter @deck/desktop tauri dev                    # run the app (uses the workspace engine)
pnpm --filter @deck/desktop tauri build -- --config src-tauri/tauri.bundle.conf.json   # installer with the engine inside
```

Releases: push a tag like `v0.2.0`; `.github/workflows/release.yml` builds macOS (Apple Silicon and Intel), Windows and Linux installers into a draft GitHub Release.
