/**
 * A small MCP client over Streamable HTTP (JSON-RPC 2.0). Enough for plugins: initialize, list tools, call a tool.
 * Answers may come back as JSON or as a server-sent event stream; both are handled.
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export class McpError extends Error {}

export class McpHttpClient {
  private session: string | null = null;
  private nextId = 1;
  private ready: Promise<void> | null = null;
  constructor(
    private url: string,
    private o: { token?: string; fetch?: typeof fetch; timeoutMs?: number; clientName?: string } = {},
  ) {}

  private async rpc(method: string, params?: unknown, notify = false): Promise<unknown> {
    const f = this.o.fetch ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 30_000);
    try {
      const id = notify ? undefined : this.nextId++;
      const res = await f(this.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...(this.session ? { "mcp-session-id": this.session } : {}),
          ...(this.o.token ? { authorization: `Bearer ${this.o.token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params !== undefined ? { params } : {}) }),
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.session = sid;
      if (res.status === 401 || res.status === 403) throw new McpError("The plugin refused the request: sign-in or token needed.");
      if (notify) return null;
      if (!res.ok) throw new McpError(`The plugin returned ${res.status}.`);
      const type = res.headers.get("content-type") ?? "";
      const text = await res.text();
      const messages = type.includes("text/event-stream")
        ? text.split(/\r?\n\r?\n/).map((e) => e.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")).filter(Boolean).map((d) => JSON.parse(d) as { id?: number; result?: unknown; error?: { message: string } })
        : [JSON.parse(text) as { id?: number; result?: unknown; error?: { message: string } }];
      const m = messages.find((x) => x.id === id) ?? messages.at(-1);
      if (!m) throw new McpError("The plugin sent no answer.");
      if (m.error) throw new McpError(`Plugin error: ${m.error.message}`);
      return m.result;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new McpError("The plugin took too long to answer.");
      throw e instanceof McpError ? e : new McpError(`Could not reach the plugin (${(e as Error).message}).`);
    } finally {
      clearTimeout(timer);
    }
  }

  private init() {
    this.ready ??= (async () => {
      await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: this.o.clientName ?? "deck", version: "0.1.0" } });
      await this.rpc("notifications/initialized", undefined, true);
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async listTools(): Promise<McpTool[]> {
    await this.init();
    const r = (await this.rpc("tools/list", {})) as { tools?: McpTool[] };
    return (r.tools ?? []).slice(0, 64);
  }

  /** Calls a tool and returns its text content (other content types are summarized). */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.init();
    const r = (await this.rpc("tools/call", { name, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
    const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type} content]`)).join("\n") || (r.structuredContent ? JSON.stringify(r.structuredContent) : "");
    return { text: text.slice(0, 20_000), isError: !!r.isError };
  }
}
