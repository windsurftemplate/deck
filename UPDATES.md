# Updates

This file has two parts:
1. **Build report**: everything done so far, by phase, with what was verified and what is still open.
2. **Detailed log**: one entry per work session, newest first.

# Build report (as of 2026-10-03)

## At a glance

| Phase | Status | Gate to pass |
|---|---|---|
| 0. Planning and prototypes | Done | n/a |
| 1. Core | Built and tested here; not yet run on your Mac | Morning briefing useful 5 workdays in a row |
| 2. Swarm and safety | Mostly built (now with crew rules you can change); email, calendar and Jev routing waiting on you | No raw key anywhere; every external action approved |
| 3. Learning | Started: skills, nightly learning, honeytoken, safety evals | Eval scores rise two weeks running |
| 4. World and research | Started: 3D command deck (Kenney look) and research agent with web research | First agent PR merged after your review |
| 5. Expand | Started: workspace packs, starting setup step, one-click installers | All earlier gates still hold |

Code: about 9,400 lines of TypeScript, TSX and Rust across 2 apps and 13 packages, 47 commits.
Tests (counted): **224 TypeScript tests and 6 Rust tests, all passing.** Memory evals 5/5 (test embedder and the real local model). Safety evals 9/9. Secret scan clean on every commit.

Correction: earlier log entries quoted test totals that were estimates and some were too high (for example "198"). They have been replaced below with "all tests passed at the time". The numbers in this report were counted directly.

## Phase 0: Planning and prototypes

- **Plan document** (Claude Doc "Personal Agent Swarm: System Architecture & Plan"): architecture, agents, memory, learning loop, research agent, security, settings, onboarding, boot sequence, models, voice and vision, workspaces, visual theme, roadmap. Kept up to date with every decision below (modular design table, VaultProof MCP setting, API keys, built-in tracker replacing Linear, Kenney look as a candidate).
- **Prototypes**: ship power-up boot sequence; dark 3D command deck (hand-built Three.js); light space station built from the Kenney Space Station Kit (CC0). Visual direction still to be chosen.
- **Jev research**: TypeSafe AI's decision model for routing and scoring; Laya as the local action check. Not wired in yet (needs your access).

## Phase 1: Core

### Repo, CI and conventions
- pnpm workspace with Turborepo; pinned toolchain in `mise.toml` (Node 22, pnpm 9, Rust stable).
- `AGENTS.md`: hard rules (keys only in the keychain, locked-on safety, approvals for external actions, evals gate changes), repo layout, the "modular by design" table, commands, release steps. `CLAUDE.md` points to it.
- Secret protection: `.gitignore` keeps databases, `.env` files, keys and memory exports out; gitleaks pre-commit hook plus a custom rule for `vp-proj-` tokens; fake test secrets are built at runtime or marked inline.
- CI (`.github/workflows/ci.yml`): secret scan, lint, typecheck and tests for every package, Rust tests for the desktop shell, cached embedding model.
- Docs: `BUILD_PLAN.md` (every step with file, purpose, done-when and status) and this file.

### Desktop app (`apps/desktop`, Tauri 2 + React)
- Tray menu (Show, Stop all agents, Quit); closing the window keeps the crew running; Stop all agents reaches the engine.
- Rust commands: keychain (set, check, last-4 hint, delete; only fixed secret names allowed), settings file (atomic write, size and JSON checks), native checks (disk, keychain round trip), engine bridge, recovery key reveal and restore, engine restart.
- Power-up screen: 2D reactor ring lights one segment per passing check; the core lights only when a model answers; blocking problems stop the power-up and show the exact reason and fix.
- Command deck: crew panel with live status per agent, chat with the Chief of Staff, "Did" lists under replies, approval cards (Approve, Reject), proposal cards (Apply, Cancel), security alerts.
- Settings ("Systems panel"): API keys, models per job, memory search model, Telegram, VaultProof, learning, recovery key.
- Dark ship theme (Chakra Petch font bundled locally, ion blue), keyboard focus styles, reduced-motion support, responsive layout.

### Agent engine (`apps/engine`)
- Separate Node process started by the desktop app; JSON lines over stdin and stdout; logs on stderr.
- Owns the encrypted workspace, models, the crew, the Telegram bot and the scheduler.
- Methods: startup checks, chat, briefing, issues, approvals, drafts, crew tasks, model list and test, settings proposals, profile, learning, kill and resume, reload.
- Reports a clear reason if it cannot start (shown on the power-up screen instead of a generic error).

### Memory (`packages/memory`)
- One SQLCipher-encrypted SQLite file per workspace, sqlite-vec for vectors, FTS5 for keywords.
- Episodes (what happened), facts with time validity (superseded, never overwritten), relationships, skills, goals, feedback, a review queue for conflicts.
- Write gate: rejects vague claims, drops exact and near duplicates, supersedes changed facts, sends conflicts with what you stated to you.
- Hybrid recall: vector plus keyword ranking, one hop through relationships, a token budget, and ids on every memory so agents can cite them. Old versions leave the vector index.
- `/forget` removes a subject completely.
- Storage behind an interface (`MemoryStore`) with two adapters (encrypted SQLite, in-memory), a shared contract test suite, export and import, and `migrateMemory` that rebuilds vectors when the embedding size changes.

### Built-in issue tracker (`packages/tracker`, replaces Linear)
- Keys like VP-12, status, priority, labels, assignee, due date, comments, full history, search; feeds the briefing.
- Same interface pattern (`TrackerStore`) with SQLite and in-memory adapters and a contract suite.

