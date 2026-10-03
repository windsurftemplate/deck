import { describe, expect, it, vi } from "vitest";
import { checkVaultProof } from "./index.js";

const URL_ = "https://mcp.vaultproof.dev/mcp";
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("VaultProof MCP check", () => {
  it("is off until enabled", async () => {
    expect((await checkVaultProof({ enabled: false, url: URL_ })).state).toBe("off");
    expect((await checkVaultProof({ enabled: true, url: "" })).state).toBe("off");
  });

  it("handshakes, keeps the session id, and lists tools (JSON and SSE replies)", async () => {
    const seen: Record<string, string>[] = [];
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const h = init!.headers as Record<string, string>;
      seen.push(h);
      const body = JSON.parse(init!.body as string);
      if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "VaultProof MCP" } } }), { headers: { "content-type": "application/json", "mcp-session-id": "s-1" } });
      if (body.method === "tools/list") return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "issue_token" }, { name: "list_projects" }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      return new Response(null, { status: 202 });
    });
    const s = await checkVaultProof({ enabled: true, url: URL_, fetch: f as unknown as typeof fetch });
    expect(s).toEqual({ state: "connected", message: "Connected to VaultProof MCP. 2 tools available.", serverName: "VaultProof MCP", tools: ["issue_token", "list_projects"] });
    expect(seen[2]!["mcp-session-id"]).toBe("s-1");
  });

  it("reports sign-in needed, not live yet, and unreachable", async () => {
    const f = (r: () => Response | Promise<Response>) => vi.fn(r) as unknown as typeof fetch;
    expect((await checkVaultProof({ enabled: true, url: URL_, fetch: f(() => new Response("", { status: 401 })) })).state).toBe("needs_signin");
    expect((await checkVaultProof({ enabled: true, url: URL_, fetch: f(() => new Response("", { status: 404 })) })).state).toBe("unreachable");
    expect((await checkVaultProof({ enabled: true, url: URL_, fetch: f(() => Promise.reject(new TypeError("fetch failed"))) })).state).toBe("unreachable");
    expect((await checkVaultProof({ enabled: true, url: URL_, fetch: f(() => json({ jsonrpc: "2.0", id: 1, error: { message: "bad version" } })) })).message).toMatch(/bad version/);
  });
});

describe("VaultProof startup probe", () => {
  it("never blocks boot", async () => {
    const { vaultProofProbe } = await import("./index.js");
    const off = await vaultProofProbe(async () => ({ enabled: false, url: "" }))();
    const down = await vaultProofProbe(async () => ({ enabled: true, url: URL_, fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch }))();
    expect(off.status).toBe("off");
    expect(down).toMatchObject({ status: "degraded", fix: expect.stringMatching(/Settings > VaultProof/) });
  });
});
