import { ModelError, type ChatModel, type ChatRequest, type ChatResponse, type Fetch } from "./types.js";
import { anthropicBody, anthropicResponse } from "./direct.js";

/**
 * Shapes of real provider secrets. The app must only ever hold a scoped VaultProof token,
 * so anything matching these is refused before it can be stored or sent.
 */
const RAW_KEY_PATTERNS: [string, RegExp][] = [
  ["Anthropic", /^sk-ant-/],
  ["OpenAI", /^sk-(proj-)?[A-Za-z0-9]/],
  ["Google", /^AIza[0-9A-Za-z_-]{20,}/],
  ["AWS", /^(AKIA|ASIA)[0-9A-Z]{16}/],
  ["GitHub", /^(ghp|gho|ghs|github_pat)_/],
];

export function assertScopedToken(token: string): void {
  for (const [name, re] of RAW_KEY_PATTERNS) {
    if (re.test(token)) throw new Error(`gateway: that looks like a raw ${name} key. Add it to VaultProof Gateway and use the scoped vp-proj token instead.`);
  }
  if (!/^vp-proj-[A-Za-z0-9_-]{16,}$/.test(token)) throw new Error("gateway: expected a scoped token starting with vp-proj-");
}

export interface GatewayConfig {
  /** Base URL of the VaultProof Gateway, for example https://gateway.example.com */
  baseUrl: string;
  /** Scoped vp-proj token. Never a raw provider key. */
  token: string;
  /** Path for Anthropic-compatible message calls. Confirm against the Gateway API. */
  anthropicPath?: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

/** A Claude model reached through the Gateway using the Anthropic Messages API shape. */
export class GatewayClaude implements ChatModel {
  private f: Fetch;
  constructor(
    public id: string,
    private cfg: GatewayConfig,
  ) {
    assertScopedToken(cfg.token);
    if (!/^https:\/\//.test(cfg.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(cfg.baseUrl)) {
      throw new Error("gateway: base URL must use https (http only for localhost)");
    }
    this.f = cfg.fetch ?? fetch;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = anthropicBody(this.id, req);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 120_000);
    signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    let res: Response;
    try {
      res = await this.f(this.cfg.baseUrl.replace(/\/$/, "") + (this.cfg.anthropicPath ?? "/anthropic/v1/messages"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.token}`, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new ModelError(`gateway: request failed (${(err as Error).name})`, 0, true);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
      throw new ModelError(`gateway: ${this.id} returned ${res.status}`, res.status, retryable);
    }
    return anthropicResponse(await res.json());
  }
}
