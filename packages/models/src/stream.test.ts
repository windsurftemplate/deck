import { describe, expect, it } from "vitest";
import { makeChatModel, type ProviderId } from "./index.js";

const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const run = async (provider: ProviderId, events: unknown[]) => {
  let sentBody: Record<string, unknown> = {};
  let url = "";
  const f = (async (u: string, init?: RequestInit) => ((url = u), (sentBody = JSON.parse(init!.body as string)), sse(events))) as unknown as typeof fetch;
  const deltas: string[] = [];
  const res = await makeChatModel({ provider, model: "m" }, async () => "k", f).chat({ maxTokens: 10, messages: [{ role: "user", content: "hi" }] }, undefined, (d) => deltas.push(d));
  return { res, deltas, sentBody, url };
};

describe("streaming replies", () => {
  it("Claude: text as it arrives, tool input assembled from pieces", async () => {
    const { res, deltas, sentBody } = await run("anthropic", [
      { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "issues_create" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"title":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Acme"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    ]);
    expect(sentBody.stream).toBe(true);
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(res).toMatchObject({ text: "Hello", stopReason: "tool_use", toolCalls: [{ id: "t1", name: "issues_create", input: { title: "Acme" } }], usage: { inputTokens: 12, outputTokens: 9 } });
  });

  it("OpenAI: content deltas and tool calls split across chunks", async () => {
    const { res, deltas } = await run("openai", [
      { choices: [{ delta: { content: "Hi " } }] },
      { choices: [{ delta: { content: "there" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "issues_", arguments: '{"ti' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "create", arguments: 'tle":"X"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
    ]);
    expect(deltas).toEqual(["Hi ", "there"]);
    expect(res).toMatchObject({ text: "Hi there", toolCalls: [{ id: "c1", name: "issues_create", input: { title: "X" } }], usage: { inputTokens: 5, outputTokens: 3 } });
  });

  it("Gemini: streamGenerateContent with thought parts hidden", async () => {
    const { res, deltas, url } = await run("gemini", [{ candidates: [{ content: { parts: [{ text: "thinking", thought: true }] } }] }, { candidates: [{ content: { parts: [{ text: "Ans" }] } }] }, { candidates: [{ content: { parts: [{ text: "wer." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }]);
    expect(url).toMatch(/:streamGenerateContent\?alt=sse$/);
    expect(deltas).toEqual(["Ans", "wer."]);
    expect(res).toMatchObject({ text: "Answer.", stopReason: "STOP", usage: { inputTokens: 4, outputTokens: 2 } });
  });
});

describe("ollama (local)", () => {
  it("talks OpenAI format to the local server without a key, and lists pulled models", async () => {
    const calls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push(`${u} ${String((init?.headers as Record<string, string> | undefined)?.authorization ?? "")}`);
      if (u.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { name: "llama3.2:latest" }] }));
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    }) as unknown as typeof fetch;
    const { makeChatModel, listModels } = await import("./index.js");
    const r = await makeChatModel({ provider: "ollama", model: "llama3.2" }, async () => "", f, { ollamaUrl: "http://localhost:11434/" }).chat({ maxTokens: 5, messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("hi");
    expect(calls[0]).toBe("http://localhost:11434/v1/chat/completions Bearer ollama");
    expect(await listModels("ollama", "", f)).toEqual(["llama3.2:latest", "qwen2.5:7b"]);
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(listModels("ollama", "", down)).rejects.toThrow(/ollama serve/);
  });
});

describe("built-in reasoning", () => {
  it("Anthropic: turns on thinking with a budget, returns a summary, and replays thinking before tool calls", async () => {
    const { anthropicBody, anthropicResponse } = await import("./index.js");
    const b = anthropicBody("claude-x", { maxTokens: 1000, temperature: 0.2, reasoning: "medium", messages: [{ role: "user", content: "hi" }] }) as Record<string, unknown>;
    expect(b.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(b.max_tokens).toBe(5096);
    expect(b.temperature).toBeUndefined(); // thinking requires the default temperature
    const r = anthropicResponse({ model: "claude-x", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "thinking", thinking: "Check memory first.", signature: "sig" }, { type: "tool_use", id: "t1", name: "memory_search", input: { q: "acme" } }] });
    expect(r.thinking).toBe("Check memory first.");
    const next = anthropicBody("claude-x", { maxTokens: 500, reasoning: "medium", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: r.toolCalls! }, { role: "user", content: [{ type: "tool_result", id: "t1", name: "memory_search", content: "Dana is CISO" }] }] }) as { messages: { content: { type: string }[] }[] };
    expect(next.messages[1]!.content.map((c) => c.type)).toEqual(["thinking", "tool_use"]);
    const plain = anthropicBody("claude-x", { maxTokens: 100, temperature: 0, messages: [{ role: "user", content: "hi" }] }) as Record<string, unknown>;
    expect(plain.thinking).toBeUndefined();
    expect(plain.temperature).toBe(0);
  });
  it("OpenAI only sends reasoning effort to reasoning models; Gemini asks for thoughts and returns them separately", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (u.includes("generativelanguage")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Plan: look up Acme.", thought: true }, { text: "Done." }] }, finishReason: "STOP" }], usageMetadata: {} }));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }) as unknown as typeof fetch;
    const { makeChatModel } = await import("./index.js");
    const key = async () => "k";
    await makeChatModel({ provider: "openai", model: "o4-mini" }, key, f).chat({ maxTokens: 100, temperature: 0, reasoning: "high", messages: [{ role: "user", content: "x" }] });
    await makeChatModel({ provider: "openai", model: "gpt-4.1" }, key, f).chat({ maxTokens: 100, temperature: 0, reasoning: "high", messages: [{ role: "user", content: "x" }] });
    expect(bodies[0]!.reasoning_effort).toBe("high");
    expect(bodies[0]!.temperature).toBeUndefined();
    expect(bodies[1]!.reasoning_effort).toBeUndefined();
    expect(bodies[1]!.temperature).toBe(0);
    const g = await makeChatModel({ provider: "gemini", model: "gemini-2.5-pro" }, key, f).chat({ maxTokens: 100, reasoning: "low", messages: [{ role: "user", content: "x" }] });
    expect((bodies[2]!.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingBudget: 1024, includeThoughts: true });
    expect(g.text).toBe("Done.");
    expect(g.thinking).toBe("Plan: look up Acme.");
  });
});