### Models and keys (`packages/models`, `packages/embed-local`)
- Providers: Anthropic (Claude), OpenAI, Google Gemini, OpenRouter. Model lists come from each provider with your key; nothing is guessed.
- A provider and model per job (heavy work, quick tasks) plus an optional backup that takes over when the main model fails.
- Daily token budget; spend caps when prices are set.
- Plain errors: bad key, unknown model, outage (only outages fall back).
- API keys entered in Settings go straight to the OS keychain; only the last 4 characters are ever shown; a key pasted under the wrong provider is refused and cleared.
- Memory search: free local embedding model (all-MiniLM-L6-v2, runs on your machine) by default, or OpenAI. Switching rebuilds the search index automatically and keeps a backup.
- VaultProof Gateway client kept but on hold.

### Settings (`packages/settings`)
- Validated settings file (no secrets): storage engine, models, memory search model, approval preset, onboarding, Telegram, VaultProof MCP URL, boot options. A bad section falls back on its own without losing the rest; old formats still load.

### Onboarding and boot
- 14 startup checks in boot order with dependencies (a failed VaultProof or keychain holds what depends on it); checks are plain code, so results are exact.
- First run: connect any of the four providers (live test), a short interview saved as facts you stated, pick Cautious, Balanced or Autonomous, reminder to save the recovery key.

### Chat front door (`packages/chat`)
- Telegram bot: answers only your chat ids; /brief, /tasks, /status, /approve, /reject, /undo, /kill, /apply; approval cards with buttons; voice notes transcribed locally (whisper.cpp).

### Morning briefing (`packages/agents/brief.ts`)
- Meetings, emails waiting, open issues, pull requests; third-party text wrapped as untrusted; a source that fails is named, not hidden; plain-list fallback if the model fails. Scheduled at 08:00 when Telegram is on.

### Safety basics (`packages/gate`)
- Secret scanner on outbound prompts and tool results (Anthropic, OpenAI, VaultProof, AWS, GitHub, Google, Slack, Stripe, Telegram, JWT, private keys, passwords).
- Approval queue with expiry and kill switch, 60-second undo window, idempotent side effects (never double-send).
- Untrusted-content wrapper that the attacker cannot close.

### Workspace key and recovery
- Encryption key created on first start and kept in the keychain. The engine never makes a new key for an existing workspace and refuses to start if the keychain cannot keep the key.
- Settings > Recovery key shows it for your password manager (hides after a minute); the power-up screen offers Restore.

### VaultProof
- Setting to connect to the VaultProof MCP server (off until it is live); connection check (handshake, session, tool list; reports connected, sign-in needed, not live yet). Never blocks boot.

### Packaging and releases
- `scripts/package-engine.mjs` bundles the engine with production dependencies and its own Node runtime (about 230 MB before compression, down from 900 MB).
- Installers only include the engine (`tauri.bundle.conf.json`); macOS entitlements for the bundled runtime.
- `.github/workflows/release.yml`: a version tag builds Apple Silicon Mac, Intel Mac, Windows and Linux installers into a draft release.

### Phase 1 verified
- Everything above has unit, contract or integration tests.
- A real Linux installer (.deb, 80 MB) was built, installed and launched here: it started the bundled engine and created the encrypted workspace; the engine exits with the app.
- The bundled engine ran from a clean folder with no system Node; the real local embedding model loaded and recall worked.
- Live provider check with a fake key: Anthropic, OpenAI and Gemini each report the key was rejected.

### Phase 1 still open
- Run on your Mac with real keys (nothing has used a real key yet).
- Gmail and Calendar need Google sign-in before they can connect (the code for reading them exists).
- The Phase 1 gate itself: five workdays of useful briefings.

## Phase 2: Swarm and safety

### Built
- **Tool calling on all providers**: Claude tool_use, OpenAI function calls, Gemini function calls with thought signatures passed back unchanged.
- **Agent loop with an action gate** (`packages/agents/act.ts`): permissions checked per tool; reads run; changes on your machine follow the preset (Cautious asks first); anything that leaves the machine always waits for approval, even on Autonomous; approved actions run after you decide; rejected or expired ones never run; secrets stripped from tool results; stops after 6 steps.
- **Chief of Staff tools**: list, create, update and comment on issues; search memory; remember facts; draft messages; load skills; delegate.
- **Crew**: GTM (leads, outreach drafts, follow-ups), Operations (tracker hygiene, admin drafts, commitments), Engineering (breaks work into issues, records decisions; plans only). None can send, delete, merge or pay.
- **Delegation**: the Chief of Staff hands a task (goal, why, done-when) to a crew member, which runs with its own prompt and narrower permissions; crew members cannot delegate further.
- **Verifier**: a separate cheap model checks finished work against done-when; one retry with the exact gaps; results reported as checked, not finished, or unchecked.
- **Approvals everywhere**: cards in the app and Telegram stay in sync; finished approved actions are reported; Stop all agents rejects what is waiting and blocks late approvals.
- **Switch models from chat**: "switch heavy work to Gemini", "which models are you using?"; checks your key and the model list; changes only after you confirm.
- **Drafts**: saved for review and logged; nothing is sent.
- **Crew rules you can change**: Settings > Crew (instructions, your rules, tools set to Allowed, Ask me first, or Off, history, undo) and from chat (proposal, then Apply). Changes can only make agents more careful; locked rules are shown read-only. The tool-list "ask first" field, previously ignored, is now honored.

### Phase 2 verified
- Provider tests for tool requests and replies (stand-in servers).
- Engine tests: Balanced acts directly, Cautious waits then acts on approval, emergency stop cancels; Chief of Staff to GTM to verifier to report; a task that does not finish is reported honestly.

### Phase 2 still open
- Email drafts that can be sent (after approval) and calendar holds: need Google sign-in.
- Jev routing and the Laya action check: need your Jev access and a decision on Laya.
- GitHub connector: skipped for now (your call).
- Code agent with repository access: later.

## Phase 3: Learning

