# 12. Forward deployed engineering 1: discovery and scoping

**You will learn:** what a forward deployed engineer does, how to run discovery with a customer, how to find work worth automating, how to define success, and how to write a scope that sets a pilot up to succeed.

## The role

A **forward deployed engineer (FDE)** builds with the customer, inside their context. Part engineer, part consultant, part product manager. The job is to turn a capable platform into an outcome for a specific organization: understand their work, build the agent around their systems and data, prove it on real cases, and leave it running and owned.

What separates strong FDEs:

- They start from the customer's workflow, not the technology.
- They define success in the customer's numbers.
- They ship small, real things quickly and earn trust with evidence.
- They treat security, data and change management as part of the build, not an afterthought.
- They bring what they learn back to their own product team.

## Discovery

Discovery finds a problem worth solving that an agent can actually solve. Meet the people who do the work, not only the sponsor.

### Questions to ask

**About the work**

- Walk me through the last time you did this, step by step. What tools did you open?
- How often does it happen? How long does it take? Who else is involved?
- What goes wrong? What happens when it does?
- What does a great result look like? Who judges it?

**About data and systems**

- Where does the information live? (Email, CRM, tickets, docs, databases.)
- How do people access it today? APIs, exports, only through a UI?
- What is sensitive? Personal data, customer data, regulated data?

**About constraints**

- Who must approve an agent touching these systems? Security, legal, IT?
- Which actions must always have a person in the loop?
- What would make this a failure even if it technically works?

### Map the workflow

Draw the current process as steps, with who does each, which system it touches, the time it takes and where errors happen. Then mark each step:

| Mark | Meaning |
|---|---|
| **Automate** | Repetitive, clear rules, low risk, reversible |
| **Assist** | Judgement needed; the agent drafts, a person decides |
| **Keep human** | High risk, relationship-heavy, or unclear criteria |

Good first targets are high volume, clear success criteria, reachable data, and low cost of a mistake.

## Defining success

Agree on numbers before building:

- **Baseline**: how it works today (time per item, error rate, backlog, cost).
- **Target**: what the pilot should reach.
- **Quality bar**: how output is judged and by whom; examples of good and bad.
- **Guardrails**: what must never happen (an email sent without review, data leaving a region).

Write these as an eval plan (chapter 10). The success metric and the eval should be the same thing.

## The scope document

A one to three page document both sides sign off. Sections:

1. **Problem**: in the customer's words, with the baseline numbers.
2. **Users**: who uses it and how often.
3. **In scope**: the workflow steps the pilot covers, and what the agent may do at each (read, draft, act with approval, act).
4. **Out of scope**: just as important.
5. **Systems and data**: each connection, access method, scopes needed, and data sensitivity.
6. **Success criteria**: metrics, targets, eval cases, and who judges quality.
7. **Security and compliance**: data flows, retention, approvals required, reviews needed.
8. **Plan**: weeks, milestones, check-ins, and the decision at the end (expand, change, or stop).
9. **Owners**: on both sides, including who maintains it after the pilot.

## Common scoping mistakes

- Scoping the most impressive workflow instead of the most valuable reachable one.
- Starting without data access agreed. Access delays kill pilots.
- No baseline, so success cannot be shown.
- Full autonomy from day one. Start with draft-and-approve; widen as trust and evals allow.
- No owner after the pilot.

## Lab

**Goal:** practice discovery and scoping on deck itself.

1. Pick a real workflow from your own work (for example, design partner follow-ups). Interview yourself with the questions above and write the answers.
2. Draw the workflow with automate, assist and keep-human marks.
3. Write a scope document for deploying deck's crew on that workflow, using the nine sections.
4. Turn the success criteria into five eval cases with done-when lists.
5. Use deck's Goals page: add the pilot as a goal, press **Plan it**, and compare its milestones with your plan.

## Quiz

```quiz
Q: What should drive the choice of a first pilot?
- [ ] The most technically impressive workflow
- [x] High volume, clear success criteria, reachable data and low cost of mistakes
- [ ] Whatever the sponsor mentions first
- [ ] The workflow with the most steps
> Pilots that can show measurable value quickly earn the right to expand.
```

```quiz
Q: Why agree on a baseline before building?
- [ ] It is a legal requirement
- [x] Without one, you cannot show improvement
- [ ] It makes the agent faster
- [ ] Customers prefer long documents
> A baseline turns "it seems better" into a number both sides accept.
```

```quiz
Q: For a new deployment, which autonomy level is usually right at first?
- [ ] Full autonomy everywhere
- [x] Draft and approve for consequential actions, widening as evals and trust allow
- [ ] No tools at all
- [ ] Whatever the model chooses
> Start where people review consequential actions; expand autonomy as evidence builds.
```

```quiz
Q: Which item belongs in a scope document but is often forgotten?
- [ ] The model's name
- [x] Who owns and maintains the agent after the pilot
- [ ] The color scheme
- [ ] The number of tools
> Without an owner, a successful pilot decays once the FDE leaves.
```

## Key takeaways

- Start from the workflow and the people who do it.
- Choose reachable, measurable, low-risk first targets.
- Define success as numbers and eval cases before building.
- Write a short scope with in and out of scope, data, security, plan and owners.
