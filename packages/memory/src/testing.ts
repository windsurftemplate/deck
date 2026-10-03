import type { Embedder } from "./types.js";

/** Deterministic bag-of-words embedder for tests and offline development. Not for production use. */
export class HashEmbedder implements Embedder {
  constructor(public dim = 64) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dim);
      for (const w of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        let h = 2166136261;
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
        v[(h >>> 0) % this.dim]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      for (let i = 0; i < v.length; i++) v[i]! /= n;
      return v;
    });
  }
}
