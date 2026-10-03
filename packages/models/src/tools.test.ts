import { describe, expect, it, vi } from "vitest";
import { makeChatModel, type ChatRequest, type ProviderId } from "./index.js";

const tools = [{ name: "issues_create", description: "Create an issue", parameters: { type: "object" as const, properties: { title: { type: "string" } }, required: ["title"] } }];
const convo: ChatRequest = {
  system: [{ type: "text", text: "rules" }],
  tools,
  maxTokens: 100,
  messages: [
    { role: "user", content: "Make an issue for the Acme follow-up" },
    { role: "assistant", content: [{ type: "text", text: "Creating it." }, { type: "tool_call", id: "c1", name: "issues_create", input: { title: "Acme follow-up" }, meta: { functionCall: { name: "issues_create", args: { title: "Acme follow-up" } }, thoughtSignature: "sig-123" } }] },
    { role: "user", content: [{ type: "tool_result", id: "c1", name: "issues_create", content: "Created VP-1" }] },
  ],
};
const capture = (body: unknown) => {
  const calls: RequestInit[] = [];
  const f = vi.fn(async (_u: unknown, init?: RequestInit) => (calls.push(init!), new Response(JSON.stringify(body))));
  return { f: f as unknown as typeof fetch, sent: () => JSON.parse(calls[0]!.body as string) };
};
const run = async (provider: ProviderId, reply: unknown) => {
  const c = capture(reply);
  const res = await makeChatModel({ provider, model: "m" }, async () => "k", c.f).chat(convo);
  return { res, body: c.sent() };
};

describe("tool calling on every provider", () => {
  it("Anthropic: tools, tool_use and tool_result blocks", async () => {
    const { res, body } = await run("anthropic", { model: "m", stop_reason: "tool_use", content: [{ type: "tool_use", id: "c2", name: "issues_create", input: { title: "Second" } }], usage: { input_tokens: 1, output_tokens: 1 } });
    expect(body.tools[0]).toEqual({ name: "issues_create", description: "Create an issue", input_schema: tools[0]!.parameters });
    expect(body.messages[1].content[1]).toEqual({ type: "tool_use", id: "c1", name: "issues_create", input: { title: "Acme follow-up" } });
    expect(body.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "c1", content: "Created VP-1" });
    expect(res.toolCalls).toEqual([{ type: "tool_call", id: "c2", name: "issues_create", input: { title: "Second" } }]);
  });

  it("OpenAI: function tools, tool_calls and role tool results", async () => {
    const { res, body } = await run("openai", { choices: [{ message: { content: null, tool_calls: [{ id: "c2", function: { name: "issues_create", arguments: '{"title":"Second"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "issues_create", description: "Create an issue", parameters: tools[0]!.parameters } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[2].tool_calls[0]).toEqual({ id: "c1", type: "function", function: { name: "issues_create", arguments: '{"title":"Acme follow-up"}' } });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "Created VP-1" });
    expect(res.toolCalls).toEqual([{ type: "tool_call", id: "c2", name: "issues_create", input: { title: "Second" } }]);
  });

  it("OpenAI: arguments that are not valid JSON are kept, not thrown", async () => {
    const { res } = await run("openai", { choices: [{ message: { content: null, tool_calls: [{ id: "c", function: { name: "issues_create", arguments: "{oops" } }] }, finish_reason: "tool_calls" }] });
    expect(res.toolCalls![0]!.input).toEqual({ _unparsed: "{oops" });
  });

  it("Gemini: functionDeclarations, replays thought signatures, functionResponse", async () => {
    const { res, body } = await run("gemini", { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { functionCall: { name: "issues_create", args: { title: "Second" } }, thoughtSignature: "sig-456" }] }, finishReason: "STOP" }] });
    expect(body.tools[0].functionDeclarations[0].name).toBe("issues_create");
    expect(body.contents[1].parts[1]).toEqual({ functionCall: { name: "issues_create", args: { title: "Acme follow-up" } }, thoughtSignature: "sig-123" });
    expect(body.contents[2].parts[0]).toEqual({ functionResponse: { name: "issues_create", response: { result: "Created VP-1" } } });
    expect(res.text).toBe("");
    expect(res.toolCalls![0]).toMatchObject({ name: "issues_create", input: { title: "Second" }, meta: { thoughtSignature: "sig-456" } });
  });
});

describe("images on every provider", () => {
  const img = { type: "image" as const, mediaType: "image/jpeg" as const, data: "QUJD" };
  const req = { maxTokens: 10, messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "What is on this whiteboard?" }, img] }] };
  const send = async (provider: ProviderId, reply: unknown) => {
    const c = capture(reply);
    await makeChatModel({ provider, model: "m" }, async () => "k", c.f).chat(req);
    return c.sent();
  };
  it("maps a snapshot to each provider's image format", async () => {
    const a = await send("anthropic", { model: "m", stop_reason: "end_turn", content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    expect(a.messages[0].content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    const o = await send("openai", { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    expect(o.messages[0].content).toEqual([{ type: "text", text: "What is on this whiteboard?" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }]);
    const g = await send("gemini", { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    expect(g.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
  });
});
