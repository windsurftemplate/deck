import { ModelError, type Fetch } from "./types.js";
import type { ModelRef } from "./providers.js";
import { BASE_URLS } from "./providers.js";

export interface ResearchResult {
  text: string;
  sources: { url: string; title: string }[];
  provider: string;
}

const uniq = (xs: { url: string; title: string }[]) => [...new Map(xs.filter((x) => /^https?:\/\//.test(x.url)).map((x) => [x.url, x])).values()].slice(0, 12);

async function post(f: Fetch, url: string, headers: Record<string, string>, body: unknown, provider: string) {
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch (err) {
    throw new ModelError(`${provider}: web research request failed (${(err as Error).name})`, 0, true);
  }
  if (res.status === 401 || res.status === 403) throw new ModelError(`${provider}: the API key was rejected. Check it in Settings > Models.`, res.status, false);
  if (!res.ok) throw new ModelError(`${provider}: web research returned ${res.status}`, res.status, res.status === 429 || res.status >= 500);
  return res.json() as Promise<unknown>;
}

/**
 * One web research call using the provider's own search tool (Claude web search, OpenAI web search,
 * Gemini Google Search grounding). Returns the answer and the pages it used. Results are untrusted text.
 */
export async function webResearch(ref: ModelRef, key: string, question: string, f: Fetch = fetch, maxSearches = 5): Promise<ResearchResult> {
  const q = question.slice(0, 2000);
  switch (ref.provider) {
    case "anthropic": {
      const j = (await post(f, "https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, { model: ref.model, max_tokens: 1500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }], messages: [{ role: "user", content: q }] }, "anthropic")) as {
        content: { type: string; text?: string; citations?: { url?: string; title?: string }[]; content?: { type: string; url?: string; title?: string }[] }[];
      };
      const sources = j.content.flatMap((b) => [...(b.type === "web_search_tool_result" && Array.isArray(b.content) ? b.content.map((r) => ({ url: r.url ?? "", title: r.title ?? "" })) : []), ...(b.citations ?? []).map((c) => ({ url: c.url ?? "", title: c.title ?? "" }))]);
      return { text: j.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(), sources: uniq(sources), provider: "anthropic" };
    }
    case "openai": {
      const j = (await post(f, `${BASE_URLS.openai}/responses`, { authorization: `Bearer ${key}` }, { model: ref.model, tools: [{ type: "web_search" }], input: q }, "openai")) as {
        output: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[];
      };
      const parts = j.output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
      return { text: parts.map((p) => p.text ?? "").join("").trim(), sources: uniq(parts.flatMap((p) => (p.annotations ?? []).filter((a) => a.type === "url_citation").map((a) => ({ url: a.url ?? "", title: a.title ?? "" })))), provider: "openai" };
    }
    case "gemini": {
      const j = (await post(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ref.model)}:generateContent`, { "x-goog-api-key": key }, { contents: [{ role: "user", parts: [{ text: q }] }], tools: [{ google_search: {} }] }, "gemini")) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
      };
      const c = j.candidates?.[0];
      return { text: (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim(), sources: uniq((c?.groundingMetadata?.groundingChunks ?? []).map((g) => ({ url: g.web?.uri ?? "", title: g.web?.title ?? "" }))), provider: "gemini" };
    }
    default:
      throw new ModelError("Web research needs Claude, OpenAI or Gemini. OpenRouter is not supported for research yet.", 400, false);
  }
}
