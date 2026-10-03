import { ModelError, type ChatModel, type ChatRequest, type ChatResponse, type Fetch } from "./types.js";

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter";

/** Key shapes, used to catch a key pasted into the wrong provider. Not a security check. */
export const KEY_SHAPES: Record<ProviderId, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  openai: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/,
  gemini: /^AIza[0-9A-Za-z_-]{30,}$/,
  openrouter: /^sk-or-[A-Za-z0-9_-]{20,}$/,
};

export function checkKeyShape(provider: ProviderId, key: string): string | null {
  const k = key.trim();
  if (!k) return "Paste a key first.";
  if (/\s/.test(k)) return "The key has spaces in it. Copy it again.";
  if (provider === "openai" && k.startsWith("sk-ant-")) return "That is an Anthropic key. Paste it under Anthropic.";
  if (provider === "openai" && k.startsWith("sk-or-")) return "That is an OpenRouter key. Paste it under OpenRouter.";
  const name = { anthropic: "an Anthropic", openai: "an OpenAI", gemini: "a Google Gemini", openrouter: "an OpenRouter" }[provider];
  if (!KEY_SHAPES[provider].test(k)) return `That does not look like ${name} key.`;
  return null;
}

/**
 * Claude called directly with a developer key. Temporary until VaultProof brokers credentials.
 * The key is read from the keychain at call time by the engine and never logged or stored elsewhere.
 */
export class AnthropicDirect implements ChatModel {
  private f: Fetch;
  constructor(
    public id: string,
    private getKey: () => Promise<string>,
    opts: { fetch?: Fetch; timeoutMs?: number } = {},
  ) {
    this.f = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }
  private timeoutMs: number;

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const key = await this.getKey();
    const block = (b: { text: string; cache?: boolean }) => ({ type: "text", text: b.text, ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}) });
    const body = {
      model: this.id,
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.system?.length ? { system: req.system.map(block) } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map(block) })),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    let res: Response;
    try {
      res = await this.f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new ModelError(`anthropic: request failed (${(err as Error).name})`, 0, true);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new ModelError("anthropic: the API key was rejected. Check it in Settings > Models.", 401, false);
    if (!res.ok) throw new ModelError(`anthropic: ${this.id} returned ${res.status}`, res.status, res.status === 429 || res.status >= 500);
    const j = (await res.json()) as {
      model: string;
      stop_reason: string | null;
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    return {
      text: j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
      model: j.model,
      stopReason: j.stop_reason,
      usage: { inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens, cacheReadTokens: j.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: j.usage.cache_creation_input_tokens ?? 0 },
    };
  }
}
