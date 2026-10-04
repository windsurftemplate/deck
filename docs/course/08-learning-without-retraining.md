# 8. Learning without retraining

**You will learn:** how agents improve without changing model weights, the main techniques (memory, skills, reflection, experience recall, prompt tuning, model selection), how to keep learning safe, and when fine-tuning is worth it.

## Two kinds of learning

- **Weight learning**: fine-tuning or training changes the model itself. Powerful, but slow, costly, needs data and tooling, and is hard to undo or inspect.
- **Harness learning**: the model stays the same; what changes is what it is given: facts, procedures, instructions, model choice. Fast, cheap, inspectable and reversible.

Most agent products should improve through the harness first. deck does all of its learning this way.

## The learning signals

You can only learn from signals you collect. deck's main ones:

| Signal | Source |
|---|---|
| Task outcome | Verifier verdict: checked, not finished, unchecked |
| Owner decisions | Approvals and rejections, with reasons |
| Stated facts | What the owner tells the crew |
| Usage | Tokens, steps, retries per task |

The richest signal is usually **people's decisions**. Make them easy to give and record them every time.

## Techniques

### Memory updates

Facts saved during work and extracted nightly from episodes and documents (chapter 6). The write gate keeps quality up.

### Skills (procedural memory)

After a checked task, a cheap model proposes a skill: a name, when to use it, and steps. The owner approves it. Active skills appear as one line each in every prompt; agents load the full text with `load_skill` when relevant. Skills carry success and failure counts, and failing ones are retired. See `reflect` in `packages/agents/src/learn.ts`.

### Experience recall

Before a task, the agent sees its most similar past tasks with outcomes and reports, failures included. No approval needed, since it only shows history. See `experienceFor` in `apps/engine/src/engine.ts`. This resembles case-based reasoning: solve new problems by recalling similar solved ones.

### Prompt tuning with practice runs

1. Collect misses for an agent.
2. Draft short guidance aimed at them.
3. **Test it**: replay recent tasks as practice, with and without the guidance. Practice runs read real data but only record writes.
4. Score each run with the same checker.
5. Adopt only a clear win (higher average, not worse on most, no big regressions), and only with owner approval.

See `tune` and `practice` in the engine, and `shouldAdopt` in `packages/agents/src/tune.ts`. The principle is the same one used in machine learning: never ship a change you did not evaluate on held examples.

### Evolving playbooks (ACE)

Rewriting an agent's guidance each time it learns tends to lose detail (brevity bias) and, over many rewrites, collapse it. The ACE research (Zhang et al., 2025) keeps guidance as separate entries that are only added, credited, blamed or retired. deck does the same: after each checked task a reflector credits or blames the lessons the agent cited, new lessons are queued, and tuning adds them only after practice tests and owner approval. See `applyPlaybookDelta` and `reflectPlaybook`.

### Failure lessons and escalation

Weaker models benefit most from remembering their own failures. deck writes a one-sentence lesson for each failed task and shows it on similar tasks. When work still fails on a smaller model, it escalates once to a strong model: a cascade, using the verifier as the escalation signal.

### Learning while idle (sleep-time compute)

Letta's sleep-time compute moves memory work off the critical path: while the user is away, a background pass reorganizes what the agent knows. deck's idle notes condense facts and events into short notes per agent, built only from trusted inputs.

### Optimizing the harness itself

Research is moving from tuning prompts to tuning the whole harness. GEPA (Agrawal et al., ICLR 2026) evolves prompts by reflecting on full execution traces and keeping a Pareto set of candidates. Meta-Harness (Lee, Khattab, Finn and others, 2026) has a coding agent rewrite harness code using traces of earlier candidates. Both point the same way: richer traces and outer-loop search improve agents without touching weights. A practical caution from production use: the optimizing model must be strong, because judging why an agent failed is itself hard reasoning.

### Model selection (the arena)

