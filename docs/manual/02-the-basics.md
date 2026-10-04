# 2. The basics: how deck works

This chapter explains the ideas you will meet everywhere in the app. Read it once and the rest of the manual will make sense.

## The crew

| Crew member | What it does | What it cannot do |
|---|---|---|
| **Chief of Staff** | Talks with you, plans the day, writes briefings, hands work to the crew, keeps approvals in one place, proposes changes to settings and schedules | Act on anything outside your machine without approval |
| **GTM** | Lead notes, outreach drafts, follow-ups | Send email, contact anyone |
| **Operations** | Tracker hygiene, admin drafts, commitments | Send, delete, pay |
| **Engineering** | Breaks work into issues, records decisions | Merge code, deploy |
| **Research** | Web research with sources, weekly self-review of the crew | Contact anyone, send anything |

Crew members cannot hand work further down. Only the Chief of Staff delegates.

## Delegation and the checker

When the Chief of Staff hands work to a crew member, it writes a task brief: the goal, why it matters, and a **done when** list (what must be true for the task to count as finished). The crew member works on it, then a separate, cheaper model, the **verifier**, checks the report against the done-when list. If something is missing, the crew member gets one retry with the exact gaps. The result is reported as checked, not finished, or not checked.

## How agents think

Every agent works in a loop: **observe, think, act, reflect**.

1. **Observe.** Before acting, it looks at the situation: the time, approvals waiting for you, active goals, and its own recent unfinished tasks. Plus the usual memory recall.
2. **Think.** On complex work it writes a short plan first (which steps, which tools, the main risk). On hard work, such as analysis, comparisons and decisions, it also uses the model's built-in reasoning. Simple requests skip both and answer right away.
3. **Act.** It uses tools through the same safety gate as always.
4. **Reflect.** If a step fails or is refused, it is told plainly and revises its plan instead of repeating the same call.

Two more things happen when an agent has a plan:

- **A living to-do list.** After every step, the plan and what is done so far are restated at the end of what the agent reads, so long tasks stay on track.
- **Plan lock.** Once outside content (an email, a web page, a document) is in the conversation, only the tools named in the plan, plus safe internal lookups, may run. Instructions hidden in that content cannot add new actions; the attempt is refused and shown in Crew chat.

Summaries of the plan, the reasoning and any rethinking appear in **Crew chat** as "Thinks". Change when agents think in **Settings > How agents think**: complex work only (default), always, or off, and how much built-in reasoning to use.

## Approvals and presets

Every tool an agent can use has a kind:

- **Read**: looking things up (memory, issues, the web). Never needs approval.
- **Write**: changing something on your machine (creating an issue, saving a fact, writing a draft).
- **External**: anything that leaves your machine (sending email, posting). Always needs approval, on every preset.

Your preset decides the rest:

| Preset | Writes | External actions |
|---|---|---|
| **Cautious** | Ask you first | Ask you first |
| **Balanced** (default) | Allowed | Ask you first |
| **Autonomous** | Allowed | Ask you first |

Yes, even Autonomous asks before anything leaves your machine. That rule is locked in code and cannot be changed by any setting, pack, crew rule or learned guidance.

Approvals appear as cards in chat, on the Vault station of the 3D deck, in desktop notifications, and on Telegram if you turned it on. An approval expires if you do not answer it.

## Memory

deck remembers four kinds of things:

- **Facts**: short statements like "Dana Wright is the CISO at Acme". Each fact has a source: **stated** (you said it) or **inferred** (the crew worked it out). When a fact changes, the old one is kept as history and the new one replaces it.
- **Episodes**: a short log of what happened: chats, tasks, decisions.
- **Documents**: files, notes, web pages and imports in your second brain.
- **Skills**: short, approved procedures the crew reuses, like "how to write a design partner follow-up".

When you send a message, deck searches memory by meaning and by keywords, follows links one step (Acme leads to Dana), and gives the best matches to the model with their ids, so answers can cite them.

## Your data stays on your computer

- Memory, chats, issues, goals and the second brain live in one encrypted file (`workspace.db`) in your app data folder.
- The key that unlocks it lives in your system keychain, never in a file.
- API keys also live in the keychain.
- The only things that leave your machine are the requests to your chosen model provider, and web searches if you use Research.

## The stop switch

**Stop all agents** (bottom of the sidebar) stops every agent immediately and rejects everything waiting for approval. Nothing runs until you press **Resume agents**.

## Where things are in the app

| Area | What you do there |
|---|---|
| **Deck** | The 3D space station. See who is working, approve actions, open stations |
| **Brain** | Your second brain: add files, notes, links and imports; explore the 3D map |
| **Goals** | Big goals broken into milestones, with progress |
| **Command center** | Setup health, spend, crew performance, growth, throughput |
| **Crew chat** | Watch the crew work step by step; start crew discussions |
| **Automations** | Scheduled jobs and multi-step workflows |
| **Tools** | Integrations, keys, model arena, who can use what |
| **List view** | A simple, light view of the crew and chat |
| **Help and course** | This manual and the course on how AI agents work |
| **Settings** | Keys, models, crew rules, voice, camera, backups and more |

The chat panel sits on the right of most pages. Press <kbd>Cmd</kbd> + <kbd>J</kbd> (<kbd>Ctrl</kbd> + <kbd>J</kbd> on Windows and Linux) to show or hide it. Press <kbd>Cmd</kbd> + <kbd>K</kbd> to jump anywhere.
