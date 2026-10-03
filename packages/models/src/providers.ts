import { ModelError, type ChatModel, type ChatRequest, type ChatResponse, type Fetch, type TextBlock } from "./types.js";
import { AnthropicDirect, type ProviderId } from "./direct.js";

export interface ModelRef {
  provider: ProviderId;
  model: string;
}
export const refId = (r: ModelRef) => `${r.provider}:${r.model}`;

const text = (c: string | TextBlock[]) => (typeof c === "string" ? c : c.map((b) => b.text).join("\n\n"));

async function send(f: Fetch, url: string, init: RequestInit, provider: string, model: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await f(url, { ...init, signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) throw new ModelError(`${provider}: the API key was rejected. Check it in Settings > Models.`, res.status, false);
    if (res.status === 404) throw new ModelError(`${provider}: model ${model} was not found. Pick another in Settings > Models.`, 404, false);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (/API_KEY_INVALID|invalid api key/i.test(body)) throw new ModelError(`${provider}: the API key was rejected. Check it in Settings > Models.`, res.status, false);
      throw new ModelError(`${provider}: ${model} returned ${res.status}`, res.status, res.status === 429 || res.status >= 500);
    }
    return res;
  } catch (err) {
    if (err instanceof ModelError) throw err;
    throw new ModelError(`${provider}: request failed (${(err as Error).name})`, 0, true);
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI Chat Completions shape. Covers OpenAI, OpenRouter, and any compatible endpoint. */
export class OpenAICompatible implements ChatModel {
  constructor(
    public id: string,
    private o: { provider: "openai" | "openrouter"; baseUrl: string; getKey: () => Promise<string>; fetch?: Fetch; timeoutMs?: number },
  ) {}

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const messages = [
      ...(req.system?.length ? [{ role: "system", content: req.system.map((b) => b.text).join("\n\n") }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: text(m.content) })),
    ];
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${await this.o.getKey()}` };
    if (this.o.provider === "openrouter") headers["x-title"] = "deck";
    const res = await send(
      this.o.fetch ?? fetch,
      `${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`,
      { method: "POST", headers, body: JSON.stringify({ model: this.id, messages, max_completion_tokens: req.maxTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) }) },
      this.o.provider,
      this.id,
      this.o.timeoutMs ?? 120_000,
      signal,
    );
    const j = (await res.json()) as {
      model?: string;
      choices: { message: { content: string | null }; finish_reason: string | null }[];
      usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const cached = j.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: j.choices[0]?.message.content ?? "",
      model: j.model ?? this.id,
      stopReason: j.choices[0]?.finish_reason ?? null,
      usage: { inputTokens: (j.usage?.prompt_tokens ?? 0) - cached, outputTokens: j.usage?.completion_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 },
    };
  }
}

/** Google Gemini generateContent API. */
export class GeminiDirect implements ChatModel {
  constructor(
    public id: string,
    private o: { getKey: () => Promise<string>; fetch?: Fetch; timeoutMs?: number },
  ) {}

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = {
      ...(req.system?.length ? { systemInstruction: { parts: [{ text: req.system.map((b) => b.text).join("\n\n") }] } } : {}),
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: text(m.content) }] })),
      generationConfig: { maxOutputTokens: req.maxTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
    };
    const res = await send(
      this.o.fetch ?? fetch,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.id)}:generateContent`,
      { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": await this.o.getKey() }, body: JSON.stringify(body) },
      "gemini",
      this.id,
      this.o.timeoutMs ?? 120_000,
      signal,
    );
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
      modelVersion?: string;
    };
    const c = j.candidates?.[0];
    const cached = j.usageMetadata?.cachedContentTokenCount ?? 0;
    return {
      text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      model: j.modelVersion ?? this.id,
      stopReason: c?.finishReason ?? null,
      usage: { inputTokens: (j.usageMetadata?.promptTokenCount ?? 0) - cached, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 },
    };
  }
}

export const BASE_URLS = { openai: "https://api.openai.com/v1", openrouter: "https://openrouter.ai/api/v1" } as const;

/** One factory for every provider, so the engine and settings never special-case. */
export function makeChatModel(ref: ModelRef, getKey: () => Promise<string>, f?: Fetch): ChatModel {
  const opt = f ? { fetch: f } : {};
  switch (ref.provider) {
    case "anthropic":
      return new AnthropicDirect(ref.model, getKey, opt);
    case "openai":
    case "openrouter":
      return new OpenAICompatible(ref.model, { provider: ref.provider, baseUrl: BASE_URLS[ref.provider], getKey, ...opt });
    case "gemini":
      return new GeminiDirect(ref.model, { getKey, ...opt });
  }
}

/** Chat models the key can use, straight from the provider. Nothing is guessed or hard-coded. */
export async function listModels(provider: ProviderId, key: string, f: Fetch = fetch): Promise<string[]> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await f(url, { headers });
    if (res.status === 401 || res.status === 403) throw new Error(`${provider}: the API key was rejected.`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (/API_KEY_INVALID|invalid api key/i.test(body)) throw new Error(`${provider}: the API key was rejected.`);
      throw new Error(`${provider}: could not list models (${res.status}).`);
    }
    return res.json() as Promise<unknown>;
  };
  switch (provider) {
    case "anthropic": {
      const j = (await get("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" })) as { data: { id: string }[] };
      return j.data.map((m) => m.id);
    }
    case "openai": {
      const j = (await get(`${BASE_URLS.openai}/models`, { authorization: `Bearer ${key}` })) as { data: { id: string }[] };
      // Keep chat models; drop embeddings, audio, image, moderation and other non-chat models.
      return j.data.map((m) => m.id).filter((id) => !/embed|whisper|tts|dall-e|image|moderation|audio|realtime|transcribe|search|davinci|babbage/i.test(id)).sort();
    }
    case "openrouter": {
      const j = (await get(`${BASE_URLS.openrouter}/models`, { authorization: `Bearer ${key}` })) as { data: { id: string }[] };
      return j.data.map((m) => m.id).sort();
    }
    case "gemini": {
      const j = (await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": key })) as { models: { name: string; supportedGenerationMethods?: string[] }[] };
      return j.models.filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, "")).sort();
    }
  }
}
