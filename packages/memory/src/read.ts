import type { MemoryStore } from "./store.js";
import type { Embedder, Memory } from "./types.js";

export interface RetrieveOptions {
  /** Candidates taken from each search before fusion. */
  k?: number;
  /** Include passages from documents in the second brain (default on). */
  documents?: boolean;
  /** Rough token budget for the returned text (about 4 characters per token). */
  tokenBudget?: number;
  /** Include episodes as well as facts. */
  episodes?: boolean;
}

const RRF_K = 60;

/** Memory read path. Hybrid recall over any MemoryStore. */
export class MemoryReader {
  constructor(
    private store: MemoryStore,
    private embedder: Embedder,
  ) {}

  /** Vector + keyword, fused by reciprocal rank, plus one hop on the graph. Current facts only. */
  async retrieve(query: string, opts: RetrieveOptions = {}): Promise<Memory[]> {
    const k = opts.k ?? 12;
    const budget = (opts.tokenBudget ?? 1500) * 4;
    const [vec] = await this.embedder.embed([query]);
    const scores = new Map<string, number>();
    const text = new Map<string, string>();
    const bump = (id: string, rank: number, t: string) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
      text.set(id, t);
    };
    const factText = (r: { subject: string; claim: string; source: string }) => `${r.subject}: ${r.claim}${r.source === "stated" ? " (stated)" : ""}`;

    const [vf, kf, ve, ke, vd, kd] = await Promise.all([
      this.store.searchFactsByVector(vec!, k),
      this.store.searchFactsByText(query, k),
      opts.episodes === false ? [] : this.store.searchEpisodesByVector(vec!, k),
      opts.episodes === false ? [] : this.store.searchEpisodesByText(query, k),
      opts.documents === false ? [] : this.store.searchChunksByVector(vec!, Math.ceil(k / 2)),
      opts.documents === false ? [] : this.store.searchChunksByText(query, Math.ceil(k / 2)),
    ]);
    // Document passages rank a little below facts; ids name the document so answers can cite it.
    const docText = (r: { title: string; text: string }) => `${r.title}: ${r.text.slice(0, 700)}`;
    vd.forEach((r, i) => bump(`doc:${r.docId}.${r.id}`, i + 1, docText(r)));
    kd.forEach((r, i) => bump(`doc:${r.docId}.${r.id}`, i + 1, docText(r)));
    vf.forEach((r, i) => bump(`fact:${r.id}`, i, factText(r)));
    kf.forEach((r, i) => bump(`fact:${r.id}`, i, factText(r)));
    ve.forEach((r, i) => bump(`episode:${r.id}`, i + 2, `${r.ts.slice(0, 10)} ${r.summary}`));
    ke.forEach((r, i) => bump(`episode:${r.id}`, i + 2, `${r.ts.slice(0, 10)} ${r.summary}`));

    const subjects = new Map<string, string>();
    for (const r of [...vf, ...kf]) subjects.set(`fact:${r.id}`, r.subject);
    const top = [...scores.entries()]
      .filter(([id]) => id.startsWith("fact:"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => subjects.get(id)!);
    let hop = 0;
    for (const s of new Set(top)) for (const e of await this.store.edgesFor(s, 5)) bump(`edge:${e.id}`, 6 + hop++, `${e.from} ${e.relation} ${e.to}`);

    const out: Memory[] = [];
    let used = 0;
    for (const [id, score] of [...scores.entries()].sort((a, b) => b[1] - a[1])) {
      const t = text.get(id)!;
      if (used + t.length > budget) continue;
      used += t.length;
      out.push({ id, kind: id.split(":")[0] as Memory["kind"], text: t, score });
    }
    return out;
  }

  /** Format retrieved memories for a prompt, each cited by id so the agent can say where a belief came from. */
  static format(memories: Memory[]): string {
    return memories.map((m) => `[${m.id}] ${m.text}`).join("\n");
  }
}
