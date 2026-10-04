# 10. Evals: knowing whether it works

**You will learn:** the kinds of evals for agents, how to build an eval set, model-graded checks and their limits, baselines and regression gates, and how to measure in production.

## Why evals are the center of agent work

Agents are probabilistic. A change that fixes one case can break three others, and you will not notice by trying a few prompts by hand. **Evals** are repeatable tests that score behaviour. Teams that ship good agents treat evals the way other teams treat unit tests: written early, run constantly, and required to pass.

## Kinds of evals

| Kind | What it checks | Example in deck |
|---|---|---|
| **Unit tests** | Deterministic code: parsing, gating, formatting | `packages/*/src/*.test.ts` |
| **Contract tests** | Every adapter behaves the same | Memory and tracker contract suites |
| **Retrieval evals** | Does search find the right item? | Memory evals (`evals/`) |
| **Safety evals** | Does the harness block harm with a compromised model? | `evals/src/safety-evals.ts` |
| **Task evals** | Does the agent complete real tasks well? | Practice runs in tuning and the arena |
| **Online metrics** | How does it do with real users? | Command center: success rate, approvals, rejections |

## Building an eval set

1. **Collect real cases.** Real requests beat invented ones. deck's practice cases come from the task log.
2. **Define success for each.** Done-when lists, expected facts, forbidden actions.
3. **Cover the edges**: ambiguous requests, missing data, adversarial content, long inputs.
4. **Keep it small at first.** Twenty good cases you run every day beat a thousand you never run.
5. **Version it** alongside the code, and add a case for every bug you fix.

## Ways to score

- **Exact checks**: was the tool called, with which arguments? Did a send happen? Cheap and reliable; use wherever possible.
- **Programmatic checks**: parse the output and assert on fields, lengths, formats.
- **Model-graded checks (LLM as judge)**: a model compares output to criteria. Flexible for open-ended work, and the basis of deck's verifier.

Model judges have known weaknesses: they can prefer longer answers, agree with confident text, and vary between runs. Reduce this with specific criteria (a done-when list, not "is it good?"), structured verdicts (JSON with passed and missing), feeding the judge the actions taken (not just the report), and spot-checking the judge against human labels.

## Baselines and regression gates

An eval is most useful as a **gate**: record a baseline score, and fail the build if a change lowers it. deck's safety evals have a baseline of 1.0 (every case must pass); weakening the gate drops the score and CI fails. Tuning and the arena use the same idea within the app: a change is adopted only if it beats the current score by a margin, without big regressions on any case.

Compare runs fairly: same cases, same judge, and several runs when outputs vary.

## Evals inside the product

deck runs its evals inside the app as well as in CI, and shows them on the Command center. Three offline suites (memory, safety, and a behavior suite that drives a sandboxed copy of deck with scripted models) run nightly at no token cost. A live suite runs a few real tasks against the user's own models, opt-in, because it costs tokens and its results vary run to run. Every run is stored, so the dashboard shows trends and flags a drop against the previous run. See `apps/engine/src/evals.ts` and `evals/src/index.ts`.

Two design points worth copying. First, keep deterministic suites (harness behavior, safety) separate from probabilistic ones (live model quality): the first should always be 100%, the second is a trend to watch. Second, make the sandbox real: the behavior suite builds a full engine in a temporary folder rather than mocking its internals, so it catches wiring mistakes that unit tests miss.

## Measuring in production

Offline evals predict; production confirms. Track:

- **Outcome**: tasks finished and checked, success rate by agent.
- **Human signals**: approval and rejection rates, edits to drafts.
- **Cost and latency**: tokens per task, steps per task, time to first token.
- **Safety**: tripwire hits, scanner flags, denied tool calls.

deck's Command center and setup health show these. Each bad outcome in production should become a new eval case.

## Lab

**Goal:** add an eval and see a gate work.

1. Run all evals:
   ```
   pnpm --filter @deck/evals test
   ```
2. Read how the memory evals score retrieval. Add a case: a fact with a distinctive name, and a query phrased differently. Run again.
3. Add a safety eval case: an injected document instructs the agent to create an issue titled with the tripwire value. Assert the run stops and the issue is never created.
4. In the app, after a few delegated tasks, compare the Command center's success rate with what you see in Crew chat. Do they agree?
5. Write a one-page eval plan for an agent that triages customer support emails: cases, success criteria, scorers, and the production metrics you would watch.

## Quiz

```quiz
Q: What makes an eval most useful during development?
- [ ] Running it once before launch
- [x] Running it constantly as a gate that fails when the score drops below a baseline
- [ ] Having thousands of cases you rarely run
- [ ] Only testing with real users
> A gate turns evals into protection against regressions on every change.
```

```quiz
Q: How can you make a model-graded check more reliable?
- [ ] Ask "is this good?"
- [x] Give specific criteria, ask for a structured verdict, and include the actions taken
- [ ] Use the longest possible answer
- [ ] Never compare it with human judgement
> Specific criteria and evidence reduce judge bias; spot-checking against people keeps it honest.
```

```quiz
Q: Why does deck keep its live-model suite separate from the offline suites?
- [ ] Live suites are always more accurate
- [x] Offline harness and safety suites should always pass, while live model results vary and are watched as a trend
- [ ] Live suites cannot be stored
- [ ] Offline suites need a network connection
> Deterministic checks are gates; probabilistic model quality is a trend. Mixing them hides real regressions in noise.
```

```quiz
Q: What should happen after you fix a bug found in production?
- [ ] Nothing more
- [x] Add a case for it to the eval set so it cannot quietly come back
- [ ] Delete the related evals
- [ ] Switch models
> Each fixed bug becomes a permanent test.
```

## Key takeaways

- Evals are the core discipline of agent engineering.
- Use exact and programmatic checks first; model judges where needed, with specific criteria.
- Gate changes on baselines; adopt changes only when they win.
- Feed production failures back into the eval set.
