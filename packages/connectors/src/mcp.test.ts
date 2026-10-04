import { describe, expect, it } from "vitest";
import { McpHttpClient } from "./index.js";

describe("MCP client", () => {
  it("initializes, keeps the session, lists and calls tools over JSON and event streams", async () => {
    const seen: { method: string; session: string | null; auth: string | null }[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(init!.body as string);
      const h = init!.headers as Record<string, string>;
      seen.push({ method: b.method, session: h["mcp-session-id"] ?? null, auth: h.authorization ?? null });
      if (b.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: {} }), { headers: { "content-type": "application/json", "mcp-session-id": "s-9" } });
      if (b.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (b.method === "tools/list") return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "search_issues", annotations: { readOnlyHint: true } }, { name: "create_issue" }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: "Found 2 issues" }] } }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = new McpHttpClient("https://mcp.example.com/mcp", { fetch: f, token: "t" });
    expect((await c.listTools()).map((t) => t.name)).toEqual(["search_issues", "create_issue"]);
    expect(await c.callTool("search_issues", { q: "sso" })).toEqual({ text: "Found 2 issues", isError: false });
    expect(seen.map((x) => x.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(seen[2]!.session).toBe("s-9");
    expect(seen[3]!.auth).toBe("Bearer t");
  });
  it("explains refusals and errors plainly", async () => {
    const no = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    await expect(new McpHttpClient("https://x/mcp", { fetch: no }).listTools()).rejects.toThrow(/sign-in or token/);
    const err = (async (_u: string, init?: RequestInit) => new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(init!.body as string).id, error: { message: "bad" } }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(new McpHttpClient("https://x/mcp", { fetch: err }).listTools()).rejects.toThrow(/Plugin error: bad/);
  });
});
