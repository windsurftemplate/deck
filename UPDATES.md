# Updates

Newest first. One entry per meaningful change: what changed, files touched, decisions, what is next.

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
