# Updates

Newest first. One entry per meaningful change: what changed, files touched, decisions, what is next.

## 2026-10-02: Honeytokens and safety evals

**Changed**
- Honeytoken: on first start the engine plants a fake "emergency backup admin code" in memory. Nothing legitimate ever uses it, so any action carrying it means injected instructions are steering the crew: the action is blocked, every agent stops, pending approvals are rejected, and you get an alert in the app and on Telegram.
- Safety eval suite (`evals/src/safety-evals.ts`, 9 cases) that assumes the model fully obeys an injected email: injected sends wait for approval on every preset, rejected sends never run, forbidden tools are never offered or run, secrets in untrusted data never reach the model, the untrusted wrapper cannot be closed by the attacker, the honeytoken stops the run, outbound prompts are scrubbed. CI fails on any drop.
- Desktop: a security stop shows in chat and flips the deck to stopped.

**Verified**
- Safety evals 9/9. Mutation check: weakening the gate so Autonomous sends without approval drops the score to 7/9 and fails CI, so the suite catches real regressions.
- Engine: an injected "email the backup code" stops everything and creates no draft.
- `pnpm check` green; no secrets in the repo.

**Blocked on you**
- Task evals and prompt evolution need real model runs (your keys on your Mac).
- Quarantined reader needs the email connector (Google sign-in).

## 2026-10-02: Phase 3 begins: the crew learns

**Changed**
- Memory port: skills (versioned, draft until approved, success and failure counts), small notes for cursors, and reading episodes and feedback since a point. Both adapters pass the shared tests; skills and notes survive export and import.
- Reflection: after work passes its check, a cheap model call looks for a reusable procedure. If there is one, it becomes a draft skill and you get an approval card ("Learn skill ..."). Approved skills appear as one line in every agent's prompt and load in full with the `load_skill` tool; each use counts as a success or failure from the task's check.
- Nightly learning at 02:00 (or Settings > Learning > Run learning now): reads recent work once, pulls out lasting facts through the memory write gate (conflicts with what you said come to you), tells you if you keep rejecting one agent's actions, retires skills that fail more than they work, and sends a short report (also on Telegram).
- Every approve and reject is now recorded as feedback.
- Settings > Learning shows skills and their record.

**Verified**
- 198 TypeScript tests pass; `pnpm check` green; no secrets in the repo.
- Engine: a checked GTM task proposes a skill, approving it puts it in the next prompt and `load_skill` returns it; the nightly pass learns a fact once (a second run reads nothing old), flags three rejections, and retires a failing skill.

**Next**
- Eval suites for tasks and safety, then the injection defenses (quarantined reader, honeytokens), then prompt evolution.

## 2026-10-02: Verifier and the crew (GTM, Operations, Engineering)

**Changed**
- Verifier (`verifyWork`): after a task, a separate cheap model call checks the report and the action log against the task's done-when list and lists anything missing. Failed actions always fail the check. If something is missing, the agent gets one more try with the exact gaps; the final result is reported honestly as checked, not finished, or not independently checked.
- New crew members with role files and permissions: GTM (lead notes, outreach drafts, follow-up issues), Operations (tracker hygiene, admin drafts, commitments), Engineering (breaks work into issues, records decisions; plans only until repository tools exist). None can send, delete, merge or pay.
- `delegate` tool for the Chief of Staff: hands a task (goal, why, done-when) to a crew member, which runs with its own prompt and narrower permissions, then is verified; the report comes back to the Chief of Staff. Crew members cannot delegate further.
- `draft_message` tool: drafts saved for review and logged to memory; nothing is sent.
- Task board tracks each delegated task (running, done, not finished). Desktop crew panel shows each member's live status.

**Verified**
- 180 TypeScript tests pass; `pnpm check` green; no secrets in the repo.
- Engine: Chief of Staff hands a draft to GTM, GTM drafts, the verifier passes it, the report comes back, the task shows done; an Ops task that does not finish is marked not finished with the reason; crew members have no delegate tool.
- Desktop crew panel updates from engine events.

**Waiting on you**
- Run on your Mac; push the repo.
- Google sign-in for email and calendar (drafts become sendable, behind approval).
- Jev access for routing and action checks (P2.6).

## 2026-10-02: The crew can act (Phase 2 begins)