### Built
- **Skills**: versioned, draft until you approve, success and failure counts, one line per approved skill in every prompt, full steps loaded on demand.
- **Reflection**: checked work can propose a skill (approval card); failing work never teaches.
- **Nightly learning at 02:00** (or on demand): facts from recent work through the write gate (read once), feedback review (flags repeated rejections), retires failing skills, report in the app and Telegram.
- **Feedback**: every approve and reject recorded.
- **Honeytoken**: a planted fake admin code; any action carrying it is blocked, everything stops, you are alerted. Planting never blocks start.
- **Safety evals** (9 cases) that assume the model obeys an injected email; CI fails on any drop. A deliberate weakening of the approval rule was caught (score fell to 7/9).

### Phase 3 still open
- Task evals and prompt evolution: need real model runs.
- Quarantined reader for emails and web pages: needs the email connector.

## Phase 4: World and research (started)
- 3D command deck in the chosen Kenney look, driven by live engine events, with approvals on the deck and a List view toggle.
- Research agent with web research through the model's own search tool, a daily cap, a crew track-record review, and a weekly self-review.
- Crew walk to Command on real handoffs; voice push-to-talk with local whisper.cpp.
- Still open: camera snapshots, camera tours and a 3D power-up, sandbox PRs (needs repository access).

## Phase 5: Expand (started)
- Workspace packs (founder, freelancer, student, VaultProof, blank) that can only make the crew more careful; picked in a new onboarding step.
- One-click installers for Mac, Windows and Linux (Linux verified end to end).
- Open source under MIT with security policy and contributing guide; camera snapshots and picture attachments; spoken replies.
- Still open: wake word for fully hands-free voice.

