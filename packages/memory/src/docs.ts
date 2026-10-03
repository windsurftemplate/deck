import type { Embedder } from "./types.js";
import type { MemoryStore, NewDocument } from "./store.js";

/** Splits text into overlapping chunks on paragraph or sentence boundaries where possible. */
export function chunkText(text: string, size = 1200, overlap = 150, max = 2000): string[] {
  const t = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return [];
  const out: string[] = [];
  let i = 0;
  while (i < t.length && out.length < max) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) {
      const window = t.slice(i + size * 0.6, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (cut > 0) end = i + size * 0.6 + cut + 1;
    }
    const piece = t.slice(i, Math.round(end)).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i = Math.max(Math.round(end) - overlap, i + 1);
  }
  return out;
}

/** Chunks, embeds (with the title for context) and stores a document. */
export async function embedChunks(embedder: Embedder, title: string, text: string) {
  const pieces = chunkText(text);
  const chunks: { text: string; vec: Float32Array }[] = [];
  for (let i = 0; i < pieces.length; i += 32) {
    const batch = pieces.slice(i, i + 32);
    const vecs = await embedder.embed(batch.map((p) => `${title}\n${p}`));
    batch.forEach((p, j) => chunks.push({ text: p, vec: vecs[j]! }));
  }
  return chunks;
}

export async function ingestDocument(store: MemoryStore, embedder: Embedder, d: NewDocument, ts: string): Promise<{ id: number; chunks: number }> {
  const chunks = await embedChunks(embedder, d.title, d.text);
  const id = await store.addDocument(d, chunks, ts);
  return { id, chunks: chunks.length };
}