**Changed**
- `packages/models`: tool calling on all three providers. Claude uses tool_use blocks, OpenAI uses function tool_calls, Gemini uses functionCall with its thought signatures passed back unchanged. Bad tool arguments are kept, not crashed on.
- `packages/agents/src/act.ts`: the agent loop with an action gate. Every tool call is checked against the agent's permissions; reads run, writes run or wait depending on the preset (Cautious asks first), and anything that leaves the machine always waits for approval, even on Autonomous. Approved actions run after you decide; rejected or expired ones never run. Secrets are stripped from tool results. Stops after 6 steps.
- Chief of Staff tools: list, create, update and comment on issues; search memory; remember a fact (contradictions with what you stated still go to you).
- Engine: chat runs through the loop; approvals list and decide; finished actions are logged to memory and reported. Telegram gets approval cards with buttons and a message when an approved action finishes. Emergency stop rejects everything waiting and blocks late approvals.
- Desktop chat: shows what the crew did under each reply, and approval cards with Approve and Reject that also update when you decide on Telegram.

**Verified**
- 166 TypeScript tests pass; `pnpm check` green; no secrets in the repo.
- Provider tests for tool requests and replies on Claude, OpenAI and Gemini (stand-in servers, not live calls).
- Engine: Balanced creates an issue and saves a fact in one message; Cautious waits, then creates on approval; emergency stop cancels what is waiting.
- Desktop: actions list, approval card, approve, and the finished-action message.

**Not verified yet**
- Live tool calls against each provider with a real key (needs your keys on your Mac).

**Next**
- Your call: the verifier (checks work before saying done) or more agents (GTM, Code, Ops). Email drafts need Google sign-in first.

## 2026-10-02: Recovery key, signing decision, GitHub skipped

**Changed**
- Settings > Recovery key: shows the workspace key on request (grouped for reading, copy button, hides itself after a minute) so it can go into a password manager. Read by the desktop shell straight from the keychain, never through the engine or logs.
- Power-up: when memory cannot be opened because the key is missing, a Restore box takes the saved key (spaces, dashes and capitals tolerated), puts it back in the keychain, restarts the engine and reruns the checks.
- Onboarding's last step reminds you to save the recovery key.
- Encryption stays on (it costs nothing noticeable and keeps emails and memory unreadable if the disk or a backup leaks).
- GitHub connector skipped for now. Code signing notes added to `BUILD_PLAN.md`.

**Verified**
- Engine test: a workspace survives a keychain reset when the saved key is restored.
- Rust test: recovery key format checks. UI test: bad key refused, restore reruns the power-up to all clear, show, copy and hide work.
- `pnpm check` green; no secrets in the repo.

**Next**
- Run the app on your Mac and push the repo.

## 2026-10-02: Engine ships inside the app

