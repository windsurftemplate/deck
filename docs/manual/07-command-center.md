# 7. The command center

The command center shows how deck is set up and how the crew is doing. Choose 7, 30 or 90 days at the top.

## Setup health

A score out of 100, from twelve checks. Each check that fails has a plain fix and a **Fix** button that takes you there.

| Check | Why it matters |
|---|---|
| Key for your main model | Nothing works without it |
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
