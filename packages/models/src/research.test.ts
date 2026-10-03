import { describe, expect, it, vi } from "vitest";
import { webResearch } from "./index.js";

const reply = (body: unknown, status = 200) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(init!.body as string) }), new Response(JSON.stringify(body), { status })));
  return { f: f as unknown as typeof fetch, calls };
};

describe("web research on each provider", () => {
  it("Claude: web search tool, text and sources", async () => {
    const r = reply({ content: [{ type: "server_tool_use", name: "web_search" }, { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.example/x", title: "A" }] }, { type: "text", text: "Answer.", citations: [{ url: "https://b.example/y", title: "B" }] }] });
    const out = await webResearch({ provider: "anthropic", model: "m" }, "k", "q", r.f);
    expect(r.calls[0]!.body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
    expect(out).toEqual({ text: "Answer.", sources: [{ url: "https://a.example/x", title: "A" }, { url: "https://b.example/y", title: "B" }], provider: "anthropic" });
  });

  it("OpenAI: Responses API web search with url citations", async () => {
    const r = reply({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "Answer.", annotations: [{ type: "url_citation", url: "https://c.example", title: "C" }] }] }] });
    const out = await webResearch({ provider: "openai", model: "m" }, "k", "q", r.f);
    expect(r.calls[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(r.calls[0]!.body.tools).toEqual([{ type: "web_search" }]);
    expect(out.sources).toEqual([{ url: "https://c.example", title: "C" }]);
  });

  it("Gemini: Google Search grounding", async () => {
    const r = reply({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "Answer." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://d.example", title: "D" } }, { web: { uri: "javascript:alert(1)", title: "bad" } }] } }] });
    const out = await webResearch({ provider: "gemini", model: "m" }, "k", "q", r.f);
    expect(r.calls[0]!.body.tools).toEqual([{ google_search: {} }]);
    expect(out).toEqual({ text: "Answer.", sources: [{ url: "https://d.example", title: "D" }], provider: "gemini" });
  });

  it("explains unsupported providers and bad keys", async () => {
    await expect(webResearch({ provider: "openrouter", model: "m" }, "k", "q")).rejects.toThrow(/needs Claude, OpenAI or Gemini/);
    await expect(webResearch({ provider: "openai", model: "m" }, "k", "q", reply({}, 401).f)).rejects.toThrow(/key was rejected/);
  });
});