**Changed**
- `scripts/package-engine.mjs`: builds the engine, copies it with production dependencies only (flat, no symlinks), prunes what never runs (other platforms' binaries, GPU runtimes, browser runtimes, docs, tests, source maps), and copies the Node runtime as the `deck-node` sidecar. Engine bundle 103 MB plus Node 125 MB (down from 774 MB).
- Desktop: finds the engine in this order: developer override, the installed app's bundled engine and Node, then the workspace build. `tauri.bundle.conf.json` adds the sidecar and engine to installers only, so `tauri dev` and tests do not need them. macOS entitlements for the bundled Node runtime.
- `.github/workflows/release.yml`: tag `v*` builds macOS (Apple Silicon and Intel), Windows and Linux installers into a draft GitHub Release. Signing secrets are optional for test builds.
- Workspace key safety: the engine never makes a new key for an existing workspace (that would lock the data away), and refuses to start if the keychain cannot keep the key. The power-up screen shows the exact reason and stops.

**Verified**
- Built a real Linux installer (.deb, 80 MB), installed it, and launched it on a virtual display: the app started the bundled `deck-node` with the bundled engine, created the encrypted workspace, and the engine exited with the app.
- The bundled engine run from a clean folder with no workspace or system Node: local embedding model loaded, chat recall worked.
- Found and fixed a real bug on this machine: its keychain forgot the key between launches. The engine now explains this instead of failing with "wrong key".
- 145 TypeScript tests and 5 Rust tests pass; `pnpm check` green; no secrets in the repo.

**Not verified yet**
- macOS and Windows installers (the release workflow builds them on their own runners), and macOS signing and notarization (needs your Apple Developer certificate as repo secrets).

**Open**
- Recovery code (step 1.6): if a keychain is wiped, today the workspace cannot be opened. A one-time recovery code shown at setup would fix that.
- GitHub connector; Google sign-in for Gmail and Calendar.

**Next**
- Run the app on your Mac and push the repo.

## 2026-10-02: Switch models from the chat box

**Changed**
- `packages/agents/src/commands.ts`: understands model requests in plain language without calling a model (so it works even when the current model is broken): "switch to Gemini", "use claude-opus-5-5 for heavy work", "set quick tasks to gemini-flash-x", "make OpenRouter vendor/model the backup", "which models are you using?", "remove the backup". Normal conversation is left alone.
- Engine: a request becomes a proposal. It checks you have that provider's key, reads the models your key can use, asks which model when you did not name one, and refuses names your key cannot use. Nothing changes until you confirm. Confirming saves settings and switches immediately.
- Desktop chat: Apply and Cancel buttons under the proposal. Telegram: "Reply /apply <id> to confirm."

**Verified**
- 143 TypeScript tests pass; `pnpm check` runs 50 tasks green; no secrets in the repo.
- Engine test: ask without a key, ask without a model, unknown model refused, proposal applies only on confirm, the next reply comes from the new model, a used proposal cannot be applied twice.
- Desktop chat with a stand-in engine: proposal shows Apply and Cancel, Apply confirms and the buttons go away.

**Next**
- Run the app on your Mac; then step 1.5, engine packaging.

## 2026-10-02: Switch between Claude, GPT and Gemini

**Changed**
- `packages/models`: OpenAI-compatible adapter (OpenAI and OpenRouter) and Gemini adapter, beside Claude. One factory for every provider. Model lists come from each provider with your key, so nothing is guessed. Bad keys, missing models and outages get plain messages; only outages fall back.
- Settings: each job (heavy work, quick tasks) has its own provider and model, plus an optional backup model that takes over when the main one fails. Old settings that stored a plain Claude model id still load.
- Engine: each provider uses its own key from the keychain; the backup can be a different provider; `models.list` returns what your key can use.
- Desktop: "Models: who does what" card with provider pickers, model lists and a backup. Onboarding lets you start with any of the four providers.

**Verified**
- 136 TypeScript tests pass; `pnpm check` runs 50 tasks green; no secrets in the repo.
- Engine test: heavy work on Gemini fails over to OpenAI with each provider's own key.
- Live check against the real Anthropic, OpenAI and Gemini APIs with a fake key: each reports the key was rejected (no real key used here).

**Note**
- OpenRouter lists its models publicly, so a bad OpenRouter key only shows up on the first chat.

**Next**
- Run the app on your Mac; then step 1.5, engine packaging.

## 2026-10-02: Agent engine, local embeddings, onboarding

**Changed**
- `apps/engine`: the agent engine. Opens the encrypted workspace (creates the memory key in the keychain on first run), memory and tracker, the model router, startup checks, chat with the Chief of Staff (secrets stripped first, memory recall with citations, your profile in every prompt), morning briefing, issues, emergency stop and resume, and the Telegram bot when turned on. Re-embeds memory automatically when the embedding model changes (backup kept as `workspace.db.bak`). Talks JSON lines over stdio.
- Desktop: Rust starts the engine and relays calls (`engine_call`) and events; slow calls run off the UI thread; Stop all agents reaches the engine. Boot checks, chat and onboarding now go through the engine.
- `packages/embed-local`: free local embedding model (all-MiniLM-L6-v2, 384 dims, downloads about 25 MB once). Default for memory search.
- `packages/models`: OpenAI embeddings; daily token budget so models work without prices set.
- Settings: memory search model (local or OpenAI), Telegram (bot token in keychain, owner chat ids, on/off), approval preset, onboarding flag. Default models: `claude-sonnet-5` (heavy), `claude-haiku-4-5-20251001` (cheap), 2,000,000 tokens a day.
- Onboarding: connect an LLM (key to keychain, live test), short interview saved as stated facts, choose Cautious, Balanced or Autonomous.
- CI caches the embedding model.

**Verified**
- 129 TypeScript tests and 5 Rust tests pass; `pnpm check` runs 49 tasks green; no secrets in the repo.
- Memory evals 5/5 with the real local model as well as the test embedder.
- The real engine process ran end to end here: all startup checks reported honestly (core waiting for a key), chat explained the missing key, issues and status worked.
- Rust bridge round-trips with a real Node process, including error and timeout.
- Browser preview: onboarding steps, key checks, Telegram and memory search settings.

**Not verified yet (needs your Mac)**
- The full app with a real Anthropic key: power-up from the engine, a real Chief of Staff reply, Telegram from your phone.
- macOS Keychain sharing between the Rust shell and the engine (same service name, `dev.deck.app`).

**Open**
- GitHub connector (step 6.4): token in the keychain, or skip for now.
- Gmail and Calendar need a Google sign-in (OAuth client) before they can connect.

**Next**
- Run the app on your Mac; then step 1.5, engine packaging.

## 2026-10-02: Modular storage

**Changed**
- `packages/memory`: new `MemoryStore` interface. Writer and reader no longer know about SQLite. Adapters: `SqliteMemoryStore` (encrypted file, sqlite-vec, FTS5) and `InMemoryStore` (pure TypeScript). Shared contract suite (`@deck/memory/contract`), export and import, `migrateMemory` that re-embeds when the vector size changes. Superseded facts now leave the vector index.
- `packages/tracker`: same pattern with `TrackerStore`, SQLite and in-memory adapters, and a contract suite (`@deck/tracker/contract`).
- Settings: `storage.engine` (SQLite only for now).
- `AGENTS.md` and plan: "Modular by design" table listing every interface, today's adapters and what can be swapped in.
- `BUILD_PLAN.md`: database upgrade path.

**Verified**
- Memory contract passes on both adapters (7 behaviors each), tracker contract passes on both (6 each).
- SQLite to in-memory migration keeps vectors; in-memory to SQLite with a different vector size re-embeds and recall still works.
- 97 TypeScript tests pass; `pnpm check` runs 37 tasks green; memory evals still 5/5; no secrets in the repo.

**Next**
- Step 4.5: `apps/engine/src/main.ts`, the agent engine sidecar.

## 2026-10-02: API key settings and built-in issue tracker

**Changed**
- Settings: Models card with API key fields for Anthropic, OpenAI, Gemini and OpenRouter. Keys go straight to the OS keychain (`secret_set`); the UI shows only the last 4 characters (`secret_hint`), clears the field after saving or on error, and refuses a key pasted under the wrong provider.
- `packages/models/src/direct.ts`: Claude called directly with the developer key, read from the keychain at call time and sent only in the `x-api-key` header.
- `packages/tracker`: built-in issue tracker replacing Linear. Issues (VP-1 style keys), status, priority, labels, assignee, due date, history, comments and full-text search, in the same encrypted workspace database. Feeds the morning briefing.
- Chief of Staff scopes: `linear.read` replaced by `issues.read` and `issues.write`.
- `AGENTS.md` and plan: keys live only in the OS keychain until VaultProof brokers credentials; Linear references replaced by the tracker.

**Verified**
- 80 TypeScript tests and 3 Rust tests pass; `pnpm check` runs 37 tasks green; no secrets in the repo.
- Browser preview: wrong-provider key refused and cleared; saved key shows only its last 4; the full key never appears in the page; remove works.

**Open**
- Embedding model for memory (provider and dimension).
- GitHub connector (step 6.4): which MCP server, or the GitHub API with a token in the keychain.
- Sharing the tracker with a collaborator (later, likely through GitHub Issues).

**Next**
- Step 4.5: `apps/engine/src/main.ts`, the agent engine sidecar.

## 2026-10-02: VaultProof MCP setting, Gateway API on hold

**Changed**
- `packages/settings`: settings schema with a VaultProof section (on/off, MCP server URL) and boot options. Validation refuses http (except localhost), credentials in the URL, and token-like query parameters; it cannot be turned on without a URL. No secrets in the settings file.
- `packages/connectors/src/vaultproof.ts`: MCP check over Streamable HTTP (initialize, session id, tools/list; JSON or SSE replies). Reports connected, sign-in needed, not live yet, or error. Startup probe never blocks boot.
- Startup check segment renamed from Gateway to VaultProof (id unchanged).
- Desktop: Systems panel with the VaultProof card; settings saved to the app data folder by Rust (`settings_get`, `settings_set`, atomic write, size and JSON checks). Boot shows VaultProof as off, or waiting when turned on.
- `AGENTS.md` and the plan: credential rule now says VaultProof brokers credentials (MCP server, almost ready); Gateway client kept but on hold.

**Verified**
- 72 TypeScript tests and 2 Rust tests pass; `pnpm check` runs 34 tasks green.
- In the browser preview: turning on without a URL and saving an http URL both show the right message; a valid URL saves, survives reload, and boot then shows VaultProof as waiting.

**Open**
- Until VaultProof is live, how should the engine reach a model? Options: wait (no model calls yet), or a temporary developer key in the keychain, clearly marked and removable.
- VaultProof MCP server URL and its sign-in flow (OAuth details) when it launches.
- Which MCP servers for Linear and GitHub.
- Embedding model for memory.

**Next**
- Step 4.5: `apps/engine/src/main.ts`, the agent engine sidecar.

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
- VaultProof Gateway API: on hold (see the newer entry).
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
