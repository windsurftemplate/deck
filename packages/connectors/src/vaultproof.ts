type Fetch = typeof fetch;

export type VaultProofStatus =
  | { state: "off"; message: string }
  | { state: "connected"; message: string; serverName: string; tools: string[] }
  | { state: "needs_signin"; message: string }
  | { state: "unreachable"; message: string }
  | { state: "error"; message: string };

const PROTOCOL = "2025-06-18";

/** Reads a JSON-RPC reply that may come back as plain JSON or as a server-sent event stream. */
async function readRpc(res: Response, id: number): Promise<{ result?: unknown; error?: { message: string } }> {
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const candidates = type.includes("text/event-stream")
    ? body.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [body];
  for (const c of candidates) {
    try {
      const msg = JSON.parse(c) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === id) return msg;
    } catch {
      /* skip non-JSON lines */
    }
  }
  throw new Error("no matching reply");
}

/**
 * Checks the VaultProof MCP server: handshake, then list tools. Does not sign in; when the server
 * asks for sign-in (401), the status says so. Session tokens come from the keychain, never settings.
 */
export async function checkVaultProof(opts: { enabled: boolean; url: string; sessionToken?: string; fetch?: Fetch; timeoutMs?: number }): Promise<VaultProofStatus> {
  if (!opts.enabled || !opts.url) return { state: "off", message: "VaultProof is not connected. Turn it on in Settings > VaultProof." };
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
    ...(opts.sessionToken ? { authorization: `Bearer ${opts.sessionToken}` } : {}),
  };
  const post = async (body: unknown, extra: Record<string, string> = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
    try {
      return await f(opts.url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  let init: Response;
  try {
    init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "deck", version: "0.1.0" } } });
  } catch {
    return { state: "unreachable", message: "VaultProof MCP server is not reachable yet." };
  }
  if (init.status === 401 || init.status === 403) return { state: "needs_signin", message: "VaultProof needs you to sign in." };
  if (init.status === 404 || init.status >= 500) return { state: "unreachable", message: `VaultProof MCP server answered ${init.status}; it may not be live yet.` };
  if (!init.ok) return { state: "error", message: `VaultProof MCP handshake failed (${init.status}).` };
  try {
    const hello = await readRpc(init, 1);
    if (hello.error) return { state: "error", message: `VaultProof refused the handshake: ${hello.error.message}` };
    const serverName = String((hello.result as { serverInfo?: { name?: string } })?.serverInfo?.name ?? "VaultProof");
    const session = init.headers.get("mcp-session-id");
    const sid: Record<string, string> = session ? { "mcp-session-id": session } : {};
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
    const listRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sid);
    if (listRes.status === 401) return { state: "needs_signin", message: "VaultProof needs you to sign in." };
    const list = await readRpc(listRes, 2);
    const tools = ((list.result as { tools?: { name: string }[] })?.tools ?? []).map((t) => t.name);
    return { state: "connected", message: `Connected to ${serverName}. ${tools.length} tools available.`, serverName, tools };
  } catch {
    return { state: "error", message: "VaultProof replied in an unexpected format." };
  }
}

/** Startup-check probe for the VaultProof segment. VaultProof is optional for now, so it never blocks boot. */
export function vaultProofProbe(getOpts: () => Promise<Parameters<typeof checkVaultProof>[0]>) {
  return async (): Promise<{ status: "ok" | "degraded" | "off"; message: string; fix?: string }> => {
    const s = await checkVaultProof(await getOpts());
    switch (s.state) {
      case "off":
        return { status: "off", message: s.message };
      case "connected":
        return { status: "ok", message: s.message };
      case "needs_signin":
        return { status: "degraded", message: s.message, fix: "Sign in from Settings > VaultProof." };
      case "unreachable":
        return { status: "degraded", message: s.message, fix: "Check the URL in Settings > VaultProof, or turn it off until the server is live." };
      default:
        return { status: "degraded", message: s.message, fix: "Check the URL in Settings > VaultProof." };
    }
  };
}
