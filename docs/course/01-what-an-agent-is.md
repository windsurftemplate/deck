# 1. What an AI agent is

**You will learn:** what separates an agent from a chatbot, the parts every agent has, when to use an agent at all, and how deck maps onto those parts.

## From chatbot to agent

A chatbot takes text in and gives text out. One turn, no actions. An **agent** is a model placed inside a loop where it can take actions, see their results, and decide what to do next until a goal is met.

A useful one-line definition: **agent = model + harness**. The model does the reasoning and writing. The harness is everything around it: the instructions, the tools, the memory, the loop, the limits, the checks and the safety rails. Most of the engineering work in a real agent product is in the harness, not the model.

## The parts every agent has

| Part | Question it answers | In deck |
|---|---|---|
| **Model** | Who thinks? | Claude, GPT or Gemini through `packages/models` |
| **Instructions** | What is my role and what are the rules? | Role files plus locked core rules, assembled in `packages/agents/src/prompt-builder.ts` |
| **Context** | What do I know right now? | Recalled memory, chat history, task brief |
| **Tools** | What can I do? | Issues, memory, drafts, delegation, web research |
| **Loop** | How do I keep going until done? | `runAgent` in `packages/agents/src/act.ts` |
| **Memory** | What do I remember between runs? | Encrypted SQLite in `packages/memory` |
| **Guardrails** | What must never happen? | Action gate, approvals, secret scanner, tripwire |
| **Evaluation** | How do we know it worked? | Verifier, safety evals, practice scores |

## Workflows versus agents

Not everything should be an agent. A well-known way to think about it (from Anthropic's "Building effective agents"):

- A **workflow** follows a path you wrote in code. The model fills in steps, but you decide the order. Examples: prompt chaining (step A then B), routing (classify, then send to the right handler), parallelization, an orchestrator handing work to workers, an evaluator checking a generator's output.
- An **agent** decides its own path: which tool to call next, when to stop.

Workflows are more predictable, cheaper and easier to test. Agents handle open-ended problems where you cannot write the path in advance. Start with the simplest thing that works and add autonomy only where it pays for itself.

deck uses both. A **workflow** (Automations, Workflows tab) is a fixed sequence of steps you wrote. The Chief of Staff answering you is an **agent**: it decides whether to search memory, create an issue or delegate.

## The autonomy dial

Autonomy is not on or off. It is a dial with several settings:

1. Suggests only: the model drafts, a person does everything.
2. Acts on reversible, internal things (create an issue), asks for anything else.
3. Acts on most things, asks for anything external or irreversible.
4. Acts on everything inside a budget and reports after.

deck's presets set this dial for writes, but external actions always require approval. Choosing the dial position for each kind of action is one of the most important design decisions in any agent product, and a frequent topic in customer conversations.

## Why agents fail

Agents fail in recognizable ways. You will meet each later in the course:

- **Wrong context**: the model did not have the fact it needed (chapter 3, chapter 6).
- **Bad tool design**: unclear tool names or arguments lead to wrong calls (chapter 4).
- **Runaway loops**: the agent keeps calling tools without converging (chapter 5).
- **Unchecked work**: it says "done" when it is not (chapter 5, chapter 10).
- **Injected instructions**: text from outside steers it (chapter 9).
- **Cost and latency**: too many steps, too big a model (chapter 11).

## Lab

**Goal:** find each part of the agent in deck's code.

1. Open the repository and run the tests for the agents package:
   ```
   pnpm --filter @deck/agents test
   ```
2. Open `packages/agents/src/act.ts` and find `runAgent`. Identify: where the model is called, where tool calls are read from the response, where each call passes the action gate, and where the loop stops.
3. Open `packages/agents/chief-of-staff/prompt.md` and `packages/agents/chief-of-staff/tools.json`. Note which scopes are allowed and which require approval.
4. In the app, send a message that needs a tool ("create an issue to call Sam tomorrow"), then open Crew chat and match each line to the parts table above.
5. Write down, in one paragraph, which parts of deck are workflow and which are agent.

## Quiz

```quiz
Q: In "agent = model + harness", what is the harness?
- [ ] The model's weights after fine-tuning
- [x] Everything around the model: instructions, tools, memory, loop, limits, checks and safety rails
- [ ] The user interface only
- [ ] The API key and billing account
> The model reasons and writes; the harness turns that into dependable action. Most product engineering lives in the harness.
```

```quiz
Q: A task always follows the same three steps in the same order. What should you build first?
- [ ] A fully autonomous agent
- [x] A workflow that runs the three steps in code
- [ ] A swarm of agents that vote
- [ ] Nothing; models cannot do multi-step work
> When you can write the path down, a workflow is cheaper, more predictable and easier to test. Add autonomy only where the path cannot be known in advance.
```

```quiz
Q: In deck, which action needs approval on every preset, including Autonomous?
- [ ] Searching memory
- [ ] Creating an issue
- [x] Anything that leaves your machine, such as sending an email
- [ ] Writing a draft
> External actions always need approval. That rule is locked in code, so no setting, pack or prompt can change it.
```

```quiz
Q: An agent keeps saying "done" when parts of the task are missing. Which part of the harness addresses this most directly?
- [ ] A bigger model
- [ ] More tools
- [x] An evaluation step, such as a verifier checking the work against done-when criteria
- [ ] A longer system prompt
> Checking work against explicit criteria catches false completion. Bigger models fail less often but still fail; checks catch it when they do.
```

## Key takeaways

- An agent is a model in a loop with tools, memory and limits.
- Prefer workflows when the path is known; use agents where it is not.
- Autonomy is a dial per action type, and choosing it well is core product work.
- Most failures come from context, tools, loops, unchecked work, injection, or cost.