Different agents may do best with different models. Replay an agent's tasks with each candidate model, score them, and pick the best per agent, with token cost as the tie-breaker.

## Keeping learning safe

Learning loops can drift in bad directions. Guards:

- **Owner approval** for anything that changes behaviour (skills, guidance, models).
- **Hard limits on what learning may change.** deck's `checkLearned` refuses guidance that would loosen approvals or checks; packs and crew rules can only narrow.
- **Never learn from unverified work.** Failing or unchecked tasks never produce skills.
- **Keep everything inspectable and reversible.** History and undo on crew rules; removable guidance; retirable skills.
- **Watch for poisoning.** Documents or pages may carry false "facts" (chapter 9). Inferred facts rank below stated ones, and contradictions go to review.

## When to fine-tune

Fine-tuning becomes worth it when:

- a narrow task runs at very high volume and a smaller tuned model would cut cost or latency substantially;
- the behaviour needed is hard to express in instructions (a house style, a format) and you have many good examples;
- harness techniques have plateaued on a well-measured eval.

Even then, keep the harness learning loop: fine-tuned models still benefit from memory, skills and checks.

## Lab

**Goal:** run the learning loop end to end.

1. Read `reflect` and `extractFacts` in `packages/agents/src/learn.ts`, and `draftGuidance`, `practiceScore` and `shouldAdopt` in `packages/agents/src/tune.ts`.
2. Run the agents tests and find the test that rejects guidance which would skip approvals:
   ```
   pnpm --filter @deck/agents test
   ```
3. In the app, delegate two similar tasks to GTM. Before the second, check Crew chat: did experience recall appear in its context? (Look for "Past experience" in a practice run or add a log line.)
4. Press **Run learning now** in Settings > Learning and read the report.
5. With at least two finished GTM tasks, run the model arena for GTM on the Tools page. Record scores and tokens per model.
6. Write a short note: which learning technique would you trust first in a customer deployment, and why?

## Quiz

```quiz
Q: Why does deck learn through the harness rather than fine-tuning?
- [ ] Fine-tuning is impossible
- [x] Harness learning is fast, cheap, inspectable and reversible
- [ ] Harness learning changes the model's weights
- [ ] Providers forbid fine-tuning
> Changing what the model is given can be tested, approved and undone quickly. Fine-tuning is slower and harder to inspect.
```

```quiz
Q: What must happen before tuned guidance is adopted in deck?
- [ ] Nothing; it is applied immediately
- [x] It must clearly beat the current prompt on practice runs, and the owner must approve it
- [ ] It must be longer than the current prompt
- [ ] A different provider must agree
> Evaluate first, then ask. Never ship an unevaluated behaviour change.
```

```quiz
Q: Which work is never used to create skills?
- [ ] Checked work
- [x] Failing or unchecked work
- [ ] Work done by the Chief of Staff
- [ ] Work approved by the owner
> Learning from unverified work would teach the crew its own mistakes.
```

```quiz
Q: Why does deck add playbook lessons instead of rewriting guidance?
- [ ] Rewriting is slower
- [x] Repeated rewrites lose detail over time; separate entries keep it, and each can be credited, blamed or retired
- [ ] Models cannot read rewritten text
- [ ] To use fewer tokens
> This is the core idea of ACE: incremental, structured updates prevent context collapse.
```

```quiz
Q: When is fine-tuning most likely worth it?
- [ ] For any new agent
- [ ] When the prompt is long
- [x] For a narrow, high-volume task where harness techniques have plateaued on a measured eval
- [ ] When you have no examples
> Fine-tuning pays off with volume, good examples and a clear eval showing harness methods have run out of room.
```

## Key takeaways

- Improve through the harness first: memory, skills, recall, tuned guidance, model choice.
- Collect signals, especially people's decisions.
- Evaluate every behaviour change on held examples before adopting it.
- Limit what learning may change, and keep it reversible.
