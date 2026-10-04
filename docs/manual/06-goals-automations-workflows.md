# 6. Goals, automations and workflows

## Goals

Use Goals for outcomes that take weeks, like "Sign 3 design partners".

1. Add a goal with an optional reason and target date.
2. Press **Plan it**. The Chief of Staff breaks it into 3 to 7 dated milestones and adds each as an issue labelled to the goal.
3. Tick milestones as you finish them (this closes the issue). Overdue milestones turn red.
4. **Check progress** writes a short note: on track or not, what moved, what is stuck, and the next step.
5. Every Monday at 08:30 deck checks all active goals and sends you the notes.

**Add milestones** plans more. **Done**, **Drop** and **Reopen** change the goal's state.

## Automations

Automations are jobs the crew runs on a schedule while deck is open.

### Creating one

- On the **Automations** page: name, who does it, what to do, time and days. No days means every day.
- Or in chat: "every weekday at 8, have the Chief of Staff summarize my open approvals". The Chief of Staff proposes it and **Apply** schedules it.

### What happens when it runs

- **Chief of Staff** jobs run in their own chat ("Automation: name").
- **Crew** jobs run as checked tasks, like delegated work.
- **Workflow** jobs run every step of the workflow.
- The result appears in the job's **Last run**, in Crew chat, as a desktop notification, and on Telegram if it is on.

**Run now**, **Edit**, **Pause** and **Delete** are on each job.

Automations only run while deck is open. If your computer is asleep at the scheduled time, that run is skipped.

## Workflows

A workflow chains crew members: each step's result is handed to the next.

1. Open **Automations > Workflows**.
2. Start from a template or **New workflow**.
   - **Account research to outreach**: Research studies a company, then GTM drafts the first email.
   - **Weekly review**: Operations reviews the tracker, Engineering summarizes status, the Chief of Staff combines both.
   - **Breach to content**: Research finds a recent breach, GTM drafts a post about the lesson.
3. Each step has an agent and an instruction. Use `{input}` for something you type when running it, such as a company name.
4. 2 to 6 steps. Start with a crew member; the Chief of Staff can combine results at the end.
5. **Run** shows which step is running. The full result is saved under **Last run**.

Workflows can be scheduled: choose "Workflow: name" as who does an automation.
