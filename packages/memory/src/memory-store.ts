import { words } from "./fts.js";
import { checkDump } from "./sqlite-store.js";
import type { MemoryDump, MemoryStore, NewFact, StoredEdge, StoredEpisode, StoredFact } from "./store.js";
import type { EpisodeInput } from "./types.js";

type Dump = MemoryDump;
const l2 = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
};

/**
 * Pure TypeScript adapter, nothing on disk. Used in tests and as proof that memory logic
 * does not depend on SQLite. Not for real data: it is not encrypted and not persisted.
 */
export class InMemoryStore implements MemoryStore {
  readonly engine = "memory";
  private d: Dump;
  private fv = new Map<number, Float32Array>();
  private ev = new Map<number, Float32Array>();
  private seq = { e: 0, f: 0, edge: 0, r: 0, fb: 0 };

  constructor(public readonly dim: number) {
    this.d = { format: "deck-memory", version: 1, dim, episodes: [], facts: [], edges: [], reviews: [], feedback: [] };
  }

  async addEpisode(e: EpisodeInput, ts: string, vec: Float32Array) {
    const id = ++this.seq.e;
    this.d.episodes.push({ id, ts, agent: e.agent, taskId: e.taskId ?? null, kind: e.kind, summary: e.summary, rawRef: e.rawRef ?? null, outcome: e.outcome ?? null });
    this.ev.set(id, vec);
    return id;
  }
  private current() {
    return this.d.facts.filter((f) => f.validTo === null);
  }
  async currentFacts(subject: string, attribute: string) {
    return this.current().filter((f) => f.subject === subject && f.attribute === attribute).map((f) => ({ id: f.id, claim: f.claim, source: f.source }));
  }
  async nearestCurrentFact(subject: string, vec: Float32Array) {
    return this.current()
      .filter((f) => f.subject === subject && this.fv.has(f.id))
      .map((f) => ({ id: f.id, distance: l2(vec, this.fv.get(f.id)!) }))
      .sort((a, b) => a.distance - b.distance)[0];
  }
  async insertFact(f: NewFact, vec: Float32Array, ts: string, supersedes?: number) {
    const id = ++this.seq.f;
    this.d.facts.push({ id, subject: f.subject, attribute: f.attribute, claim: f.claim, source: f.source, confidence: f.confidence, validFrom: ts, validTo: null, supersededBy: null, episodeId: f.episodeId ?? null, lastChecked: ts });
    this.fv.set(id, vec);
    if (supersedes !== undefined) {
      const old = this.d.facts.find((x) => x.id === supersedes);
      if (old) Object.assign(old, { validTo: ts, supersededBy: id });
      this.fv.delete(supersedes);
    }
    return id;
  }
  async touchFact(id: number, ts: string, confidence: number) {
    const f = this.d.facts.find((x) => x.id === id);
    if (f) Object.assign(f, { lastChecked: ts, confidence: Math.max(f.confidence, confidence) });
  }
  async currentClaims(subject: string) {
    return this.current().filter((f) => f.subject === subject).map((f) => f.claim);
  }
  async forgetSubject(subject: string) {
    const ids = this.d.facts.filter((f) => f.subject === subject).map((f) => f.id);
    this.d.facts = this.d.facts.filter((f) => f.subject !== subject);
    ids.forEach((id) => this.fv.delete(id));
    this.d.edges = this.d.edges.filter((e) => e.from !== subject && e.to !== subject);
    return ids.length;
  }
  async addReview(kind: string, payload: unknown, ts: string) {
    const id = ++this.seq.r;
    this.d.reviews.push({ id, ts, kind, payload: structuredClone(payload), status: "open" });
    return id;
  }
  async takeReview(id: number) {
    const r = this.d.reviews.find((x) => x.id === id && x.status === "open");
    if (!r) return null;
    r.status = "resolved";
    return { kind: r.kind, payload: structuredClone(r.payload) };
  }
  async openReviews() {
    return this.d.reviews.filter((r) => r.status === "open").map((r) => ({ id: r.id, kind: r.kind, payload: structuredClone(r.payload) }));
  }
  async addEdge(from: string, relation: string, to: string, ts: string) {
    const ex = this.d.edges.find((e) => e.from === from && e.relation === relation && e.to === to && e.validTo === null);
    if (ex) return ex.id;
    const id = ++this.seq.edge;
    this.d.edges.push({ id, from, relation, to, validFrom: ts, validTo: null });
    return id;
  }
  async endEdge(id: number, ts: string) {
    const e = this.d.edges.find((x) => x.id === id && x.validTo === null);
    if (e) e.validTo = ts;
  }
  async edgesFor(subject: string, limit: number): Promise<StoredEdge[]> {
    return this.d.edges.filter((e) => e.validTo === null && (e.from === subject || e.to === subject)).slice(0, limit).map((e) => ({ id: e.id, from: e.from, relation: e.relation, to: e.to }));
  }
  async addFeedback(f: { ts: string; actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before?: string; after?: string; reason?: string }) {
    const id = ++this.seq.fb;
    this.d.feedback.push({ id, ts: f.ts, actionId: f.actionId, agent: f.agent, verdict: f.verdict, before: f.before ?? null, after: f.after ?? null, reason: f.reason ?? null });
    return id;
  }
  async searchFactsByVector(vec: Float32Array, k: number): Promise<StoredFact[]> {
    return this.current()
      .filter((f) => this.fv.has(f.id))
      .map((f) => ({ f, d: l2(vec, this.fv.get(f.id)!) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map(({ f }) => ({ id: f.id, subject: f.subject, claim: f.claim, source: f.source }));
  }
  async searchFactsByText(text: string, k: number): Promise<StoredFact[]> {
    const q = words(text);
    return this.current()
      .map((f) => ({ f, s: words(`${f.subject} ${f.claim}`).filter((w) => q.includes(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map(({ f }) => ({ id: f.id, subject: f.subject, claim: f.claim, source: f.source }));
  }
  async searchEpisodesByVector(vec: Float32Array, k: number): Promise<StoredEpisode[]> {
    return this.d.episodes.filter((e) => this.ev.has(e.id)).map((e) => ({ e, d: l2(vec, this.ev.get(e.id)!) })).sort((a, b) => a.d - b.d).slice(0, k).map(({ e }) => ({ id: e.id, ts: e.ts, summary: e.summary }));
  }
  async searchEpisodesByText(text: string, k: number): Promise<StoredEpisode[]> {
    const q = words(text);
    return this.d.episodes
      .map((e) => ({ e, s: words(e.summary).filter((w) => q.includes(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map(({ e }) => ({ id: e.id, ts: e.ts, summary: e.summary }));
  }
  async exportAll(withVectors: boolean): Promise<MemoryDump> {
    const out = structuredClone(this.d);
    if (withVectors) {
      out.facts.forEach((f) => this.fv.has(f.id) && (f.vec = Array.from(this.fv.get(f.id)!)));
      out.episodes.forEach((e) => this.ev.has(e.id) && (e.vec = Array.from(this.ev.get(e.id)!)));
    }
    return out;
  }
  async importAll(d: MemoryDump) {
    checkDump(d, this.dim);
    if (this.d.facts.length || this.d.episodes.length) throw new Error("memory: import needs an empty store");
    this.d = structuredClone({ ...d, dim: this.dim });
    for (const f of this.d.facts) if (f.vec && f.validTo === null) this.fv.set(f.id, new Float32Array(f.vec));
    for (const e of this.d.episodes) if (e.vec) this.ev.set(e.id, new Float32Array(e.vec));
    this.d.facts.forEach((f) => delete f.vec);
    this.d.episodes.forEach((e) => delete e.vec);
    const max = (xs: { id: number }[]) => xs.reduce((m, x) => Math.max(m, x.id), 0);
    this.seq = { e: max(this.d.episodes), f: max(this.d.facts), edge: max(this.d.edges), r: max(this.d.reviews), fb: max(this.d.feedback) };
  }
  async setVector(kind: "fact" | "episode", id: number, vec: Float32Array) {
    if (vec.length !== this.dim) throw new Error("memory: vector has the wrong length");
    (kind === "fact" ? this.fv : this.ev).set(id, vec);
  }
  async close() {}
}
