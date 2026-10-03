# AGENTS.md

Rules for anyone changing this repo: people, Claude Code, or other coding agents.
Read this before touching code. The full design is in the plan doc; the build order is in `BUILD_PLAN.md`.

## What this is

A local-first desktop app where a crew of AI agents does daily work, remembers it, and improves over time.
Codename `deck` until the product name is chosen. VaultProof is the first workspace pack.

## Hard rules

1. **No secrets in the repo.** No API keys, tokens, `.env` files, memory exports or real customer data. Fixtures are fake.
2. **No raw keys in the app.** Every model and tool call goes through VaultProof Gateway with a scoped `vp-proj-` token.
3. **Locked-on safety stays locked on.** Gateway routing, intent gate on external actions, secret scanner, kill switches, mic and camera indicators, observe-only for unsigned skills, DB encryption. Do not add settings that disable them.
4. **External actions need approval.** Anything that sends, posts, merges, pays or deletes goes through the approval queue and the undo window.
5. **Evals gate changes.** A change to prompts, skills or memory policy must not lower any eval score.

## Layout

```
apps/desktop          Tauri 2 shell (UI, tray, updater)
packages/core         orchestrator, task board, events, scheduler, agent loop
packages/memory       schema, migrations, write and read paths
packages/models       provider adapters, Gateway routing, roles, caps
packages/agents       prompt layers and one folder per agent
packages/gate         secret scan, approvals, undo, idempotency
packages/connectors   MCP integrations
packages/chat         Telegram and Slack
evals/                memory, task and safety suites (fake fixtures only)
docs/decisions/       architecture decision records
```

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
```
