import { describe, expect, it, vi } from "vitest";
import { GeminiDirect, ModelRouter, OpenAICompatible, listModels, makeChatModel, refId, type ChatRequest } from "./index.js";

const req: ChatRequest = { system: [{ type: "text", text: "rules" }, { type: "text", text: "role", cache: true }], messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "again" }], maxTokens: 50, temperature: 0.2 };
const capture = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url, init: init! }), new Response(JSON.stringify(body), { status })));
  return { f: f as unknown as typeof fetch, calls };
};

describe("OpenAI-compatible", () => {
  it("sends system plus turns, maps usage including cached tokens", async () => {
    const { f, calls } = capture(200, { model: "m-1", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 40 } } });
    const m = new OpenAICompatible("m-1", { provider: "openai", baseUrl: "https://api.openai.com/v1", getKey: async () => "k1", fetch: f });
    const res = await m.chat(req);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k1");
    expect(body.messages.map((x: { role: string }) => x.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[0].content).toBe("rules\n\nrole");
    expect(res).toMatchObject({ text: "ok", usage: { inputTokens: 60, outputTokens: 7, cacheReadTokens: 40 } });
  });

  it("explains a bad key and a missing model; retries only server trouble", async () => {
    const m = (s: number) => new OpenAICompatible("m", { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", getKey: async () => "k", fetch: capture(s, {}).f });
    await expect(m(401).chat(req)).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/key was rejected/) });
    await expect(m(404).chat(req)).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/not found/) });
    await expect(m(503).chat(req)).rejects.toMatchObject({ retryable: true });
  });
});

describe("Gemini", () => {
  it("uses systemInstruction, model role for assistant turns, and maps usage", async () => {
    const { f, calls } = capture(200, { candidates: [{ content: { parts: [{ text: "o" }, { text: "k" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 2 } });
    const res = await new GeminiDirect("gem-x", { getKey: async () => "g1", fetch: f }).chat(req);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(calls[0]!.url).toMatch(/\/models\/gem-x:generateContent$/);
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g1");
    expect(body.systemInstruction.parts[0].text).toBe("rules\n\nrole");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(res).toMatchObject({ text: "ok", stopReason: "STOP", usage: { inputTokens: 30, outputTokens: 2 } });
  });

  it("treats an invalid key reported as 400 as a key problem", async () => {
    const f = (async () => new Response('{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 })) as unknown as typeof fetch;
    await expect(new GeminiDirect("g", { getKey: async () => "x", fetch: f }).chat(req)).rejects.toThrow(/key was rejected/);
  });
});

describe("switching providers", () => {
  it("one factory for every provider", () => {
    for (const provider of ["anthropic", "openai", "gemini", "openrouter"] as const) expect(makeChatModel({ provider, model: "m" }, async () => "k").id).toBe("m");
    expect(refId({ provider: "gemini", model: "g" })).toBe("gemini:g");
  });

  it("falls back across providers when one is down", async () => {
    const down = { id: "a", chat: async () => { throw new (await import("./types.js")).ModelError("down", 503, true); } };
    const { f } = capture(200, { choices: [{ message: { content: "from openai" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const r = new ModelRouter({ roles: { heavy: ["anthropic:a", "openai:b"] }, models: { "anthropic:a": down, "openai:b": makeChatModel({ provider: "openai", model: "b" }, async () => "k", f) }, prices: {}, caps: { tokens: 1000 } });
    const res = await r.chat("heavy", "cos", req);
    expect(res.text).toBe("from openai");
    expect(res.attempts.map((a) => a.model)).toEqual(["anthropic:a", "openai:b"]);
  });

  it("lists only chat models, from the provider itself", async () => {
    const oa = capture(200, { data: [{ id: "gpt-x" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "o-x" }] });
    expect(await listModels("openai", "k", oa.f)).toEqual(["gpt-x", "o-x"]);
    const ge = capture(200, { models: [{ name: "models/gem-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/emb", supportedGenerationMethods: ["embedContent"] }] });
    expect(await listModels("gemini", "k", ge.f)).toEqual(["gem-a"]);
    await expect(listModels("anthropic", "k", capture(401, {}).f)).rejects.toThrow(/rejected/);
  });
});
