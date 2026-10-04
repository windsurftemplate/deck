# 7. Multi-agent systems

**You will learn:** when several agents beat one, the main coordination patterns, how to give each agent the right scope, and the costs of going multi-agent.

## One agent or many?

A single agent with good tools is the right starting point for most problems. Split into several agents when:

- **Roles need different permissions.** GTM may write drafts; Research may search the web. Separate agents make least privilege natural.
- **Roles need different instructions** that would conflict or bloat one prompt.
- **Work can run independently** and in parallel.
- **You want a second opinion**: a checker or a debate.

Do not split just because it sounds sophisticated. Every handoff costs tokens and time and is a place for information to get lost.

## Coordination patterns

| Pattern | How it works | In deck |
|---|---|---|
| **Orchestrator and workers** | One agent breaks down work and delegates; workers report back | The Chief of Staff delegates to the crew |
| **Evaluator and producer** | One agent produces, another checks against criteria | The verifier checks every delegated task |
| **Pipeline (workflow)** | Fixed sequence, each step's output feeds the next | Workflows on the Automations page |
| **Discussion** | Agents take turns on a question, then someone summarizes | Crew discussions in Crew chat |
| **Router** | Classify the request, send it to the right handler | Model roles; the Chief of Staff choosing whom to delegate to |
| **Parallel fan-out** | Several agents work at once, results merged | Not used yet; useful for research across many sources |

More elaborate topologies (meshes, voting, consensus protocols) exist. They matter for some large systems, but for most products the patterns above cover the need with far less complexity.

## Scopes and least privilege

Each deck agent has a policy file (`tools.json`): allowed scopes, scopes that require approval, and denied scopes. The engine offers a tool to an agent only if its scope is allowed, and the owner can narrow (never widen) further. Crew members cannot delegate, so a compromised worker cannot recruit others.

Practical rules:

- Give each agent only the tools its role needs.
- Keep powerful actions (send, delete, pay) out of every agent's allowed list, and route them through approval.
- Make delegation one level deep unless you have a strong reason.

## Handoffs are the interface

The brief (chapter 3) is the contract between agents. A good handoff states the goal, the reason, done-when checks and the return format. The report coming back should say what was done, what is waiting for the owner, and what could not be done. Everything else about multi-agent quality follows from these two messages.

## Shared state

Agents share state through:

- **Memory**: facts and episodes all agents can read.
- **The tracker**: issues as a shared task list.
- **Results passed forward**: as in workflows.

Avoid hidden shared state. If one agent relies on something another did, it should be in memory, the tracker or the brief, where people can see it too.

## Costs and failure modes

- **Token cost** multiplies with agents and handoffs.
- **Telephone game**: details get lost across handoffs. Mitigate with explicit briefs and passing results verbatim where it matters.
- **Agreement bias**: agents in a discussion may simply agree. deck's discussion prompt asks each to add something new, disagree by name, or name a risk.
- **Debugging** is harder. A timeline of every message and tool call (Crew chat) is essential.

## Lab

**Goal:** trace a delegation and run a discussion.

1. Read `delegate` in `apps/engine/src/engine.ts`. Find where the brief is built, where experience recall is added, where the verifier runs, and where messages are posted to Crew chat.
2. Open `packages/agents/gtm/tools.json` and `packages/agents/research/tools.json`. List the differences in allowed scopes.
3. In the app, ask: "Have Research find two recent breaches caused by leaked API keys, then have GTM draft a post about them." Follow the handoffs in Crew chat.
4. Start a crew discussion on a real decision with GTM and Engineering, two rounds. Did they disagree anywhere? Was the summary useful?
5. Build the same task as a workflow (Automations, Workflows). Compare: which gave more predictable results, and why?

## Quiz

```quiz
Q: What is the strongest reason to split work across several agents?
- [ ] It always improves quality
- [x] Roles need different permissions or conflicting instructions
- [ ] It reduces token use
- [ ] Models work better in groups
> Separate agents make least privilege and focused instructions natural. Otherwise a single agent is usually simpler and cheaper.
```

```quiz
Q: Why can crew members in deck not delegate further?
- [ ] It would be too slow
- [x] To keep control simple and stop a compromised worker from recruiting others
- [ ] Providers do not allow it
- [ ] Workers have no tools
> One level of delegation limits the blast radius and keeps the system easy to reason about.
```

```quiz
Q: Which is a common failure in agent discussions?
- [ ] Agents refuse to speak
- [x] Agents simply agree with each other, adding little
- [ ] Discussions always cost nothing
- [ ] The summary is always perfect
> Agreement bias is common. Prompting each agent to add something new or disagree by name helps.
```

## Key takeaways

- Start with one agent; split for permissions, conflicting instructions, parallelism or checking.
- Orchestrator-worker, evaluator-producer and pipelines cover most needs.
- Least privilege per agent and one level of delegation keep systems safe.
- Handoffs are the interface; make them explicit and visible.
