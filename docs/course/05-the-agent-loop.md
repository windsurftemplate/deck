# 5. The agent loop

**You will learn:** how the loop works step by step, when it should stop, how to verify work, how to retry well, and how to keep loops safe and affordable.

## The basic loop

Every agent, however sophisticated, runs some version of this:

```
messages = [task]
for step in 1..max_steps:
    reply = model(system, messages, tools)
    if reply has no tool calls:
        return reply.text
    for call in reply.tool_calls:
        decision = gate(call)            # allowed? needs approval? tripwire?
        result = run(call) if allowed    # or "waiting for approval" / "denied"
        messages += [reply, tool_result(call, scrub(result))]
return "stopped after max steps"
```

deck's `runAgent` in `packages/agents/src/act.ts` is this loop with real details: a step limit of 6, per-call gating, approvals that run later via `onLater`, secret scrubbing, the tripwire, streaming text, and a record of every action.

## Stopping conditions

A loop must always end. Common stop reasons:

| Stop | Why |
|---|---|
| The model replies without tool calls | It believes it is done |
| Step limit reached | Prevents runaway loops and cost |
| Budget reached | Token or money cap |
| Tripwire or kill switch | Safety stop |
| Waiting on a person | An approval is pending; resume later |

The step limit is a backstop, not a strategy. If agents often hit it, the task is too big, the tools are unclear, or the model is weak for the job.

## Verification

"The model said it is done" is not evidence. deck verifies delegated work:

1. The brief includes a **done when** list.
2. After the agent stops, `verifyWork` asks a cheaper model to compare the report and the actions taken against that list, returning JSON: passed, and what is missing.
3. Failed actions always fail the check, whatever the report says.
4. If it fails, the agent gets **one retry with the exact gaps**. Not "try again", but "these items are missing".
5. The result is labeled checked, not finished, or unchecked (if the verifier itself failed).

This is the evaluator-optimizer pattern: one model produces, another judges against criteria. It is cheap insurance, because the verifier reads a short report rather than redoing the work.

## Good retries

- Retry with **specific feedback**, not the same input.
- Cap retries. One informed retry captures most of the benefit.
- Distinguish errors: a rate limit should retry later, possibly on another model; a missing permission should not retry at all.
- deck's router retries transient model errors on the fallback model, and reports permanent errors (a bad key) plainly.

## Planning

For longer tasks, agents benefit from planning first: list steps, then execute. Two forms:

- **Implicit**: the model plans in its reply text, then calls tools. Cheap, usually enough.
- **Explicit**: a planning call produces a plan the harness tracks (like deck's goal milestones), with progress checks against it.

Plans go stale. Re-plan when reality diverges, and keep plans visible so people can correct them.

## Human in the loop

Approvals pause the loop for a person. Design them well:

- Show exactly what will happen, with the details needed to decide.
- Let the person approve, reject, and ideally edit.
- Expire stale requests.
- Treat rejections as learning signal (deck reviews them nightly).

Too many approval requests train people to click yes without reading. Put approvals only where the risk is real; make everything else reversible and visible instead.

## Observability

You cannot improve what you cannot see. Record every step: what the model was asked, which tools it called, what came back, what the verifier said, tokens and time. deck's Crew chat shows this live, and the activity tables keep it for the Command center.

## Lab

**Goal:** watch and change the loop.

1. Read `runAgent` and `verifyWork` in `packages/agents/src/act.ts`.
2. Run the loop tests:
   ```
   pnpm --filter @deck/agents test
   ```
3. Find the test where a failed check triggers one retry with the gaps. Change the fake verifier so it fails twice, and confirm the task ends as "not finished" rather than retrying forever.
4. In the app, delegate a task with a done-when item the agent cannot meet ("include last quarter's revenue" when memory has none). Open Crew chat and read the verifier's message.
5. Write down the stop reasons you saw and which one you would expect most often in production.

## Quiz

```quiz
Q: Why does every agent loop need a step limit?
- [ ] Providers require it
- [x] To guarantee the loop ends, capping runaway cost and time
- [ ] To make the model smarter
- [ ] To make streaming work
> A loop that never converges keeps spending tokens. The limit is a backstop; frequent hits mean the task or tools need work.
```

```quiz
Q: What makes a retry effective?
- [ ] Repeating the exact same request
- [x] Giving the agent the specific gaps the checker found
- [ ] Switching to a random model
- [ ] Retrying until it passes, without a cap
> Specific feedback changes the input in a useful way. Uncapped retries waste money and can loop.
```

```quiz
Q: In deck, what happens if an action failed but the agent's report claims success?
- [ ] The verifier trusts the report
- [x] Failed actions always fail the check
- [ ] The task is marked done
- [ ] The owner is never told
> The verifier sees the action records, not just the report, so a failed action cannot be hidden behind confident text.
```

```quiz
Q: What is a risk of asking for approval on everything?
- [ ] It is too safe
- [x] People start approving without reading, which removes the protection
- [ ] Models stop working
- [ ] It costs more tokens
> Approval fatigue turns a safety check into a rubber stamp. Ask where the risk is real; make the rest reversible and visible.
```

## Key takeaways

- The loop is simple; the details (gating, stopping, verifying, retrying) make it dependable.
- Always have stop conditions; treat the step limit as a backstop.
- Verify against explicit criteria, retry once with specifics.
- Put people in the loop where risk is real, and record every step.
