import { describe, expect, it, vi } from "vitest";
import { GatewayClaude, ModelError, ModelRouter, SpendCapError, assertScopedToken, type ChatModel, type Fetch } from "./index.js";

const TOKEN = "vp-proj-test0123456789abcdef"; // gitleaks:allow (fake test token)
const okBody = { model: "claude-x", stop_reason: "end_turn", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 } };
const mockFetch = (status = 200, body: unknown = okBody) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as Fetch & ReturnType<typeof vi.fn>;

const fake = (id: string, behavior: "ok" | "overloaded" | "bad"): ChatModel => ({
  id,
  chat: async () => {
    if (behavior === "overloaded") throw new ModelError("overloaded", 529, true);
    if (behavior === "bad") throw new ModelError("bad request", 400, false);
    return { text: id, model: id, stopReason: "end_turn", usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
});
const price = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

describe("ModelRouter", () => {
  it("falls back down the chain on retryable errors", async () => {
    const r = new ModelRouter({ roles: { heavy: ["a", "b"] }, models: { a: fake("a", "overloaded"), b: fake("b", "ok") }, prices: { a: price, b: price }, caps: { total: 10 } });
    const res = await r.chat("heavy", "gtm", { maxTokens: 1, messages: [] });
    expect(res.text).toBe("b");
    expect(res.attempts.map((a) => a.model)).toEqual(["a", "b"]);
    expect(res.costUsd).toBeCloseTo(1);
  });

  it("does not fall back on a bad request", async () => {
    const r = new ModelRouter({ roles: { heavy: ["a", "b"] }, models: { a: fake("a", "bad"), b: fake("b", "ok") }, prices: { a: price, b: price }, caps: { total: 10 } });
    await expect(r.chat("heavy", "gtm", { maxTokens: 1, messages: [] })).rejects.toThrow(/bad request/);
  });

  it("enforces total and per-agent daily caps, and resets the next day", async () => {
    let now = new Date("2026-10-02T10:00:00Z");
    const r = new ModelRouter({ roles: { cheap: ["b"] }, models: { b: fake("b", "ok") }, prices: { b: price }, caps: { total: 3, perAgent: { ops: 1 } }, clock: () => now });
    await r.chat("cheap", "ops", { maxTokens: 1, messages: [] });
    await expect(r.chat("cheap", "ops", { maxTokens: 1, messages: [] })).rejects.toBeInstanceOf(SpendCapError);
    await r.chat("cheap", "gtm", { maxTokens: 1, messages: [] });
    await r.chat("cheap", "gtm", { maxTokens: 1, messages: [] });
    await expect(r.chat("cheap", "gtm", { maxTokens: 1, messages: [] })).rejects.toThrow(/power budget/);
    now = new Date("2026-10-03T10:00:00Z");
    await expect(r.chat("cheap", "ops", { maxTokens: 1, messages: [] })).resolves.toBeTruthy();
  });

  it("refuses an unpriced model unless a token cap is set, then caps by tokens", async () => {
    expect(() => new ModelRouter({ roles: { heavy: ["a"] }, models: { a: fake("a", "ok") }, prices: {}, caps: { total: 1 } })).toThrow(/no price/);
    const r = new ModelRouter({ roles: { heavy: ["a"] }, models: { a: fake("a", "ok") }, prices: {}, caps: { tokens: 1_500_000 } });
    expect((await r.chat("heavy", "cos", { maxTokens: 1, messages: [] })).costUsd).toBeNull();
    await r.chat("heavy", "cos", { maxTokens: 1, messages: [] });
    await expect(r.chat("heavy", "cos", { maxTokens: 1, messages: [] })).rejects.toThrow(/token budget/);
    expect(r.spend().tokens).toBe(2_000_000);
  });
});
