import type { MemoryStore } from "./store.js";
import type { Embedder } from "./types.js";

/**
 * Move memory from one store to another (for example SQLite to Postgres). If the embedding
 * dimension changes, or a new embedder is given, vectors are rebuilt from the text.
 */
export async function migrateMemory(from: MemoryStore, to: MemoryStore, embedder?: Embedder): Promise<{ facts: number; episodes: number; reembedded: boolean }> {
  const reembed = !!embedder || from.dim !== to.dim;
  if (reembed && !embedder) throw new Error("memory: the stores use different embedding sizes; pass an embedder to rebuild vectors");
  if (embedder && embedder.dim !== to.dim) throw new Error("memory: the embedder does not match the target store");
  const dump = await from.exportAll(!reembed);
  await to.importAll({ ...dump, dim: to.dim });
  if (reembed) {
    const current = dump.facts.filter((f) => f.validTo === null);
    for (let i = 0; i < current.length; i += 64) {
      const batch = current.slice(i, i + 64);
      const vecs = await embedder!.embed(batch.map((f) => `${f.subject}: ${f.claim}`));
      for (let j = 0; j < batch.length; j++) await to.setVector("fact", batch[j]!.id, vecs[j]!);
    }
    for (let i = 0; i < dump.episodes.length; i += 64) {
      const batch = dump.episodes.slice(i, i + 64);
      const vecs = await embedder!.embed(batch.map((e) => e.summary));
      for (let j = 0; j < batch.length; j++) await to.setVector("episode", batch[j]!.id, vecs[j]!);
    }
  }
  return { facts: dump.facts.length, episodes: dump.episodes.length, reembedded: reembed };
}
