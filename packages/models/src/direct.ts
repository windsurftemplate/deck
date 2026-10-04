import { sseJson } from "./stream.js";
import { ModelError, blocksOf, type Block, type ChatModel, type ChatRequest, type ChatResponse, type Fetch, type ToolCallBlock } from "./types.js";
import { REASONING_BUDGET } from "./types.js";

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "ollama";

/** Key shapes, used to catch a key pasted into the wrong provider. Not a security check. */
export const KEY_SHAPES: Record<ProviderId, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  openai: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/,
  gemini: /^AIza[0-9A-Za-z_-]{30,}$/,
  openrouter: /^sk-or-[A-Za-z0-9_-]{20,}$/,
  ollama: /^.*$/, // local: no key
};

export function checkKeyShape(provider: ProviderId, key: string): string | null {
  const k = key.trim();
  if (!k) return "Paste a key first.";
  if (/\s/.test(k)) return "The key has spaces in it. Copy it again.";
  if (provider === "openai" && k.startsWith("sk-ant-")) return "That is an Anthropic key. Paste it under Anthropic.";
  if (provider === "openai" && k.startsWith("sk-or-")) return "That is an OpenRouter key. Paste it under OpenRouter.";
  const name = { anthropic: "an Anthropic", openai: "an OpenAI", gemini: "a Google Gemini", openrouter: "an OpenRouter", ollama: "an Ollama" }[provider];
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

  async chat(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse> {
    const key = await this.getKey();
    const body = { ...anthropicBody(this.id, req), ...(onText ? { stream: true } : {}) };
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
    return onText ? anthropicStream(res, this.id, onText) : anthropicResponse(await res.json());
  }
}

/** Rebuilds a full Anthropic response from its event stream, passing text deltas on as they arrive. */
export async function anthropicStream(res: Response, model: string, onText: (d: string) => void): Promise<ChatResponse> {
  const blocks: { type: string; text?: string; id?: string; name?: string; json?: string; thinking?: string; signature?: string; data?: string }[] = [];
  let stop: string | null = null;
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for await (const e of sseJson(res)) {
    const t = e.type as string;
    if (t === "message_start") Object.assign(usage, ((e.message as { usage?: object })?.usage ?? {}));
    else if (t === "content_block_start") {
      const b = e.content_block as { type: string; id?: string; name?: string; data?: string };
      blocks[e.index as number] = { type: b.type, ...(b.id ? { id: b.id } : {}), ...(b.name ? { name: b.name } : {}), ...(b.data ? { data: b.data } : {}), text: "", json: "", thinking: "", signature: "" };
    } else if (t === "content_block_delta") {
      const d = e.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
      const b = blocks[e.index as number];
      if (!b) continue;
      if (d.type === "text_delta" && d.text) (b.text += d.text), onText(d.text);
      if (d.type === "input_json_delta" && d.partial_json) b.json += d.partial_json;
      if (d.type === "thinking_delta" && d.thinking) b.thinking += d.thinking;
      if (d.type === "signature_delta" && d.signature) b.signature += d.signature;
    } else if (t === "message_delta") {
      stop = ((e.delta as { stop_reason?: string })?.stop_reason ?? stop) as string | null;
      Object.assign(usage, e.usage ?? {});
    } else if (t === "error") throw new ModelError(`anthropic: ${(e.error as { message?: string })?.message ?? "stream error"}`, 500, true);
  }
  const toolCalls: ToolCallBlock[] = blocks.filter((b) => b?.type === "tool_use").map((b) => {
    let input: Record<string, unknown> = {};
    try {
      input = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
    } catch {
      input = { _unparsed: b.json };
    }
    return { type: "tool_call", id: b.id!, name: b.name!, input } as ToolCallBlock;
  });
  const thinkingRaw = blocks.filter((b) => b?.type === "thinking" || b?.type === "redacted_thinking").map((b) => (b.type === "thinking" ? { type: "thinking", thinking: b.thinking, signature: b.signature } : { type: "redacted_thinking", data: b.data }));
  if (thinkingRaw.length && toolCalls[0]) toolCalls[0].meta = { anthropicThinking: thinkingRaw };
  const thinking = blocks.filter((b) => b?.type === "thinking").map((b) => b.thinking).join("\n").trim();
  return {
    text: blocks.filter((b) => b?.type === "text").map((b) => b.text).join(""),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(thinking ? { thinking } : {}),
    model,
    stopReason: stop,
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens },
  };
}

/** Anthropic Messages request body, shared by direct and Gateway calls. */
export function anthropicBody(model: string, req: ChatRequest) {
  const block = (b: Block) => {
    if (b.type === "text") return { type: "text", text: b.text, ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}) };
    if (b.type === "tool_call") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    if (b.type === "image") return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } };
    return { type: "tool_result", tool_use_id: b.id, content: b.content, ...(b.isError ? { is_error: true } : {}) };
  };
  // Thinking blocks must go back exactly as received, before the tool calls they led to.
  const assistantBlocks = (bs: Block[]) =>
    bs.flatMap((b) => {
      const t = b.type === "tool_call" ? (b.meta as { anthropicThinking?: unknown[] } | undefined)?.anthropicThinking : undefined;
      return [...(t ?? []), block(b)];
    });
  const budget = req.reasoning ? REASONING_BUDGET[req.reasoning] : 0;
  return {
    model,
    max_tokens: req.maxTokens + budget,
    ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.system?.length ? { system: req.system.map(block) } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.role === "assistant" ? assistantBlocks(blocksOf(m.content)) : blocksOf(m.content).map(block) })),
  };
}

export function anthropicResponse(raw: unknown): ChatResponse {
  const j = raw as {
    model: string;
    stop_reason: string | null;
    content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; thinking?: string; signature?: string; data?: string }[];
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  const toolCalls: ToolCallBlock[] = j.content.filter((c) => c.type === "tool_use").map((c) => ({ type: "tool_call", id: c.id!, name: c.name!, input: c.input ?? {} }));
  const thinkingRaw = j.content.filter((c) => c.type === "thinking" || c.type === "redacted_thinking");
  if (thinkingRaw.length && toolCalls[0]) toolCalls[0].meta = { anthropicThinking: thinkingRaw };
  const thinking = j.content.filter((c) => c.type === "thinking").map((c) => c.thinking ?? "").join("\n").trim();
  return {
    text: j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(thinking ? { thinking } : {}),
    model: j.model,
    stopReason: j.stop_reason,
    usage: { inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens, cacheReadTokens: j.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: j.usage.cache_creation_input_tokens ?? 0 },
  };
}
