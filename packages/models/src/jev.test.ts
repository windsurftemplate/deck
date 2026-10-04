import { describe, expect, it } from "vitest";
import { JevClient, choiceOf, noulOf } from "./index.js";

describe("Jev client", () => {
  it("posts state and questions to /v1/systemone with the key, and reads typed answers", async () => {
    const seen: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init!.headers as Record<string, string>).authorization!, body: JSON.parse(String(init!.body)) });
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.95 }, team: { type: "choice", choice: "billing", probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 } }, usage: { input_tokens: 300, output_tokens: 20 } }));
    }) as unknown as typeof fetch;
    const j = new JevClient({ getKey: async () => "k-123", fetch: f });
    const r = await j.ask("Payouts failing for 3 days", { urgent: { type: "noul", instructions: "Urgent?" }, team: { type: "choice", instructions: "Which team?", criteria: { billing: null, technical: null } } });
    expect(seen[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen[0]!.auth).toBe("Bearer k-123");
    expect(seen[0]!.body).toMatchObject({ model: "jev-latest", state: "Payouts failing for 3 days" });
    expect(noulOf(r, "urgent")).toBe(0.95);
    expect(choiceOf(r, "team")).toEqual({ choice: "billing", confidence: 0.81 });
    expect(noulOf(r, "team")).toBeNull();
  });
  it("retries when rate limited, and explains errors plainly", async () => {
    let n = 0;
    const busy = (async () => (++n < 2 ? new Response("", { status: 429 }) : new Response(JSON.stringify({ model: "m", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } })))) as unknown as typeof fetch;
    await new JevClient({ getKey: async () => "k", fetch: busy }).ask("s", { q: { type: "noul", instructions: "?" } });
    expect(n).toBe(2);
    const bad = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    await expect(new JevClient({ getKey: async () => "k", fetch: bad }).ask("s", { q: { type: "noul", instructions: "?" } })).rejects.toThrow(/rejected the API key/);
    const custom = (async (url: string) => (expect(url).toBe("https://jev.example.com/v1/systemone"), new Response(JSON.stringify({ model: "m", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } })))) as unknown as typeof fetch;
    await new JevClient({ getKey: async () => "k", fetch: custom, baseUrl: "https://jev.example.com/v1/systemone" }).ask("s", { q: { type: "noul", instructions: "?" } });
  });
});
