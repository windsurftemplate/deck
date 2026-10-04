# 11. Production engineering

**You will learn:** routing and fallbacks, budgets, streaming and latency, observability, data protection, packaging and distribution, and operating an agent product over time.

## Model routing and fallbacks

- **Match model to step.** Strong models for planning and hard work; fast, cheap models for checking, summarizing and extraction. deck's heavy and cheap roles, plus per-agent models from the arena.
- **Fail over on transient errors.** Rate limits and outages happen. A fallback model on a different provider keeps work going. deck's router (`packages/models/src/roles.ts`) retries retryable errors on the next model in the chain.
- **Do not retry permanent errors.** A rejected key or a malformed request needs a clear message, not a retry loop.
- **Abstract providers** behind one interface so routing is configuration, not code.

## Budgets and limits

- Step limits per run, retry caps, daily token budgets, and per-tool rate limits (deck caps web research at 25 searches a day).
- Price tracking per model if you have prices, so spend can be shown in money.
- Alert before the cap, not after.

## Latency

- **Stream** text so users see progress immediately.
- Keep prompts small and **cache** stable prefixes.
- Run independent work in parallel.
- Show what is happening (typing dots, step labels, Crew chat) so waiting feels purposeful.

## Observability

Log every model call (agent, model, tokens, cost, time), every tool call (name, arguments summary, result status), every approval and decision, and every task outcome. deck keeps usage, task and message logs in the encrypted workspace and shows them in Crew chat and the Command center. In a customer deployment you will also want traces exported to their monitoring tools, with personal data removed.

## Data protection

- **Encrypt at rest.** deck uses SQLCipher for the workspace and the OS keychain for keys.
- **Know what leaves.** Document every outbound flow (deck's manual chapter 10 has a table). Customers will ask.
- **Redact** secrets and personal data before sending text to third parties.
- **Back up** with encryption and test restores. A backup you have never restored is a hope, not a backup.
- **Retention**: decide how long logs and conversations are kept and make deletion real.

## Packaging and distribution

Desktop agents need a runtime. deck ships a Tauri shell (Rust) with a bundled Node engine as a sidecar, communicating over JSON lines on stdio. Lessons from building it:

- Prune bundles hard (deck went from about 900 MB to about 230 MB).
- Sign and notarize for each OS, or users fight security warnings.
- Strip file attributes before signing on macOS.
- Provide one-click installers with readable logs and plain error messages.
- Version everything, keep a changelog, and make updates keep user data.

Server deployments raise different questions: tenancy, scaling, secrets management, network policy and regional data residency.

## Operating over time

- **Models change.** Providers update and retire models. Pin versions where possible and re-run evals when switching.
- **Prompts drift** as features are added. Keep them in version control, reviewed like code.
- **Health checks.** deck's setup health grades the configuration and warns on regressions; production systems need the same for keys, quotas, connectors and job failures.
- **Incident response.** Have a kill switch, know how to rotate keys, and keep enough logs to reconstruct what an agent did.

## Lab

**Goal:** inspect the production machinery.

1. Read the router in `packages/models/src/roles.ts`. Write a test where the first model throws a retryable error and the fallback succeeds.
2. Read `scripts/package-engine.mjs`. List what it removes from the bundle and why.
3. Make a backup in Settings > Backups, then restore it on a test machine or a fresh user account. Time how long it takes.
4. Open the Command center and the setup health card. Fix every failing check you can.
5. Write a one-page runbook for "the model provider is down": what users see, what deck does automatically, and what you would do.

## Quiz

```quiz
Q: When should a model call be retried on a fallback model?
- [ ] On every error
- [x] On transient errors such as rate limits or outages, not on permanent ones like a rejected key
- [ ] Never
- [ ] Only when the user asks
> Retrying permanent errors wastes time and hides the real problem.
```

```quiz
Q: What is the honest status of a backup that has never been restored?
- [ ] Proven safe
- [x] Unverified until a restore has been tested
- [ ] Unnecessary
- [ ] Encrypted, so it must work
> Test restores. Many backup failures are only discovered at restore time.
```

```quiz
Q: Why log every model and tool call?
- [ ] Providers require it
- [x] To debug, measure cost and quality, and reconstruct what an agent did in an incident
- [ ] To train the model
- [ ] To slow the agent down
> Without records you cannot improve, audit or explain an agent's behaviour.
```

## Key takeaways

- Route by step, fail over on transient errors, and abstract providers.
- Budget steps, retries and tokens; stream and cache for speed.
- Log everything that matters, encrypt at rest, know what leaves, test restores.
- Plan for model changes, prompt drift and incidents.
