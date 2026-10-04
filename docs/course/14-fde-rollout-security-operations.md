# 14. Forward deployed engineering 3: rollout, security reviews and operations

**You will learn:** how to pass a security review, roll out in stages, manage the change for people, operate the system, measure value, and hand off.

## Security reviews

Most deployments go through the customer's security team. Prepare before they ask.

### What they will ask

| Topic | Be ready to show |
|---|---|
| **Data flows** | A diagram: every system read, what is stored where, what leaves to which provider, in which region |
| **Data handling** | Encryption at rest and in transit, retention, deletion, whether the model provider trains on the data, sub-processors |
| **Access** | Scopes per connection, service account or user delegation, least privilege, how access is revoked |
| **Agent-specific risks** | Prompt injection defenses, approval points, what the agent can never do, kill switch, step and spend limits |
| **Secrets** | Where keys live, rotation, who can see them |
| **Logging and audit** | What is logged, where, for how long, and how agent actions are told apart |
| **Incident response** | How issues are detected, contained and reported |
| **Compliance** | Relevant reports and certifications (for example SOC 2, ISO 27001), a data processing agreement, regional requirements |

Many companies send a standard questionnaire. Keep well-written answers on file; most questions repeat.

### A threat model on one page

Write a short threat model for the deployment: assets (data, credentials, actions), threats (injection through customer content, over-broad access, leaked keys, runaway cost), and the controls for each. Map it to the lethal trifecta (chapter 9) and show which leg is guarded and how. Security teams respond well to a clear, honest model.

## Staged rollout

1. **Shadow mode**: the agent runs alongside people; its output is compared, not used.
2. **Draft mode**: the agent drafts, people review and send. Track edit rates.
3. **Approve mode**: the agent acts after approval on consequential steps.
4. **Autonomous within limits**: low-risk, reversible actions run on their own; others still need approval.

Move to the next stage only when the evals and the human signals (approval rates, edit rates, complaints) support it. Keep the ability to step back.

## Change management

People adopt tools that make their day better and that they trust.

- Involve users from discovery; let them shape the agent's rules.
- Train with their real work, not generic demos.
- Make the controls visible: what it does, what it asks, how to stop it.
- Have a clear channel for feedback, and show that feedback changes things.
- Name an internal champion.

## Operations

- **Monitoring**: success rate, approval and rejection rates, cost per task, latency, error rates, safety signals.
- **Health checks** on credentials, quotas, connectors and scheduled jobs (deck's setup health is a small example).
- **Runbooks** for common incidents: provider outage, expired credentials, a bad output reached a customer, suspected injection.
- **Change control**: prompts, tools and model versions are reviewed and evaluated before deployment, and logged.
- **Model updates**: re-run the eval set before switching models.

## Measuring value

Report against the baseline from scoping:

- Time saved per item and in total.
- Quality: error rate, rework rate, satisfaction.
- Throughput: backlog, response time.
- Cost: model spend versus time saved.

Pair numbers with a few concrete stories. Executives remember both.

## Handoff

A pilot only succeeds if it survives the FDE leaving. Hand over:

- Documentation: architecture, data flows, permissions, runbooks.
- The eval set and how to run it.
- Ownership: named people for operations, prompt and rule changes, and security.
- A roadmap: what to expand next, with the evidence for it.

Then take what you learned back to your product team: gaps in the platform, patterns worth productizing, and connectors worth building once.

## Lab

**Goal:** prepare deck for a security review.

1. Using manual chapter 10, draw a data flow diagram for deck: what is stored, where, and what leaves to which party.
2. Write a one-page threat model for deck: assets, threats, controls. Mark the lethal trifecta legs.
3. Answer ten common security questionnaire items for deck (encryption, retention, access, logging, incident response, sub-processors, training on data, injection defenses, key management, deletion).
4. Propose a staged rollout of deck for a five-person team, with the evidence needed to move between stages.
5. Write a handoff checklist for deck.

## Quiz

```quiz
Q: What is shadow mode in a staged rollout?
- [ ] The agent runs at night only
- [x] The agent runs alongside people and its output is compared, not used
- [ ] The agent is hidden from users
- [ ] Logs are turned off
> Shadow mode measures quality on real work without any risk to the business.
```

```quiz
Q: What evidence should justify moving from draft mode to approve mode?
- [ ] The sponsor's enthusiasm
- [x] Strong eval scores plus human signals such as low edit and rejection rates
- [ ] A new model release
- [ ] The end of the month
> Expand autonomy on evidence, not on a calendar.
```

```quiz
Q: Which question will a security team almost always ask about an AI agent?
- [ ] Which font the UI uses
- [x] Whether the model provider trains on the customer's data, and where data flows
- [ ] How many agents there are
- [ ] Which programming language the UI uses
> Data flows, sub-processors and training use are standard concerns. Have clear, documented answers.
```

```quiz
Q: What makes a handoff successful?
- [ ] The FDE staying forever
- [x] Documentation, the eval set, named owners and a roadmap the customer can run without you
- [ ] Removing all logs
- [ ] A final demo only
> The pilot has to keep working and improving after you leave.
```

## Key takeaways

- Prepare data flows, a threat model and standard answers before the security review.
- Roll out in stages, moving on evidence.
- Change management decides adoption as much as the technology.
- Operate with monitoring, runbooks and change control; report value against the baseline; hand off with owners.
