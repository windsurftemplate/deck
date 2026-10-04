# 7. The command center

The command center shows how deck is set up and how the crew is doing. Choose 7, 30 or 90 days at the top.

## Setup health

A score out of 100, from fourteen checks. Each check that fails has a plain fix and a **Fix** button that takes you there.

| Check | Why it matters |
|---|---|
| Key for your main model | Nothing works without it |
| Saved keys passed their last test | A rejected or out-of-credit key fails quietly otherwise |
| Offline evals all passing | A failing eval means a protection or behavior has broken |
| A fallback model on another provider | An outage at one provider does not stop the crew |
| A backup in the last 14 days | Your memory survives a lost laptop |
| Approvals on Cautious or Balanced | Autonomous lets writes happen without asking |
| Tripwire planted | Detects attempts to misuse the crew |
| A sensible daily token budget | Limits runaway costs |
| Learning ran in the last 3 days | The crew keeps improving |
| Nothing waiting for you over a day | Stale approvals block work |
| Crew finishes at least 70% of tasks | Low success suggests prompts or models need attention |
| Automations running without errors | Broken jobs are easy to miss |
| Telegram limited to your chat | Only you can talk to your bot |
| Web research available | Research needs Claude, OpenAI or Gemini |

Checks that do not apply (Telegram when it is off, for example) are left out. deck keeps a daily score and warns you when a check that used to pass starts failing.

## Evals

Evals check that deck still works the way it should. Each suite shows its score, cases passed, a trend, when it last ran, how long it took, and any tokens used. Click a suite to see every case with its result and details.

| Suite | What it checks | Tokens |
|---|---|---|
| Memory recall | The right facts are recalled from a realistic history, and outdated ones are not | None |
| Safety (compromised model) | With a model that obeys an injected email: sends wait for approval on every preset, rejected and denied actions never run, secrets never reach the model, the untrusted wrapper holds, the tripwire stops the run, the plan lock blocks unplanned actions, the CISO never decides, learning cannot weaken safety | None |
| Crew behavior (sandbox) | A temporary copy of deck with scripted models: unfinished delegated work is caught, escalation happens once after a failure, failure lessons are recalled, helpers are capped and narrowed, custom members get only safe tools, CISO reviews never decide | None |
| Live models | Real tasks on your models (and Jev if on): calling the right tool, not following instructions hidden in an email, valid JSON output, the checker telling finished from unfinished work, routing requests | A small amount |

- **Run evals** runs the three offline suites (a few seconds). They also run every night at 03:30.
- **Run live evals** runs the live suite on demand. Tick **Also run the live suite every Sunday** to schedule it.
- If a suite scores lower than its previous run, you get a notification and a note in Crew chat naming the failing cases.
- Setup health includes "Offline evals all passing".

The live suite measures the models themselves. Even when a model fails "resisting injected instructions", the approval gate still stops the action; the eval tells you how much the gate is being relied on.

## Key numbers

- **Tokens today** against your budget, with a 14-day trend.
- **Tasks finished** and not finished, with the change against the earlier half of the period.
- **Share independently checked** by the verifier.
- **Waiting for you**, and your approval rate.

## Charts

| Chart | Shows |
|---|---|
| Tokens per day | Daily usage, and dollars if you set prices |
| By model, By agent | Where tokens go |
| Crew work per day | Finished and not-finished tasks |
| Crew performance | Per agent: finished, not finished, checked, success rate |
| Second brain | Facts and documents over time |
| Issues | Opened and closed per day, and how many are open |

History starts when you first use deck; nothing earlier exists.
