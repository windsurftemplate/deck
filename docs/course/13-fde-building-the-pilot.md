# 13. Forward deployed engineering 2: building the pilot

**You will learn:** how to connect an agent to a customer's systems, handle their data safely, design permissions with them, run evals together, iterate quickly, and demo honestly.

## Week one: access and a thin slice

The fastest way to lose momentum is waiting on access. In week one:

1. Get credentials for a **test or sandbox environment**, scoped as narrowly as possible.
2. Build a **thin slice**: one end-to-end path through the workflow, even if crude. Read real data, produce one real output, and show it.
3. Collect **20 to 50 real examples** with the customer to seed the eval set.

A thin slice exposes integration problems early, when they are cheap to fix.

## Connecting to systems

| Approach | When |
|---|---|
| **Existing MCP server** | The system already has one (many SaaS tools do). Fastest |
| **Build an MCP server** | You need a reusable connector the agent and other tools can share |
| **Direct API tools** | One or two calls, no reuse needed |
| **Exports and files** | Access is hard; start with exports to prove value while access is arranged |
| **Browser automation** | Last resort; brittle and hard to secure |

For each connection, decide with the customer:

- **Scopes**: read only first; write scopes only for steps that need them.
- **Identity**: does the agent act as a service account or on behalf of a user? Service accounts are simpler; user delegation (OAuth) keeps permissions aligned with people.
- **Rate limits** and quotas.
- **Audit**: can their logs tell agent actions apart from people's?

## Data handling

- Inventory what data the agent will read, store and send, and where each goes.
- Keep secrets in a secret manager, never in prompts or code.
- Redact personal data before it reaches third parties when it is not needed.
- Agree on retention: what the agent stores, for how long, and how it is deleted.
- Treat every document, email and ticket as untrusted content (chapter 9). Customer data is the most common route for indirect prompt injection.

## Designing permissions together

Walk the workflow with the customer and set, for each action: read, draft, act with approval, or act. Write it down as a policy. In deck terms, this is each agent's `tools.json` plus the preset. Start conservative; customers widen autonomy after seeing evidence, and rarely forgive a surprise.

## Evals with the customer

- Have the people who do the work **label examples**: good, bad, and why. Their judgement is the ground truth.
- Turn labels into done-when criteria and a judge prompt; spot-check the judge against their labels.
- Run the eval set on every change, and share a simple scoreboard each week.
- Add every failure they report as a new case.

## Iterating

A good weekly loop:

1. Review the scoreboard and failures with the customer.
2. Pick the top three issues.
3. Fix with the smallest change: context first (missing facts, unclear brief), then tools (clearer names, better errors), then instructions, then model choice.
4. Re-run evals and ship.

Write down what you changed and why. Customers trust a pilot more when they can see it improving for reasons.

## Demos

- Demo on **their data and their cases**, not a polished sample.
- Show a failure and how the system handles it (the verifier catching it, the approval stopping it). Honesty about limits builds more trust than a perfect run.
- Show the controls: approvals, the stop switch, logs.
- End with the numbers against the baseline.

## Lab

**Goal:** build a thin slice for a pretend customer using deck.

1. Pretend a customer wants weekly summaries of their open issues sent to their team lead for review.
2. Seed deck with 10 realistic issues (use the chat: "create an issue...").
3. Create a workflow: Operations reviews the tracker and lists overdue and stale issues; the Chief of Staff writes a one-screen summary.
4. Run it, then write five eval cases (for example: "every overdue issue is listed", "no closed issue appears").
5. Check the output against your cases. Change one thing (the instruction, or the done-when list) and re-run. Did the score improve?
6. Write the permission policy you would propose to the customer for this workflow.

## Quiz

```quiz
Q: What should you build in the first week of a pilot?
- [ ] The complete feature set
- [x] A thin end-to-end slice on real data, plus a starter eval set
- [ ] Only slides
- [ ] A fine-tuned model
> A thin slice exposes integration and data problems early and gives the customer something real to react to.
```

```quiz
Q: When improving a pilot, what should you try first?
- [ ] A bigger model
- [x] Better context (missing facts, clearer briefs), then tools, then instructions, then model choice
- [ ] More agents
- [ ] Removing the evals
> Most failures come from missing context or unclear tools. Model changes are the last and most expensive lever.
```

```quiz
Q: Who should provide the ground truth for evals in a customer pilot?
- [ ] The FDE alone
- [x] The people who do the work today, by labelling real examples
- [ ] The model itself
- [ ] Nobody; use intuition
> The people who do the work know what good looks like. Their labels anchor the evals and the judge.
```

```quiz
Q: What makes a demo most credible?
- [ ] A flawless run on sample data
- [x] Real customer cases, including a handled failure, the controls, and numbers against the baseline
- [ ] Hiding the logs
- [ ] Showing only the happy path
> Showing how the system behaves when things go wrong builds more trust than a perfect demo.
```

## Key takeaways

- Secure access early and ship a thin slice in week one.
- Prefer MCP and narrow scopes; agree on identity, limits and audit.
- Treat customer data as untrusted content and sensitive data.
- Let the people who do the work define quality; iterate weekly on a shared scoreboard.
