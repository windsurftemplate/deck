import { describe, expect, it, vi } from "vitest";
import { AnthropicDirect, checkKeyShape } from "./index.js";

const fakeAnthropic = "sk-ant-" + "api03-" + "x".repeat(40);

describe("developer keys", () => {
  it("catches keys pasted in the wrong place", () => {
    expect(checkKeyShape("anthropic", fakeAnthropic)).toBeNull();
    expect(checkKeyShape("openai", fakeAnthropic)).toMatch(/Anthropic key/);
    expect(checkKeyShape("anthropic", "")).toMatch(/Paste/);
    expect(checkKeyShape("anthropic", "sk-ant-abc def")).toMatch(/spaces/);
    expect(checkKeyShape("gemini", "nope")).toMatch(/does not look like/);
  });

  it("reads the key at call time and sends it only as x-api-key", async () => {
    const getKey = vi.fn(async () => fakeAnthropic);
    const f = vi.fn(async () => new Response(JSON.stringify({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } })));
    const m = new AnthropicDirect("claude-x", getKey, { fetch: f as unknown as typeof fetch });
    expect(getKey).not.toHaveBeenCalled();
    const res = await m.chat({ maxTokens: 5, messages: [{ role: "user", content: "hi" }] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(fakeAnthropic);
    expect(init.body as string).not.toContain(fakeAnthropic);
    expect(res.text).toBe("ok");
  });

  it("explains a rejected key without retrying", async () => {
    const m = new AnthropicDirect("claude-x", async () => fakeAnthropic, { fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch });
    await expect(m.chat({ maxTokens: 1, messages: [] })).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/Settings > Models/) });
  });
});

describe("OpenAI embeddings", () => {
  it("asks for the set size and returns unit vectors in input order", async () => {
    const { OpenAIEmbedder } = await import("./index.js");
    let sent: Record<string, unknown> = {};
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }] }));
    });
    const e = new OpenAIEmbedder(async () => "k", 2, "text-embedding-3-small", f as unknown as typeof fetch);
    const [a, b] = await e.embed(["first", "second"]);
    expect(sent).toMatchObject({ dimensions: 2, input: ["first", "second"] });
    expect(Array.from(a!)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(Array.from(b!)).toEqual([0, 1]);
  });
});
