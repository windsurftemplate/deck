# 4. Tools and function calling

**You will learn:** how models call tools, how the formats differ across providers, how to design tools that models use well, streaming with tools, and the Model Context Protocol.

## How a tool call works

A model cannot run code or reach the network. Instead, the harness tells the model which tools exist, and the model can reply with a **request** to call one. The harness runs it and sends the result back. The cycle:

1. The harness sends the conversation plus **tool definitions**: a name, a description, and a JSON Schema for the arguments.
2. The model replies with text, a tool call (name and arguments), or both.
3. The harness checks the call, runs the tool, and adds a **tool result** message.
4. The model continues, possibly calling more tools, until it replies without any.

The model only ever proposes. The harness decides whether anything actually happens. That separation is where all safety enforcement lives.

## The same idea, three formats

| | Anthropic (Claude) | OpenAI | Google (Gemini) |
|---|---|---|---|
| Tool definitions | `tools: [{ name, description, input_schema }]` | `tools: [{ type: "function", function: { name, description, parameters } }]` | `tools: [{ functionDeclarations: [...] }]` |
| A call in the reply | Content block `{ type: "tool_use", id, name, input }` | `message.tool_calls: [{ id, function: { name, arguments } }]` (arguments as a JSON string) | Part `{ functionCall: { name, args } }` |
| Sending the result | User message with `{ type: "tool_result", tool_use_id, content }` | Message with `role: "tool"` and `tool_call_id` | Part `{ functionResponse: { name, response } }` |
| Stop reason | `tool_use` | `tool_calls` | parts contain function calls |

deck hides these differences behind one interface (`ChatModel.chat`) with provider adapters in `packages/models/src/direct.ts` and `providers.ts`. Your agent code never sees the provider's format. This is a pattern worth copying: it lets you switch providers, add fallbacks and test with fakes.

Provider details worth knowing:

- OpenAI returns arguments as a **string** that you must parse, and can return several calls at once.
- Gemini may return a hidden **thought signature** with function calls that must be sent back unchanged in the next request. deck keeps it in a `meta` field and replays it.
- Every provider can return malformed arguments occasionally. Parse defensively.

## Designing tools models use well

Tool design is interface design for a reader that is fast, literal and occasionally careless.

- **Name tools by intent:** `issues_create`, not `post_v2`.
- **Write descriptions for the model:** when to use it, when not to, and what it returns.
- **Keep arguments few and typed.** Use enums for fixed choices. Mark required fields.
- **Return compact, useful results.** Not raw API dumps. Include ids the model may need next.
- **Return errors as text the model can act on:** "No issue VP-99. Open issues: VP-12, VP-14."
- **Make tools safe to retry** where possible, and use idempotency keys for anything external, so a retry never sends twice (deck's `Idempotent` in `packages/gate`).
- **Fewer, sharper tools beat many overlapping ones.** Overlap causes wrong choices.

## Tool kinds and the action gate

deck attaches metadata to every tool that the model never sees:

- **scope**, such as `issues.write`, matched against the agent's allowed scopes;
- **kind**: read, write or external, which decides whether approval is needed.

Before a tool runs, `runAgent` checks scope and kind, honors the owner's tool modes, checks for the tripwire, and either runs it, asks for approval, or refuses. Results pass through the secret scanner before going back to the model.

## Streaming with tools

Streaming sends output as it is generated, so users see text immediately. With tools, the stream also carries partial tool calls: Anthropic streams tool input as JSON fragments, OpenAI streams argument fragments by index. The harness must reassemble them before running anything. deck does this in `anthropicStream` and `openaiStream` and shows only text deltas to the user.

## The Model Context Protocol (MCP)

MCP is an open protocol, introduced by Anthropic in late 2024, for connecting AI applications to tools and data. Instead of every app writing custom integrations, a service exposes an **MCP server**, and any MCP **client** (inside a host application) can use it.

- Messages use JSON-RPC 2.0.
- Servers offer **tools** (actions), **resources** (data to read) and **prompts** (templates).
- Transports include stdio (local processes) and Streamable HTTP (remote servers).
- A session starts with an `initialize` handshake where both sides state their capabilities, then the client can list and call tools.

deck's VaultProof check (`packages/connectors`) performs this handshake over Streamable HTTP and lists tools. For a forward deployed engineer, MCP is often the fastest way to connect an agent to a customer's systems (chapter 13). MCP tools still need the same treatment as any tool: scopes, approvals, and result scanning.

## Lab

**Goal:** add a read-only tool to the Chief of Staff.

1. Open `apps/engine/src/engine.ts` and find `toolsFor`. Read how `issues_list` is defined: spec, scope, kind, describe and run.
2. Add a tool `issues_count` that returns how many open issues there are by status. Give it scope `issues.read` and kind `read`.
3. Write an engine test that calls it directly through `toolsFor("chief-of-staff")`.
4. Run the tests:
   ```
   pnpm --filter @deck/engine test
   ```
5. Read `packages/models/src/tools.test.ts`. Find how one request is mapped to each provider's format, and explain in two sentences why the tests use stand-in servers instead of real APIs.

## Quiz

```quiz
Q: Who actually executes a tool call?
- [ ] The model, on the provider's servers
- [x] The harness, after deciding whether the call is allowed
- [ ] The user's browser
- [ ] The tool runs itself when named
> The model only proposes a call. The harness checks permissions and runs it, which is why safety can be enforced in code.
```

```quiz
Q: OpenAI returns tool arguments in what form?
- [ ] A parsed object
- [x] A JSON string that the harness must parse
- [ ] XML
- [ ] Positional arguments
> OpenAI's function arguments arrive as a string. Parse it defensively, since it can occasionally be malformed.
```

```quiz
Q: Which tool design is best for a model?
- [ ] One `do_anything` tool with a free-text argument
- [ ] Twenty overlapping tools with similar names
- [x] A few tools named by intent, with typed arguments, clear descriptions and compact results
- [ ] Tools that return the full raw API response
> Clear, focused tools reduce wrong choices and wasted tokens.
```

```quiz
Q: What does MCP standardize?
- [ ] Model training
- [x] How AI applications connect to tools and data, using JSON-RPC between clients and servers
- [ ] Token pricing
- [ ] The user interface of chat apps
> MCP lets one server work with many AI applications, replacing one-off integrations.
```

## Key takeaways

- Models propose tool calls; harnesses decide and execute.
- Hide provider formats behind one interface.
- Design tools like APIs for a literal reader: intent names, typed arguments, compact results, actionable errors.
- MCP is the common way to connect agents to systems, and its tools need the same guardrails.
