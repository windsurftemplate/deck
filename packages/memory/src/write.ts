import type { MemoryStore, StoredFactRef } from "./store.js";
import type { CandidateFact, Clock, Embedder, EpisodeInput, GateVerdict } from "./types.js";
import { systemClock } from "./types.js";

export type CurrentFact = StoredFactRef;

/** Optional second opinion on a candidate fact (Jev in the app). Return null to keep the built-in verdict. */
export type FactDecider = (candidate: CandidateFact, current: CurrentFact[], builtIn: GateVerdict) => Promise<GateVerdict | null>;

export interface WriteResult {
  verdict: GateVerdict;
  factId?: number;
  reviewId?: number;
}

const VAGUE = /^(something|stuff|things?|it|this|that|n\/a|unknown|tbd)\.?$/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");
/** Squared L2 distance below this on unit vectors is roughly cosine > 0.98: treat as the same claim. */
const NEAR_DUPLICATE = 0.04;

/** Memory write path. Knows nothing about the database: everything goes through the MemoryStore port. */
export class MemoryWriter {
  constructor(
    private store: MemoryStore,
    private embedder: Embedder,
    private clock: Clock = systemClock,
    private decide?: FactDecider,
  ) {
    if (embedder.dim !== store.dim) throw new Error(`memory: embedder makes ${embedder.dim}-dim vectors but the store expects ${store.dim}`);
  }

  private now() {
    return this.clock().toISOString();
  }

  async logEpisode(e: EpisodeInput): Promise<number> {
    const summary = e.summary.trim();
    if (!summary) throw new Error("memory: episode summary is empty");
    const [vec] = await this.embedder.embed([summary]);
    return this.store.addEpisode({ ...e, summary }, this.now(), vec!);
  }

  /** Decide what to do with a candidate fact, without writing anything. */
  async gate(c: CandidateFact, vec?: Float32Array): Promise<{ verdict: GateVerdict; current: CurrentFact[]; vec: Float32Array }> {
    const embedding = vec ?? (await this.embedder.embed([`${c.subject}: ${c.claim}`]))[0]!;
    const current = await this.store.currentFacts(c.subject, c.attribute);
    let verdict: GateVerdict;
    if (c.claim.trim().length < 3 || VAGUE.test(c.claim.trim()) || !c.subject.trim()) {
      verdict = { kind: "rejected", reason: "not specific enough" };
    } else {
      const same = current.find((f) => norm(f.claim) === norm(c.claim));
      const nearest = same ? undefined : await this.store.nearestCurrentFact(c.subject, embedding);
      const near = nearest && nearest.distance * nearest.distance < NEAR_DUPLICATE ? nearest.id : undefined;
      if (same) verdict = { kind: "duplicate", of: same.id };
      else if (near !== undefined) verdict = { kind: "duplicate", of: near };
      else if (current.length) {
        const stated = current.find((f) => f.source === "stated");
        verdict = stated && c.source === "inferred" ? { kind: "contradicts", existing: stated.id } : { kind: "update", replaces: current[0]!.id };
      } else verdict = { kind: "new" };
    }
    if (this.decide && verdict.kind !== "rejected") {
      const override = await this.decide(c, current, verdict);
      if (override) verdict = override;
    }
    return { verdict, current, vec: embedding };
  }

  /** Gate a candidate fact and apply the verdict. Old facts are superseded, never overwritten. */
  async writeFact(c: CandidateFact, episodeId?: number): Promise<WriteResult> {
    const { verdict, vec } = await this.gate(c);
    const now = this.now();
    switch (verdict.kind) {
      case "rejected":
        return { verdict };
      case "duplicate":
        await this.store.touchFact(verdict.of, now, c.confidence ?? 0.7);
        return { verdict, factId: verdict.of };
      case "contradicts":
        return { verdict, reviewId: await this.store.addReview("contradiction", { existing: verdict.existing, candidate: c, episodeId: episodeId ?? null }, now) };
      case "new":
      case "update": {
        const fact = { subject: c.subject, attribute: c.attribute, claim: c.claim.trim(), source: c.source, confidence: c.confidence ?? (c.source === "stated" ? 0.95 : 0.7), ...(episodeId !== undefined ? { episodeId } : {}) };
        const id = await this.store.insertFact(fact, vec, now, verdict.kind === "update" ? verdict.replaces : undefined);
        return { verdict, factId: id };
      }
    }
  }

  /** The owner resolves a contradiction: keep the existing fact, or accept the new claim as stated. */
  async resolveContradiction(reviewId: number, accept: boolean): Promise<WriteResult | null> {
    const r = await this.store.takeReview(reviewId);
    if (!r || r.kind !== "contradiction" || !accept) return null;
    const p = r.payload as { existing: number; candidate: CandidateFact; episodeId: number | null };
    const vec = (await this.embedder.embed([`${p.candidate.subject}: ${p.candidate.claim}`]))[0]!;
    const fact = { subject: p.candidate.subject, attribute: p.candidate.attribute, claim: p.candidate.claim, source: "stated" as const, confidence: 0.95, ...(p.episodeId !== null ? { episodeId: p.episodeId } : {}) };
    const id = await this.store.insertFact(fact, vec, this.now(), p.existing);
    return { verdict: { kind: "update", replaces: p.existing }, factId: id };
  }

  addEdge(from: string, relation: string, to: string): Promise<number> {
    return this.store.addEdge(from, relation, to, this.now());
  }
  endEdge(id: number): Promise<void> {
    return this.store.endEdge(id, this.now());
  }
  /** /forget: the facts, their history and their edges are removed, not softened. */
  forgetSubject(subject: string): Promise<number> {
    return this.store.forgetSubject(subject);
  }
  recordFeedback(f: { actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before?: string; after?: string; reason?: string }): Promise<number> {
    return this.store.addFeedback({ ...f, ts: this.now() });
  }
  openReviews() {
    return this.store.openReviews();
  }
}
