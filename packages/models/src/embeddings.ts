import type { Fetch } from "./types.js";

/** Same shape as @deck/memory's Embedder, repeated here so models stays independent. */
export interface TextEmbedder {
  dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

const unit = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
};

/** OpenAI embeddings with the owner's key from the keychain. Vectors are unit length. */
export class OpenAIEmbedder implements TextEmbedder {
  constructor(
    private getKey: () => Promise<string>,
    public dim = 512,
    private model = "text-embedding-3-small",
    private f: Fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const res = await this.f("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.getKey()}` },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dim }),
    });
    if (res.status === 401) throw new Error("embeddings: the OpenAI key was rejected. Check it in Settings > Models.");
    if (!res.ok) throw new Error(`embeddings: OpenAI returned ${res.status}`);
    const j = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return j.data.sort((a, b) => a.index - b.index).map((d) => unit(d.embedding));
  }
}
