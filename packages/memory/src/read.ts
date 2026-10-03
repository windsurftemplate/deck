import type { DB } from "./db.js";
import type { Embedder, Memory } from "./types.js";

export interface RetrieveOptions {
  /** Candidates taken from each search before fusion. */
  k?: number;
  /** Rough token budget for the returned text (about 4 characters per token). */
  tokenBudget?: number;
  /** Include episodes as well as facts. */
  episodes?: boolean;
}

/** Turn free text into a safe FTS5 query: quoted words joined with OR. */
export function ftsQuery(text: string): string | null {
  const words = Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])).slice(0, 16);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}

const RRF_K = 60;

export class MemoryReader {
  constructor(
    private db: DB,
    private embedder: Embedder,
  ) {}

  /** Hybrid recall: vector + keyword, fused by reciprocal rank, plus one hop on the graph. Current facts only. */
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

    const vf = this.db
      .prepare(
        `SELECT f.id, f.subject, f.claim, f.source FROM vec_facts v JOIN facts f ON f.id = v.rowid
         WHERE v.embedding MATCH ? AND k = ? AND f.valid_to IS NULL ORDER BY v.distance`,
      )
      .all(vec!, k * 2) as { id: number; subject: string; claim: string; source: string }[];
    vf.slice(0, k).forEach((r, i) => bump(`fact:${r.id}`, i, `${r.subject}: ${r.claim}${r.source === "stated" ? " (stated)" : ""}`));

    const q = ftsQuery(query);
    if (q) {
      const kf = this.db
        .prepare(
          `SELECT f.id, f.subject, f.claim, f.source FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
           WHERE facts_fts MATCH ? AND f.valid_to IS NULL ORDER BY bm25(facts_fts) LIMIT ?`,
        )
        .all(q, k) as { id: number; subject: string; claim: string; source: string }[];
      kf.forEach((r, i) => bump(`fact:${r.id}`, i, `${r.subject}: ${r.claim}${r.source === "stated" ? " (stated)" : ""}`));
    }

    if (opts.episodes !== false) {
      const ve = this.db
        .prepare(`SELECT e.id, e.ts, e.summary FROM vec_episodes v JOIN episodes e ON e.id = v.rowid WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance`)
        .all(vec!, k) as { id: number; ts: string; summary: string }[];
      ve.forEach((r, i) => bump(`episode:${r.id}`, i + 2, `${r.ts.slice(0, 10)} ${r.summary}`));
      if (q) {
        const ke = this.db
          .prepare(`SELECT e.id, e.ts, e.summary FROM episodes_fts JOIN episodes e ON e.id = episodes_fts.rowid WHERE episodes_fts MATCH ? ORDER BY bm25(episodes_fts) LIMIT ?`)
          .all(q, k) as { id: number; ts: string; summary: string }[];
        ke.forEach((r, i) => bump(`episode:${r.id}`, i + 2, `${r.ts.slice(0, 10)} ${r.summary}`));
      }
    }

    // One hop: relationships of the subjects in the strongest facts.
    const topSubjects = new Set(
      [...scores.entries()]
        .filter(([id]) => id.startsWith("fact:"))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => text.get(id)!.split(":")[0]!),
    );
    let hop = 0;
    for (const s of topSubjects) {
      const edges = this.db
        .prepare("SELECT id, from_subj, relation, to_subj FROM edges WHERE (from_subj = ? OR to_subj = ?) AND valid_to IS NULL LIMIT 5")
        .all(s, s) as { id: number; from_subj: string; relation: string; to_subj: string }[];
      for (const e of edges) bump(`edge:${e.id}`, 6 + hop++, `${e.from_subj} ${e.relation} ${e.to_subj}`);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const out: Memory[] = [];
    let used = 0;
    for (const [id, score] of ranked) {
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