## Decisions made along the way
- General app with VaultProof as the first workspace pack; codename `deck` until a name is chosen.
- VaultProof Gateway API on hold; VaultProof MCP connection added as a setting.
- API keys entered in Settings, stored only in the OS keychain.
- Linear replaced by a built-in tracker; GitHub connector skipped for now.
- Everything behind interfaces with contract tests, so storage, models and chat can be swapped.
- SQLite + sqlite-vec now; upgrade path to its faster index, then Postgres + pgvector only past about 1 million memories.
- Local embedding model by default (free, private).
- Encryption stays on; recovery key provided for the password manager.
- MIT license for open source.
- No Apple code signing yet (build locally or right-click > Open); sign before wider sharing.
- Kenney space station is the chosen 3D look (dark theme kept for the app's chrome).
- Research agent does web research through the model's own search tool, capped at 25 searches a day.

## Problems found and fixed
- Settings view overlapped the deck (CSS overrode `hidden`).
- A key pasted into the wrong field stayed in the field after the error.
- Turbo hid environment variables from tests, causing model downloads to race; the shared model cache is now passed through.
- Engine bundle was 774 MB; pruned other platforms' binaries, GPU and browser runtimes, docs and source maps.
- The prune step deleted the agents' Markdown prompts; our own packages are now excluded.
- A keychain that forgets between launches would have made a new key and locked old data away; now refused with a clear message and Restore option.
- A slow engine call held a lock and blocked other calls; the lock is released before waiting.
- Gemini reported an invalid key as a generic 400; now recognized.
- The models package imported a Node-only module and broke the app build; now browser-safe.
- First start without internet could block the engine (honeytoken needed the embedding model); planting is now best effort.
- Earlier test totals in this log were overstated; corrected.
- The "ask first" list in agents' tool files was ignored by the approval gate; now honored.

## Tests by package (counted 2026-10-03, after Phase 4 work)

| Package | Tests | Package | Tests |
|---|---|---|---|
| agents | 33 | tracker | 12 |
| engine | 30 | settings | 11 |
| models | 27 | gate | 8 |
| memory | 23 | connectors | 7 |
| core | 16 | chat | 5 |
| desktop UI helpers | 4 | evals (memory, local model, safety) | 3 |
| embed-local (real model) | 1 | packs | 2 |
| Rust shell | 6 | | |

## Not verified yet
- Anything with a real API key (chat, tools, model lists, Telegram).
- The app on macOS or Windows (only Linux was installed and launched here).
- macOS Keychain sharing between the shell and the engine.

## Waiting on you
1. Install on your Mac: double-click `Install deck.command` (Windows: `Install deck.cmd`; Linux: `./install-linux.sh`).
2. Push the repo (VaultProof org or personal) so CI and releases run.
3. Google sign-in app for Gmail and Calendar.
4. Jev access; decide on Laya.
5. Pick a product name.

## Commit history
1. `chore: repo scaffold (BUILD_PLAN step 0)`
2. `docs: build plan and updates log, step 0 done`
3. `feat: memory, models, core, agents, connectors, gate, chat, startup checks, evals (BUILD_PLAN steps 2-8, 9.1, 10)`
4. `feat: desktop shell, boot checks UI, Rust tray and keychain; docs: build plan and updates`
5. `feat: VaultProof MCP setting and connection check; Gateway API on hold`
6. `feat: API key settings in keychain, direct Claude client, built-in issue tracker`
7. `refactor: storage behind MemoryStore and TrackerStore ports with contract suites and migration`
8. `feat: agent engine sidecar, Rust bridge, local embeddings, onboarding, Telegram and memory settings`
9. `feat: OpenAI, Gemini and OpenRouter adapters; provider and model per role with backup`
10. `feat: switch models from the chat box with a confirm step`
11. `feat: ship the engine inside the app (bundled Node sidecar), release workflow, workspace key safety`
12. `feat: recovery key (show and restore); signing notes; GitHub connector skipped`
13. `feat: tool calling on all providers, agent loop with action gate, Chief of Staff tools and approvals`
14. `feat: verifier, GTM/Ops/Engineering crew with delegation, drafts, crew panel`
15. `feat: Phase 3 learning loop: skills, reflection, nightly learning, feedback`
16. `feat: honeytoken tripwire and safety eval suite`
17. `fix: honeytoken planting never blocks start; engine uses the shared model cache`
18. `docs: detailed build report for phases 0 to 3`
19. `feat: crew rules editable in Settings and from chat; honor tool-list ask-first`
20. `feat: crew rules you can change (Settings > Crew and chat proposals); ask-first in tool lists honored`
21. `feat: research agent with web research on Claude, OpenAI and Gemini; weekly self-review`
22. `feat: 3D command deck (Kenney station) driven by live events; docs for phase 4`
23. `feat: crew motion on handoffs and push-to-talk voice`
24. `docs: current code size`
25. `docs: fix code size line`
26. `feat: one-click Mac installer and uninstaller`
27. `feat: one-click installers for Linux and Windows; app identifier fixed for macOS`
28. `feat: workspace packs and starting setup step`
29. `chore: MIT license, security policy, contributing guide, third-party notices`
30. `feat: snapshots and picture attachments, images on all providers, spoken replies`
31. `fix: Mac installer strips file labels and builds outside iCloud folders so signing succeeds`
32. `feat: streaming replies with typing dots on all providers; saved chats sidebar`
33. `feat: second brain (files, text, links, Obsidian, Notion, Apple Notes, notes) with 3D map; document recall marked untrusted`
34. `feat: livelier station (space, props, live screens, crew at consoles)`
35. `feat: command center analytics, crew chat with discussions, tools page with Jev key`
36. `feat: automations (recurring jobs from a page or from chat, with results everywhere)`
37. `feat: documents become facts nightly; prompt tuning tested on practice tasks and adopted only with approval`
38. `feat: hands-free voice with a wake word, and desktop notifications`
39. `feat: professional UI pass (sidebar, command menu, status bar, toasts, states, tokens)`
40. `feat: encrypted backup and restore with a passphrase`
41. `feat: input scanner flags injection attempts, strips hidden characters, keeps personal data out of web searches`
42. `feat: experience recall shows each agent its similar past tasks and what worked`
43. `feat: model arena picks the best model per agent from practice runs`
44. `feat: goals planned into milestone issues with progress and weekly checks; tracker lists every status (fixes closed-issue counts)`
45. `feat: multi-step workflows with templates, schedulable as automations`
46. `feat: setup health score with fixes and history`
47. `docs: user manual and agent course, with an in-app Help page`

# Detailed log

Newest first. One entry per meaningful change: what changed, files touched, decisions, what is next.

## 2026-10-04: User manual and agent course

**Changed**
- `docs/manual`: 12 chapters covering install on each system, first run, every page, chat, pictures, voice and hands-free, Telegram, the second brain, goals, automations and workflows, the command center and setup health, models and tools, the model arena, learning, crew rules, safety, privacy, data locations, backups, a full settings reference, shortcuts, troubleshooting, FAQ and glossary.
- `docs/course`: 15 chapters from high level to low level: what an agent is; how language models work; context engineering; tools and function calling (provider formats, MCP); the agent loop; memory and retrieval (embeddings, BM25, RRF, chunking, write discipline); multi-agent systems; learning without retraining; security (OWASP LLM risks, injection, the lethal trifecta, defense in depth); evals; production engineering; and three forward deployed engineering chapters (discovery and scoping, building the pilot, rollout, security reviews, operations and handoff), ending with a capstone. Every chapter has a lab using deck's real code and a quiz.
- `docs/README.md` indexes both, with further reading.
- In the app: **Help and course** in the sidebar (<kbd>Cmd</kbd> + <kbd>9</kbd>). Table of contents, search across everything with snippets, Markdown rendering, interactive quizzes (options shuffled, explanations shown, score saved), chapter completion and course progress, previous and next.
- About 23,000 words in total.

**Verified**
- Tests check that both sections are bundled in order, every course chapter has a lab and at least 3 valid quizzes, quiz parsing, and search.
- Desktop: table of contents, opening a chapter, answering a quiz, searching "lethal trifecta".
- 224 TypeScript tests pass (counted); `pnpm check` green; no secrets in the repo.

## 2026-10-04: Ideas from Ruflo: backups, scanner, recall, arena, goals, workflows, health

**Source.** Ruflo (github.com/ruvnet/ruflo), an agent harness for Claude Code and Codex. Taken where it fits a personal crew; skipped federation, swarm consensus and unsandboxed plugins (they conflict with the locked safety rules).

**Changed**
- Encrypted backup and restore (Settings, Backups): the workspace (copied with VACUUM INTO, still encrypted), the memory key and settings, sealed with your passphrase (scrypt, AES-256-GCM, 12 characters or more). Restore needs only the file and passphrase; the old workspace is kept as workspace.before-restore.db.
- Input scanner (`@deck/gate`): scores untrusted text for signs of orders (ignore previous instructions, fake system messages, persona changes, asks for keys, hide from the owner, data-carrying image links, long encoded blocks), removes invisible characters, and marks flagged content with a warning the agent sees every time. Second brain imports report flagged files. Emails, phone numbers, card numbers (Luhn checked), ID numbers and IBANs are removed from web search questions.
- Experience recall: before each delegated task, the agent sees up to three of its most similar past tasks with how they went and what it reported, failures included. Reports are now kept with each task.
- Model arena (Tools): replays an agent's recent tasks as practice with each of your models, scores them with the same checker, and suggests the best (ties to fewer tokens). Applying gives that agent its own model (settings models.agents); others keep the main model.
- Goals (sidebar): the Chief of Staff plans a goal into 3 to 7 dated milestones as issues labelled to the goal; progress bar, checkboxes, overdue marks, progress notes on demand and every Monday at 08:30 (notification and Telegram).
- Workflows (Automations, Workflows tab): 2 to 6 steps across agents, each step seeing the results so far; a Chief of Staff step can combine them. Templates: account research to outreach, weekly review, breach to content. Workflows can be scheduled.
- Setup health (Command center): a score out of 100 from twelve checks (main model key, fallback on another provider, backup in 14 days, safe preset, tripwire, token budget, learning in 3 days, stale approvals, crew success rate, failing automations, Telegram limits, web research), a fix for each, a daily history, and a warning when a passing check starts failing.
- Fixed: the tracker could not list closed issues, so the command center undercounted closed issues. It now can list every status.

**Verified**
- Engine tests for each: backup sealed and restored on a fresh keychain, wrong passphrase refused; scanner flags and strips, web search question redacted; recall finds similar tasks and skips unrelated ones; arena picks the stronger model and applies it to one agent only; goals planned, progressed and checked; workflows hand results forward and can be scheduled; health scores, fixes, history and regressions.
- Desktop with a stand-in engine: command center with health, goals page.
- 221 TypeScript tests pass (counted); `pnpm check` green; no secrets in the repo.

## 2026-10-03: Professional UI pass

**Research** (what professional desktop tools do, summarized)
- Consistency first: one icon family, one spacing scale, restrained color; erratic spacing and mixed fonts read as amateur.
- Tool-like structure: a fixed left sidebar with a clear current-page marker, a calm header, keyboard-first use with a command menu (Linear and similar tools).
- Dark mode depth: raise surfaces by making them slightly lighter with faint white borders instead of shadows; off-white text; one accent plus a semantic set (success, warning, danger, info).
- Data: aligned (tabular) figures wherever numbers appear; skeletons shaped like the content instead of spinners; empty states that explain and offer one action; small trend lines beside key numbers.

**Changed**
- Layout: left sidebar (Deck, Brain, Command center, Crew chat, Automations, Tools, List view, then Settings and Stop all agents or Resume agents), with an accent bar on the current page, an approvals count on Deck, and a collapse to icons. A slim top bar shows the page title, a search box and a chat panel toggle.
- ⌘K (Ctrl K on Windows and Linux) command menu: every page, actions (new chat, show or hide chat, settings, run learning, tune prompts, add to the brain, stop or resume agents), your saved chats and second brain documents, with arrow keys and Enter.
- Shortcuts: ⌘1 to ⌘7 pages, ⌘N new chat, ⌘J chat panel, ⌘, settings.
- Status bar: agents ready or stopped, current model, share of today's tokens with a meter, approvals waiting (click to go to the deck).
- Toasts for approvals, rejections, stops, resumes, automation results, learning and tuning.
- Design tokens: four surface levels, faint borders, off-white text, one accent with a soft tint, semantic colors; Inter for text, Chakra Petch only for the brand and page titles, JetBrains Mono for times, ids and keys; aligned figures in numbers, tables and charts; right-aligned number columns.
- Buttons, inputs and focus rings unified; styled scrollbars and selection; subtle page and toast entrances (off with reduced motion).
- Command center: skeleton while loading, trend lines and change against the earlier half of the period on key numbers. Crew chat, Automations and the Brain library and notes have empty states with one action. Icons in the Talk button.
- One title per page (the top bar), no repeated headings.

**Verified**
- Desktop with a stand-in engine: command center, command menu search and jump, chat panel toggle, deck at full width; no console errors. Fixed along the way: a wall-screen crash when numbers were missing.
- 212 TypeScript tests pass (counted); `pnpm check` green; no secrets in the repo.

## 2026-10-03: Automations, smarter learning, hands-free voice, notifications

**Changed**
- Automations page: name, who does it (any agent), what to do, time and days. Run now, edit, pause, delete. Or ask in chat ("every Monday at 9, have GTM review the pipeline"): the Chief of Staff proposes it and Apply schedules it. Chief of Staff jobs answer in their own chat; crew jobs run as checked tasks. Results go to chat, Crew chat, a desktop notification and Telegram if on. Jobs run while the app is open.
- Learning from documents: the nightly pass (and Run learning now) also reads files and notes you added since last time and saves lasting facts through the usual memory filter. Web pages stay reference only.
- Prompt tuning: for each crew member with misses (unfinished or unchecked tasks, rejected actions), a model drafts 3 to 6 bullets of guidance. Guidance that would loosen approvals, checks or rules is refused. The agent then redoes up to 4 recent tasks twice, with and without the guidance, in a practice run where reading works and anything that would change or send something is only recorded. Each run is checked by the verifier and scored. Adopted only if it is clearly better (at least 0.15 higher on average, not worse on most tasks, no task much worse), and only after you approve the card. It appears as "Learned guidance" in Settings, Crew, where you can remove it. Runs Sunday nights, or Tune prompts now.
- Hands-free voice (off by default; needs push-to-talk set up): a Hands-free button keeps the microphone listening on this machine with a badge always visible. Speech is cut into clips when you pause, turned into text locally, and only clips starting with the wake word ("deck", or your own) are used. The reply is spoken; you can answer without the wake word for 8 seconds. Esc or the button turns it off and the microphone fully stops.
- Desktop notifications (on by default, Settings): when deck is in the background, approvals waiting, replies, automation results, learning reports and security alerts. Uses the Tauri notification plugin.

**Verified**
- Engine: automation proposed from chat, applied, run as a task with a notification, edited, paused, deleted, validated.
- Engine: documents turned into facts once, web pages skipped; tuning scored 0 before and 1 after on practice tasks, practice made no real changes, guidance adopted only after approval and kept across other rule edits.
- Unit: guidance that loosens safety refused; adoption rule; wake word matching; settings for hands-free and notifications.
- Desktop: scheduling a job; hands-free badge on and off with a fake microphone.
- Rust shell with the notification plugin compiles. 212 TypeScript tests pass (counted); `pnpm check` green; no secrets in the repo.

**Not verified yet**
- Hands-free with a real voice, and notifications, on your Mac.

## 2026-10-03: Command center, crew chat, tools page

**Changed**
- History in the encrypted workspace: every model call (agent, model, tokens, cost), every finished task (checked or not), and every crew message.
- Command center page: tokens today against the cap, tasks finished and not finished, share independently checked, approvals waiting and approval rate; tokens per day; tokens by model and by agent; crew work per day; a performance table per agent; second brain growth; issues opened and closed. 7, 30 or 90 days. Refreshes every 15 seconds.
- Crew chat page: a live feed of the crew working: the Chief of Staff handing work over, each tool call as it happens, the report back, the verifier's check, approvals and your decisions. Filter by agent.
- Crew discussions: give a topic and pick who joins; crew members take turns (1 to 3 rounds), each sees what was said, then the Chief of Staff sums up agreements, disagreements and next steps. Talk only: no tools, nothing sent. You can add to a discussion while it runs. Discussions are saved and logged to memory.
- Tools page: state of every integration (Jev, web research, Telegram, VaultProof, voice, camera, Gmail and Calendar, second brain imports) with shortcuts to set each up, and a table of which agent can use what.
- Jev: API key saved in the OS keychain (`tool.jev`) and an https API address in settings. It connects once Jev's API docs are added.
- Header: Deck, Brain, Command center, Crew chat, Tools, List.

**Verified**
- Engine: a delegated task produces handoff, tool, report and check messages in order; an approval and a rejection appear; a two-round discussion runs in turn and ends with a summary; analytics count tokens by agent, checked tasks and rejections.
- Settings: Jev address must be https.
- Desktop with a stand-in engine: the command center charts, the activity feed, a discussion, saving a Jev key to the keychain.
- 203 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` green; no secrets in the repo.

**Waiting on you**
- Jev's API docs, to connect routing.

## 2026-10-03: Streaming chat, saved chats, second brain, livelier station

**Changed**
- Chat streams: replies appear word by word with typing dots until the first words arrive. Streaming works on Claude, OpenAI and Gemini (each provider's event stream, tool calls rebuilt from pieces). The Chief of Staff walks to its console and types while answering.
- Saved chats: a Chats list (rename, delete) and New chat. Each chat keeps its own history in the encrypted workspace; memory still spans all chats. Telegram is one ongoing chat.
- Second brain (`packages/ingest`, memory documents): drop or choose files (PDF, Word, Markdown, text, CSV, JSON, HTML; 25 MB each), paste text, add a web page (links to this computer or a private network refused), import an Obsidian vault or Markdown folder, a Notion export zip, or Apple Notes (Mac, asks permission), and write notes in the app with [[links]]. Everything is split into passages, embedded with the memory model, and found by keyword and meaning. Re-imports skip notes already added. Switching the memory search model rebuilds document search too.
- The crew recalls document passages alongside facts, always wrapped as untrusted data (they may contain instructions from strangers).
- Brain view (header: Deck, Brain, List): a 3D map of what the crew knows: you, people and things from facts, and every document, linked by relationships, note links and mentions. Turn, zoom, search, click to read a document or a subject's facts, remove documents. Add, Notes and Library tabs beside it. The Archive station has an "Open the second brain" button.
- Station: the outpost now sits on an asteroid in open space with a ringed planet and a moon; extra props, blinking wall lights, a rotating beacon; holo screens with live numbers (today's work and approvals, open issues, drafts, memory facts, documents and skills, tokens against the daily cap); crew members type at glowing consoles while working and take short walks when idle (all motion off with reduced motion).

**Verified**
- Streaming tests for each provider; agent loop passes streamed text with breaks between turns.
- Saved chats: separate histories, naming from the first message, rename, delete, streamed text events.
- Memory contract suite (both adapters): documents stored, searched, updated, deleted, recalled with citations; migration rebuilds documents.
- Ingest tests: Markdown with front matter and wikilinks, HTML cleanup, text, PDF, unknown types refused, private links refused, page fetch, Notion zip, Apple Notes listing.
- Engine: every way to add content, re-import skipping, passages wrapped as untrusted in the prompt, graph links, deletion; wall-screen numbers.
- Desktop with a stand-in engine: typing dots then streamed text, chat list and reopening a chat, the Brain view with 51 points and 92 links, adding text, the upgraded station with live screens and working crew.
- 201 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` green; no secrets in the repo.

**Not verified yet**
- Real streaming, web pages and Apple Notes on your Mac.

## 2026-10-03: First real Mac install: signing fix

**What happened**
- First run of `Install deck.command` on a Mac mini (Apple Silicon): Command Line Tools, Node, pnpm, Rust, packages, engine packaging, web build and the full release compile all succeeded. The last step, signing the app, failed: "resource fork, Finder information, or similar detritus not allowed".
- Cause: macOS file labels (quarantine from the download, Finder info, iCloud sync on the Desktop) were copied into the app bundle, and Apple's signing tool refuses them.

**Changed**
- The installer strips those labels from the folder before building and again before bundling, and builds in `~/.deck-tools/target` (outside iCloud-synced folders) so they cannot come back mid-build.

**Verified**
- On the Mac: every step up to signing (first real-hardware run).
- Script passes `bash -n` and shellcheck.

## 2026-10-03: Open source (MIT), snapshots, spoken replies

**Changed**
- MIT license (`LICENSE`, copyright "the deck authors"; change it to your company name if you prefer), `SECURITY.md` (private vulnerability reports, what matters most), `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md` (Kenney CC0, Chakra Petch OFL, the embedding model's Apache 2.0, Node). Every package marked MIT. Full git history scanned for secrets: clean. No personal details in the repo (a test name was changed to a placeholder).
- Pictures in chat (off by default, Settings > Camera and pictures): Snapshot opens the camera with a "Camera on" badge and turns it off right after the picture; Attach adds a JPEG, PNG or WebP file. Up to 3 per message, 5 MB each. Pictures go to the model with the message, are marked as data not instructions, and are never stored in memory.
- Images work on Claude, OpenAI and Gemini (each provider's own image format).
- Spoken replies (Settings > Voice): the Chief of Staff's replies can be read aloud with the computer's built-in voice.
- macOS camera permission text.

**Verified**
- Provider tests for image requests on all three providers.
- Engine: pictures refused when off, wrong types refused, sent as image blocks with the data-not-instructions note, never in memory.
- Desktop with a fake camera: badge shows, the camera closes after the snapshot, the picture is attached and sent.
- 184 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` green; no secrets in the repo.

## 2026-10-03: Phase 5: workspace packs and starting setups

**Changed**
- `packages/packs`: five starting setups, each a `pack.json`: Startup founder, Freelancer or consultant, Student, VaultProof, Start blank. A pack adds crew rules, tool limits, approved skills, a few starter issues, interview hints and a preset. Packs are checked on load: they may only set tools to "ask" or "off", so a pack can never give an agent more power or switch off a locked rule.
- Engine: `packs.list` and `packs.apply`. Applying merges the pack's rules with yours, keeps anything you switched off, adds its skills as approved, creates starter issues once, and sets the preset. Safe to apply twice.
- Onboarding has a new "Starting setup" step after connecting a model. Picking a pack applies it and carries its interview hints and preset into the next steps.
- The VaultProof pack: security-buyer-first outreach, no claims that are not stated facts, credential-touching engineering work asks first, breach research with sources, and skills for CISO outreach and breach triage.

**Verified**
- Pack tests: all shipped packs valid, blank last, a pack that tries to allow sending is refused.
- Engine: applying VaultProof adds rules, the Engineering issue-writing limit, two approved skills and two issues; applying again changes nothing; the Student pack switches the preset to cautious.
- Onboarding with a stand-in engine: the setup step lists packs, applying one moves to About you with the pack's hints.
- 182 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` runs 54 tasks green; no secrets in the repo.

## 2026-10-03: One-click installers for Linux and Windows

**Changed**
- `install-linux.sh`: installs system libraries (apt on Ubuntu and Debian, dnf on Fedora), private Node 22 (checksum verified) and Rust in `~/.deck-tools`, builds a `.deb`, `.rpm` or AppImage to match the distro, installs it, and opens deck. Warns if no system keyring is running. `uninstall-linux.sh` removes it and asks before deleting data.
- `Install deck.cmd` (Windows, double-click) runs `scripts/install-windows.ps1`: installs the Visual Studio C++ build tools and WebView2 with winget if missing, private Node and Rust in `%LOCALAPPDATA%\deck-tools`, builds the NSIS installer, installs it silently per user, and opens deck. Log in `%LOCALAPPDATA%\deck-install.log`. `Uninstall deck.cmd` removes it and asks before deleting data.
- Fixed the app identifier: `dev.deck.app` ends in `.app`, which clashes with macOS app bundles. It is now `dev.deck.desktop` (data folder name changes; keychain entries keep the `dev.deck.app` name). No one had installed yet, so nothing moves.
- README: install steps for all three systems.

**Verified**
- Linux installer ran end to end here on Ubuntu 24.04: libraries, Node, pnpm, Rust, engine packaging, release build, `.deb` installed (`/usr/bin/deck`, bundled `deck-node` and engine present).
- Found and fixed along the way: the build machine ran out of disk; the installer now says plainly which step stopped.
- Windows scripts parse cleanly in real PowerShell 7.4, and the Node download lookup finds the Windows file. Linux scripts pass shellcheck.

**Not verified yet**
- Running the Windows installer on Windows, and the Mac installer on a Mac.

## 2026-10-03: One-click Mac installer

**Changed**
- `Install deck.command` (double-click in Finder): checks Apple's Command Line Tools (offers to install), downloads a private Node 22 into `~/.deck-tools` (checksum verified), enables pnpm, installs a private Rust, builds the engine and the app, replaces `/Applications/deck.app`, and opens it. Logs to `~/Library/Logs/deck-install.log`; stops with a plain reason if a step fails. Your data and keys are kept.
- `Uninstall deck.command`: removes the app; deletes your data only if you type DELETE; optionally removes the build tools.
- Installer builds are signed ad hoc so they run on Apple Silicon; real signing still comes from the release workflow when certificates are added.
- README: install steps.

**Verified**
- Both scripts pass `bash -n` and shellcheck; the Node download lookup finds the Apple Silicon and Intel files; the build flags match the Tauri CLI.

**Not verified yet**
- A full run on a Mac (it can only run there).

## 2026-10-03: Crew motion on handoffs, push-to-talk

**Changed**
- 3D deck: when a crew member takes a task from the Chief of Staff, and when it reports back (done or not finished), it walks to Command and back, legs swinging. Skipped when reduced motion is on.
- Voice push-to-talk (off by default): a Talk button next to Send; a red "Microphone on" badge while recording; Esc or Stop ends it; it stops itself after 2 minutes; the microphone turns off as soon as recording ends. Speech is turned into text on this machine with whisper.cpp and put in the message box for you to check before sending. The audio is deleted right after.
- Settings > Voice: whisper.cpp program and model paths, on/off. Startup check reports off, ready, or which path is missing. Telegram voice notes use the same setup.
- macOS microphone permission text added (`Info.plist`).

**Verified**
- Engine: transcription only when voice is on; empty audio refused; startup check flags missing paths.
- Desktop with a fake microphone: Talk shows the badge, Stop sends the audio, the text lands in the message box, the badge goes away.
- 3D deck render: a handoff starts the walk.
- 179 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` green; no secrets in the repo.

**Not verified yet**
- Real whisper.cpp transcription (needs it installed on your Mac).

## 2026-10-03: Phase 4: research agent and the 3D command deck

**Changed**
- Research agent (`packages/agents/research`): answers with sources, separates facts from interpretation, saves findings with their source, proposes fixes as issues. Cannot send or contact anyone.
- `webResearch` in `packages/models`: one call using the provider's own search tool. Claude web search, OpenAI Responses web search, Gemini Google Search grounding. OpenRouter is refused with a clear message. Sources keep only http(s) links.
- Engine tools: `web_research` (results wrapped as untrusted and secret-scrubbed, 25 searches a day) and `review_crew` (unfinished tasks, rejected actions, skills in trouble). The Chief of Staff can delegate to Research. Every Monday at 09:00 Research runs a self-review and reports.
- 3D command deck in the app, built from the Kenney Space Station Kit (CC0; 45 models, 640 KB, license included): 8 stations (Command, Comms, Engineering, Operations, Science lab, Archive, Reactor core, Vault), an astronaut per crew member. Rings and tags show live status from engine events: working, needs you, not finished, standby. Click a station or use the chips to fly there; the side panel explains the station and has Approve and Reject for anything waiting. The vault sends a beam when you approve; the archive lights up when the crew learns; the core dims when agents are stopped.
- List view toggle in the header (saved in settings) for older machines. Reduced motion respected. Approval messages use friendly agent names.
- Plan doc: the Kenney look is now the chosen look.

**Verified**
- Provider tests for web research on Claude, OpenAI and Gemini (stand-in servers); unsupported provider and bad key messages.
- Engine: research results wrapped as untrusted (an attacker's closing tag stays inside), daily cap, Research in the crew and delegate list, self-review report lists unfinished tasks and rejections.
- 3D deck rendered in a headless browser with a stand-in engine: overview, a working station, an Operations approval shown on the deck and in chat, flying to a station, Approve from the panel. Station rules unit-tested.
- 177 TypeScript tests and 6 Rust tests pass (counted); `pnpm check` green; no secrets in the repo.

**Not verified yet**
- Live web research (needs your key).
- The 3D deck on your Mac's GPU (tested with a software renderer).

## 2026-10-03: Crew rules you can change

**Changed**
- Plan doc: new section "Agent rules: what is fixed and what you can change" (four layers: locked-on safety in code, built-in defaults, your crew rules, approved skills; how they combine; how to change them; limits).
- Fixed a gap: each agent's `tools.json` "ask first" list was ignored by the action gate. It now forces approval on any preset.
- `packages/agents/crew-config.ts`: your changes per agent (instructions, extra rules, each tool Allowed, Ask me or Off). Changes can only narrow an agent: tools can be limited, never added; locked rules always apply; size limits match role files.
- Engine: crew rules stored in the encrypted workspace with history (who, when, what, Settings or chat) and undo. Every prompt uses your version. The startup check reports how many agents have your rules.
- Chat: the Chief of Staff turns "from now on GTM should never mention pricing" into a proposal; Apply (or /apply on Telegram) makes it real.
- Settings > Crew: tabs per agent, instructions with Reset to default, your rules, tool permissions, locked rules shown read-only, Save, Undo last change, recent changes.

**Verified**
- Agents: tools can be limited not added; size checks; owner rules in the role text; ask-first forces approval even on Autonomous.
- Engine: Settings changes reach the prompt, a switched-off tool disappears, ask-first waits for approval, history and undo; widening refused; chat proposal applies only on Apply and GTM then follows the rule.
- Desktop Crew screen with a stand-in engine: add rule, set Ask me first, save, history.
- `pnpm check` green; no secrets in the repo.


## 2026-10-03: Crew rules you can change (Settings and chat)

**Changed**
- Plan doc: new section "Agent rules: what is fixed and what you can change" (four layers, how they combine, how to change them, limits).
- `packages/agents/crew-config.ts`: your changes per agent (instructions, your own rules, each tool Allowed, Ask me first, or Off). Validation keeps changes from adding tools an agent does not have built in and keeps the size limits.
- Gap fixed: the "ask first" list in each agent's tool file was ignored by the gate. It is now honored, together with the preset and your crew rules.
- Engine: your rules are stored in the encrypted workspace with history (who, when, what, from Settings or chat) and undo. Prompts and permissions use your rules on the next task. Startup check reports how many agents have your rules.
- From chat: "from now on GTM should never mention pricing in first emails" makes the Chief of Staff propose the change; Apply (or /apply on Telegram) confirms; nothing changes before that.
- Desktop: Settings > Crew with a tab per agent, instructions editor with Reset to default, your rules (add, remove), tool permissions, the locked rules shown read-only, recent changes, and Undo last change.

**Verified**
- Agent tests: tools can be narrowed but not widened; size limits; owner rules in the role text; ask-first honored even on Autonomous.
- Engine tests: Settings change puts the rule in the prompt, removes a switched-off tool, makes a tool wait for approval; history and undo; widening refused; chat proposal applies only on Apply and GTM then follows the new rule.
- Desktop: Crew screen sends the right change and shows the saved summary and locked rules.
- `pnpm check` green; no secrets in the repo.


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
- All TypeScript and Rust tests passed at the time; `pnpm check` green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` green; no secrets in the repo.

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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 50 tasks green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 50 tasks green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 49 tasks green; no secrets in the repo.
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
- Memory contract passes on both adapters (every behavior), tracker contract passes on both.
- SQLite to in-memory migration keeps vectors; in-memory to SQLite with a different vector size re-embeds and recall still works.
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 37 tasks green; memory evals still 5/5; no secrets in the repo.

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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 37 tasks green; no secrets in the repo.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 34 tasks green.
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
- All TypeScript and Rust tests passed at the time; `pnpm check` runs 30 tasks green; Rust shell compiles (`cargo test`).
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
