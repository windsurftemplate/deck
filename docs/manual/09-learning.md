# 9. How the crew learns

deck does not retrain any model. The crew gets better through memory, skills and rules, all of which you can see and undo.

## Right away

- When something is worth keeping, the crew saves a fact. A filter drops vague claims and duplicates, replaces outdated facts while keeping history, and sends contradictions to a review queue.
- Files and notes you add are searchable immediately.

## Experience recall

Before each task, a crew member sees up to three of its most similar past tasks: how each went (finished and checked, not checked, or not finished and why) and what it reported. It repeats what worked and avoids past mistakes. This is automatic.

## Failure lessons

When delegated work fails its check, a cheap model writes one sentence on what to do differently next time. Experience recall shows these lessons on similar future tasks, and surfaces unfinished tasks with a lesson even when they are a looser match.

## Skills

After a task that passed the checker, a cheap model may suggest a reusable skill: a short procedure with a name and steps. An approval card asks you. Approved skills appear in every agent's skill index, and each use is counted as a success or failure. Skills that fail more than they succeed are retired at night.

## Nightly learning (02:00)

Also available as **Run learning now** in Settings > Learning.

- Turns the day's events into facts, through the memory filter.
- Reads files and notes you added since the last run and saves lasting facts (web pages excluded).
- Reviews what you rejected and flags agents that keep getting rejected.
- Retires failing skills.
- Sends you a short report.

## The playbook

Each crew member has a **playbook**: separate lessons that worked, shown in **Settings > Crew** with how often each helped (+) or misled (-).

- After every checked task, the lessons the agent cited get credit or blame automatically. Lessons that mislead 3 more times than they help are retired.
- New lessons suggested from real work are queued, never added straight away.
- Lessons are only ever added or retired, never reworded, so detail is not lost over time. (This follows the ACE research on evolving playbooks.)
- Remove any lesson with its × button.

## Idle-time notes

After 20 minutes without activity (at most every 3 hours), deck condenses recent facts and events into short notes: one about you and what is in motion, one per crew member, and the requests you are likely to make next. Agents see them in their "Situation now" section. Turn this off or run it now in **Settings > How agents think**. It reads your facts and the crew's own history only, never documents or web pages, and drops anything that looks like an injected order.

## Prompt tuning (Sunday night)

Also available as **Tune prompts now**.

1. For each crew member with misses (unfinished or unchecked tasks, rejected actions), a model drafts new lessons, joined by the lessons queued from real work.
2. Guidance that would loosen approvals, checks or your rules is refused automatically.
3. The agent redoes up to 4 recent tasks twice, with and without the guidance, as practice (nothing changed or sent).
4. Each run is scored by the checker. The guidance is offered only if it is clearly better: higher on average, not worse on most tasks, and no task much worse.
5. You approve it on a card. The lessons are added to the agent's playbook in Settings > Crew, where you can remove any of them.

## Weekly self-review (Monday 09:00)

Research reviews the crew's failures and rejections from the past week and proposes fixes as issues.

## Skills from anywhere (SKILL.md)

deck's skills use the open Agent Skills format (a folder with a SKILL.md file), shared by many AI tools. In **Settings > Learning**:

- **Import SKILL.md files**: each is scanned, and waits for your approval before the crew can use it. Only the instructions are used; scripts and extra files are not run.
- **Export skills**: writes every active skill to Documents/deck-skills as name/SKILL.md.

## Your crew rules

**Settings > Crew** shows each agent's rules in four layers:

1. **Locked rules** (always on, cannot change): anything external needs approval, the secret scanner, the untrusted-content wrapper, the tripwire, no delegation by crew members, a step limit.
2. **Built-in instructions** for each role.
3. **Your rules**: edit instructions, add rules, set each tool to Allowed, Ask me first, or Off.
4. **Learned guidance and skills.**

Your changes can only make an agent more careful: tools can be limited but never added. Every change has history and **Undo last change**. You can also ask in chat ("from now on, GTM should never mention pricing"); it becomes a proposal you apply.

## Starting setups (packs)

Packs add rules, tool limits, approved skills, first issues and a preset for a kind of work. They can only make the crew more careful. Applying a pack twice changes nothing.


## The eval gate

Before deck asks you to add new playbook lessons, they must pass an eval gate: the offline evals must all still pass, and if the live suite is on, the agent's prompt with the new lessons must do at least as well on live tasks as the last live run. The approval card shows the gate result.
