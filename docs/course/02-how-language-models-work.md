# 2. How language models work

**You will learn:** tokens, context windows, how a model produces text, sampling, system prompts, prompt caching, and what all of this means for cost and reliability.

## Next-token prediction

A large language model (LLM) is trained to predict the next piece of text given everything before it. At run time it repeats one step: read the whole input, produce a probability for every possible next token, pick one, append it, and go again. A long reply is thousands of these steps.

This explains several behaviours you will rely on or fight against:

- The model has no hidden memory between requests. **Everything it knows about your situation must be in the input.** That is why agent memory exists.
- It continues patterns. Clear structure in the input (headings, examples, formats) produces clear structure in the output.
- It can be confidently wrong. Fluency is not accuracy.

## Tokens

Models read and write **tokens**, not characters or words. A token is a common chunk of text: a word, part of a word, or punctuation. In English, one token is roughly 4 characters, or about three quarters of a word. Code, other languages and unusual strings use more tokens per character.

Tokens matter because:

- **Providers bill per token**, separately for input and output. Output tokens usually cost several times more than input tokens.
- **Limits are in tokens**: the context window and the maximum reply length.
- **Latency grows with output tokens**, because each one is a separate step.

deck tracks tokens per call in `apps/engine/src/activity.ts` (the usage log) and caps them per day in `packages/models/src/roles.ts`.

## The context window

The context window is the maximum number of tokens the model can consider at once: instructions, conversation, tool results and its own reply. Modern models offer very large windows, but large is not free:

- Cost grows with every token you send.
- Models attend less reliably to details buried in the middle of a long input.
- Irrelevant text can distract the model.

Good agents send the **smallest context that contains what is needed**. That is the core idea of context engineering (chapter 3) and retrieval (chapter 6).

## Sampling and temperature

When picking the next token, the model can take the most likely one or sample from the distribution. **Temperature** controls this: low temperature makes output focused and repeatable, high temperature makes it more varied. For agents that call tools and produce structured output, low temperature is usually right. deck uses a low temperature for verification, learning and planning calls.

Even at temperature 0, outputs are not guaranteed identical across runs. Design for variation: validate outputs, retry on parse errors, and test with several runs.

## Messages and roles

Chat APIs take a list of messages with roles:

- **System**: instructions and context that frame the whole conversation.
- **User**: the person's (or the harness's) input.
- **Assistant**: the model's previous replies, including tool calls.
- **Tool results**: what tools returned, sent back to the model.

The model treats the system prompt with more authority than user content, but this is a learned tendency, not a security boundary. Never rely on the system prompt alone to keep a model from following instructions in untrusted content (chapter 9).

## Prompt caching

When many requests start with the same long prefix (instructions, tool definitions), providers can cache it, so later requests read the prefix at a fraction of the price and faster. To benefit, keep the stable parts first and the changing parts last. deck's prompt builder puts core rules and the role first and the task-specific material after, and the usage log records cached tokens separately.

## Reasoning models

Some models can spend extra tokens thinking before answering. This improves hard reasoning at the cost of latency and tokens. In an agent, reserve it for steps that need it (planning, tricky decisions) and use fast models for routine steps (checking, summarizing). deck's heavy and cheap roles express exactly this split.

## Lab

**Goal:** see tokens, cost and model roles in practice.

1. Open `packages/models/src/types.ts` and read the `Usage` type. Which kinds of tokens are tracked?
2. Open `packages/models/src/roles.ts`. Find where the daily token cap is enforced and where a call falls back to another model.
3. In the app, send three messages of different lengths, then open the Command center. Compare the tokens by agent and by model.
4. Estimate: a 2,000-word document is about how many tokens? (Answer: roughly 2,600 to 2,700.) What would it cost to send it 50 times a day at your provider's input price?
5. Change nothing, but write down where in deck you would lower costs first, and why.

## Quiz

```quiz
Q: Why must an agent harness supply memory to the model?
- [ ] Models forget their training after each request
- [x] The model keeps no state between requests, so anything about your situation must be in the input
- [ ] Memory makes the model's weights larger
- [ ] Providers require it
> Each request is independent. Facts, history and documents only reach the model if the harness puts them in the context.
```

```quiz
Q: Roughly how many characters of English is one token?
- [ ] 1
- [x] About 4
- [ ] About 20
- [ ] Exactly one word
> A rule of thumb for English is about 4 characters, or three quarters of a word, per token. It varies for code and other languages.
```

```quiz
Q: To benefit from prompt caching, how should you order a prompt?
- [ ] Changing parts first, stable parts last
- [x] Stable parts first (rules, role, tool definitions), changing parts last
- [ ] Alphabetically
- [ ] Order does not matter
> Caches match on a shared prefix, so stable content belongs at the start.
```

```quiz
Q: Which statement about the system prompt is true?
- [ ] It is a security boundary that untrusted text cannot cross
- [x] Models give it more weight, but it is not a security boundary
- [ ] It is ignored by modern models
- [ ] It is billed at no cost
> Treat the system prompt as strong guidance, not enforcement. Real enforcement lives in code: permissions, approvals and checks.
```

## Key takeaways

- Models predict tokens one at a time and remember nothing between requests.
- Tokens drive cost, limits and latency. Measure them.
- Send the smallest context that contains what is needed.
- Use low temperature and validation for agent steps; cache stable prefixes; match model strength to the step.
