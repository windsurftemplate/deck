import type { DB } from "./db.js";
import type { CandidateFact, Clock, Embedder, EpisodeInput, GateVerdict } from "./types.js";
import { systemClock } from "./types.js";

/** Optional second opinion on a candidate fact (Jev in the app). Return null to keep the built-in verdict. */
export type FactDecider = (candidate: CandidateFact, current: CurrentFact[], builtIn: GateVerdict) => Promise<GateVerdict | null>;

export interface CurrentFact {
  id: number;
  claim: string;
  source: "stated" | "inferred";
}

export interface WriteResult {
  verdict: GateVerdict;
  factId?: number;
  reviewId?: number;
}

const VAGUE = /^(something|stuff|things?|it|this|that|n\/a|unknown|tbd)\.?$/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");
/** Squared L2 distance below this on unit vectors is roughly cosine > 0.98: treat as the same claim. */
const NEAR_DUPLICATE = 0.04;

export class MemoryWriter {
  constructor(
    private db: DB,
    private embedder: Embedder,
    private clock: Clock = systemClock,
    private decide?: FactDecider,
  ) {}

  private now() {
    return this.clock().toISOString();
  }

  async logEpisode(e: EpisodeInput): Promise<number> {
    const summary = e.summary.trim();
    if (!summary) throw new Error("memory: episode summary is empty");
    const info = this.db
      .prepare("INSERT INTO episodes (ts, agent, task_id, kind, summary, raw_ref, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(this.now(), e.agent, e.taskId ?? null, e.kind, summary, e.rawRef ?? null, e.outcome ?? null);
    const id = Number(info.lastInsertRowid);
    const [vec] = await this.embedder.embed([summary]);
    this.db.prepare("INSERT INTO vec_episodes (rowid, embedding) VALUES (?, ?)").run(BigInt(id), vec!);
    return id;
  }

  /** Decide what to do with a candidate fact, without writing anything. */
  async gate(c: CandidateFact, vec?: Float32Array): Promise<{ verdict: GateVerdict; current: CurrentFact[]; vec: Float32Array }> {
    const embedding = vec ?? (await this.embedder.embed([`${c.subject}: ${c.claim}`]))[0]!;
    const current = this.db
      .prepare("SELECT id, claim, source FROM facts WHERE subject = ? AND attribute = ? AND valid_to IS NULL")
      .all(c.subject, c.attribute) as CurrentFact[];

    let verdict: GateVerdict;
    if (c.claim.trim().length < 3 || VAGUE.test(c.claim.trim()) || !c.subject.trim()) {
      verdict = { kind: "rejected", reason: "not specific enough" };
    } else {
      const same = current.find((f) => norm(f.claim) === norm(c.claim));
      const near = same ? undefined : this.nearDuplicate(c.subject, embedding);
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

  private nearDuplicate(subject: string, vec: Float32Array): number | undefined {
    const rows = this.db
      .prepare(
        `SELECT f.id, v.distance FROM vec_facts v JOIN facts f ON f.id = v.rowid
         WHERE v.embedding MATCH ? AND k = 8 AND f.valid_to IS NULL AND f.subject = ?
         ORDER BY v.distance LIMIT 1`,
      )
      .all(vec, subject) as { id: number; distance: number }[];
    const hit = rows[0];
    return hit && hit.distance * hit.distance < NEAR_DUPLICATE ? hit.id : undefined;
  }

  /** Gate a candidate fact and apply the verdict. Old facts are superseded, never overwritten. */
  async writeFact(c: CandidateFact, episodeId?: number): Promise<WriteResult> {
    const { verdict, vec } = await this.gate(c);
    const now = this.now();
    switch (verdict.kind) {
      case "rejected":
        return { verdict };
      case "duplicate":
        this.db.prepare("UPDATE facts SET last_checked = ?, confidence = MAX(confidence, ?) WHERE id = ?").run(now, c.confidence ?? 0.7, verdict.of);
        return { verdict, factId: verdict.of };
      case "contradicts": {
        const info = this.db
          .prepare("INSERT INTO review_queue (ts, kind, payload) VALUES (?, 'contradiction', ?)")
          .run(now, JSON.stringify({ existing: verdict.existing, candidate: c, episodeId: episodeId ?? null }));
        return { verdict, reviewId: Number(info.lastInsertRowid) };
      }
      case "new":
      case "update": {
        const tx = this.db.transaction(() => {
          const info = this.db
            .prepare(
              `INSERT INTO facts (subject, attribute, claim, source, confidence, valid_from, episode_id, last_checked)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(c.subject, c.attribute, c.claim.trim(), c.source, c.confidence ?? (c.source === "stated" ? 0.95 : 0.7), now, episodeId ?? null, now);
          const id = Number(info.lastInsertRowid);
          this.db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(id), vec);
          if (verdict.kind === "update") {
            this.db.prepare("UPDATE facts SET valid_to = ?, superseded_by = ? WHERE id = ?").run(now, id, verdict.replaces);
          }
          return id;
        });
        return { verdict, factId: tx() };
      }
    }
  }

  /** The owner resolves a contradiction: keep the existing fact, or accept the new claim as stated. */
  async resolveContradiction(reviewId: number, accept: boolean): Promise<WriteResult | null> {
    const row = this.db.prepare("SELECT payload, status FROM review_queue WHERE id = ? AND kind = 'contradiction'").get(reviewId) as
      | { payload: string; status: string }
      | undefined;
    if (!row || row.status !== "open") return null;
    this.db.prepare("UPDATE review_queue SET status = 'resolved' WHERE id = ?").run(reviewId);
    if (!accept) return null;
    const p = JSON.parse(row.payload) as { existing: number; candidate: CandidateFact; episodeId: number | null };
    const now = this.now();
    const vec = (await this.embedder.embed([`${p.candidate.subject}: ${p.candidate.claim}`]))[0]!;
    const id = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO facts (subject, attribute, claim, source, confidence, valid_from, episode_id, last_checked)
           VALUES (?, ?, ?, 'stated', 0.95, ?, ?, ?)`,
        )
        .run(p.candidate.subject, p.candidate.attribute, p.candidate.claim, now, p.episodeId, now);
      const newId = Number(info.lastInsertRowid);
      this.db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(newId), vec);
      this.db.prepare("UPDATE facts SET valid_to = ?, superseded_by = ? WHERE id = ?").run(now, newId, p.existing);
      return newId;
    })();
    return { verdict: { kind: "update", replaces: p.existing }, factId: id };
  }

  addEdge(from: string, relation: string, to: string): number {
    const existing = this.db
      .prepare("SELECT id FROM edges WHERE from_subj = ? AND relation = ? AND to_subj = ? AND valid_to IS NULL")
      .get(from, relation, to) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(this.db.prepare("INSERT INTO edges (from_subj, relation, to_subj, valid_from) VALUES (?, ?, ?, ?)").run(from, relation, to, this.now()).lastInsertRowid);
  }

  endEdge(id: number): void {
    this.db.prepare("UPDATE edges SET valid_to = ? WHERE id = ? AND valid_to IS NULL").run(this.now(), id);
  }

  /** /forget: the fact and its history are removed, not softened. */
  forgetSubject(subject: string): number {
    const ids = (this.db.prepare("SELECT id FROM facts WHERE subject = ?").all(subject) as { id: number }[]).map((r) => r.id);
    this.db.transaction(() => {
      this.db.prepare("UPDATE facts SET superseded_by = NULL WHERE subject = ?").run(subject);
      for (const id of ids) {
        this.db.prepare("DELETE FROM vec_facts WHERE rowid = ?").run(BigInt(id));
        this.db.prepare("DELETE FROM facts WHERE id = ?").run(id);
      }
      this.db.prepare("DELETE FROM edges WHERE from_subj = ? OR to_subj = ?").run(subject, subject);
    })();
    return ids.length;
  }

  recordFeedback(f: { actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before?: string; after?: string; reason?: string }): number {
    return Number(
      this.db
        .prepare("INSERT INTO feedback (ts, action_id, agent, verdict, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(this.now(), f.actionId, f.agent, f.verdict, f.before ?? null, f.after ?? null, f.reason ?? null).lastInsertRowid,
    );
  }

  openReviews(): { id: number; kind: string; payload: unknown }[] {
    return (this.db.prepare("SELECT id, kind, payload FROM review_queue WHERE status = 'open' ORDER BY id").all() as { id: number; kind: string; payload: string }[]).map(
      (r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) }),
    );
  }
}
