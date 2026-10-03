import { openMemory, type DB, type OpenOptions } from "./db.js";
import { ftsQuery } from "./fts.js";
import type { MemoryDump, MemoryStore, NewDocument, StoredChunk, StoredDocument, NewFact, SkillStatus, StoredEdge, StoredEpisode, StoredFact, StoredFactRef, StoredSkill } from "./store.js";
import type { EpisodeInput } from "./types.js";

/** SQLite adapter: SQLCipher-encrypted file, sqlite-vec for vectors, FTS5 for keywords. */
export class SqliteMemoryStore implements MemoryStore {
  readonly engine = "sqlite";
  readonly dim: number;
  private db: DB;

  constructor(opts: OpenOptions) {
    this.db = openMemory(opts);
    this.dim = opts.dim;
  }

  /** The raw connection, for packages that share the workspace file (the tracker). */
  get connection(): DB {
    return this.db;
  }

  async addEpisode(e: EpisodeInput, ts: string, vec: Float32Array) {
    return this.db.transaction(() => {
      const id = Number(
        this.db.prepare("INSERT INTO episodes (ts, agent, task_id, kind, summary, raw_ref, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)").run(ts, e.agent, e.taskId ?? null, e.kind, e.summary, e.rawRef ?? null, e.outcome ?? null).lastInsertRowid,
      );
      this.db.prepare("INSERT INTO vec_episodes (rowid, embedding) VALUES (?, ?)").run(BigInt(id), vec);
      return id;
    })();
  }

  async currentFacts(subject: string, attribute: string) {
    return this.db.prepare("SELECT id, claim, source FROM facts WHERE subject = ? AND attribute = ? AND valid_to IS NULL").all(subject, attribute) as StoredFactRef[];
  }

  async nearestCurrentFact(subject: string, vec: Float32Array) {
    const rows = this.db
      .prepare(`SELECT f.id, v.distance FROM vec_facts v JOIN facts f ON f.id = v.rowid WHERE v.embedding MATCH ? AND k = 8 AND f.valid_to IS NULL AND f.subject = ? ORDER BY v.distance LIMIT 1`)
      .all(vec, subject) as { id: number; distance: number }[];
    return rows[0];
  }

  async insertFact(f: NewFact, vec: Float32Array, ts: string, supersedes?: number) {
    return this.db.transaction(() => {
      const id = Number(
        this.db
          .prepare(`INSERT INTO facts (subject, attribute, claim, source, confidence, valid_from, episode_id, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(f.subject, f.attribute, f.claim, f.source, f.confidence, ts, f.episodeId ?? null, ts).lastInsertRowid,
      );
      this.db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(id), vec);
      if (supersedes !== undefined) {
        this.db.prepare("UPDATE facts SET valid_to = ?, superseded_by = ? WHERE id = ?").run(ts, id, supersedes);
        // Old versions keep their text for history but leave the vector index, so search stays small.
        this.db.prepare("DELETE FROM vec_facts WHERE rowid = ?").run(BigInt(supersedes));
      }
      return id;
    })();
  }

  async touchFact(id: number, ts: string, confidence: number) {
    this.db.prepare("UPDATE facts SET last_checked = ?, confidence = MAX(confidence, ?) WHERE id = ?").run(ts, confidence, id);
  }

  async currentClaims(subject: string) {
    return (this.db.prepare("SELECT claim FROM facts WHERE subject = ? AND valid_to IS NULL ORDER BY id").all(subject) as { claim: string }[]).map((r) => r.claim);
  }

  async forgetSubject(subject: string) {
    return this.db.transaction(() => {
      const ids = (this.db.prepare("SELECT id FROM facts WHERE subject = ?").all(subject) as { id: number }[]).map((r) => r.id);
      this.db.prepare("UPDATE facts SET superseded_by = NULL WHERE subject = ?").run(subject);
      for (const id of ids) {
        this.db.prepare("DELETE FROM vec_facts WHERE rowid = ?").run(BigInt(id));
        this.db.prepare("DELETE FROM facts WHERE id = ?").run(id);
      }
      this.db.prepare("DELETE FROM edges WHERE from_subj = ? OR to_subj = ?").run(subject, subject);
      return ids.length;
    })();
  }

  async addReview(kind: string, payload: unknown, ts: string) {
    return Number(this.db.prepare("INSERT INTO review_queue (ts, kind, payload) VALUES (?, ?, ?)").run(ts, kind, JSON.stringify(payload)).lastInsertRowid);
  }

  async takeReview(id: number) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT kind, payload FROM review_queue WHERE id = ? AND status = 'open'").get(id) as { kind: string; payload: string } | undefined;
      if (!row) return null;
      this.db.prepare("UPDATE review_queue SET status = 'resolved' WHERE id = ?").run(id);
      return { kind: row.kind, payload: JSON.parse(row.payload) as unknown };
    })();
  }

  async openReviews() {
    return (this.db.prepare("SELECT id, kind, payload FROM review_queue WHERE status = 'open' ORDER BY id").all() as { id: number; kind: string; payload: string }[]).map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) as unknown }));
  }

  async addEdge(from: string, relation: string, to: string, ts: string) {
    const existing = this.db.prepare("SELECT id FROM edges WHERE from_subj = ? AND relation = ? AND to_subj = ? AND valid_to IS NULL").get(from, relation, to) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(this.db.prepare("INSERT INTO edges (from_subj, relation, to_subj, valid_from) VALUES (?, ?, ?, ?)").run(from, relation, to, ts).lastInsertRowid);
  }

  async endEdge(id: number, ts: string) {
    this.db.prepare("UPDATE edges SET valid_to = ? WHERE id = ? AND valid_to IS NULL").run(ts, id);
  }

  async edgesFor(subject: string, limit: number) {
    return this.db.prepare("SELECT id, from_subj AS \"from\", relation, to_subj AS \"to\" FROM edges WHERE (from_subj = ? OR to_subj = ?) AND valid_to IS NULL ORDER BY id LIMIT ?").all(subject, subject, limit) as StoredEdge[];
  }

  async addFeedback(f: { ts: string; actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before?: string; after?: string; reason?: string }) {
    return Number(this.db.prepare("INSERT INTO feedback (ts, action_id, agent, verdict, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?)").run(f.ts, f.actionId, f.agent, f.verdict, f.before ?? null, f.after ?? null, f.reason ?? null).lastInsertRowid);
  }

  async searchFactsByVector(vec: Float32Array, k: number) {
    return this.db
      .prepare(`SELECT f.id, f.subject, f.claim, f.source FROM vec_facts v JOIN facts f ON f.id = v.rowid WHERE v.embedding MATCH ? AND k = ? AND f.valid_to IS NULL ORDER BY v.distance`)
      .all(vec, k) as StoredFact[];
  }

  async searchFactsByText(text: string, k: number) {
    const q = ftsQuery(text);
    if (!q) return [];
    return this.db
      .prepare(`SELECT f.id, f.subject, f.claim, f.source FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid WHERE facts_fts MATCH ? AND f.valid_to IS NULL ORDER BY bm25(facts_fts) LIMIT ?`)
      .all(q, k) as StoredFact[];
  }

  async searchEpisodesByVector(vec: Float32Array, k: number) {
    return this.db.prepare(`SELECT e.id, e.ts, e.summary FROM vec_episodes v JOIN episodes e ON e.id = v.rowid WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance`).all(vec, k) as StoredEpisode[];
  }

  async searchEpisodesByText(text: string, k: number) {
    const q = ftsQuery(text);
    if (!q) return [];
    return this.db.prepare(`SELECT e.id, e.ts, e.summary FROM episodes_fts JOIN episodes e ON e.id = episodes_fts.rowid WHERE episodes_fts MATCH ? ORDER BY bm25(episodes_fts) LIMIT ?`).all(q, k) as StoredEpisode[];
  }

  private docTables() {
    if (this.docsReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS doc_chunks (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id), seq INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS doc_chunks_by_doc ON doc_chunks(doc_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(text, content='doc_chunks', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN INSERT INTO doc_chunks_fts(rowid, text) VALUES (new.id, new.text); END;
      CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${this.dim}]);`);
    this.docsReady = true;
  }
  private docsReady = false;
  private insertChunks(docId: number, chunks: { text: string; vec: Float32Array }[]) {
    chunks.forEach((c, i) => {
      const id = Number(this.db.prepare("INSERT INTO doc_chunks (doc_id, seq, text) VALUES (?, ?, ?)").run(docId, i, c.text).lastInsertRowid);
      this.db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)").run(BigInt(id), c.vec);
    });
  }
  private dropChunks(docId: number) {
    for (const r of this.db.prepare("SELECT id FROM doc_chunks WHERE doc_id = ?").all(docId) as { id: number }[]) this.db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(r.id));
    this.db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?").run(docId);
  }
  async addDocument(d: NewDocument, chunks: { text: string; vec: Float32Array }[], ts: string) {
    this.docTables();
    return this.db.transaction(() => {
      const id = Number(this.db.prepare("INSERT INTO documents (title, kind, source, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(d.title, d.kind, d.source, d.text, ts, ts).lastInsertRowid);
      this.insertChunks(id, chunks);
      return id;
    })();
  }
  async updateDocument(id: number, d: Partial<Pick<NewDocument, "title" | "text">>, chunks: { text: string; vec: Float32Array }[] | null, ts: string) {
    this.docTables();
    this.db.transaction(() => {
      if (d.title !== undefined) this.db.prepare("UPDATE documents SET title = ? WHERE id = ?").run(d.title, id);
      if (d.text !== undefined) this.db.prepare("UPDATE documents SET text = ? WHERE id = ?").run(d.text, id);
      this.db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(ts, id);
      if (chunks) (this.dropChunks(id), this.insertChunks(id, chunks));
    })();
  }
  async documents(kind?: string) {
    this.docTables();
    return (this.db.prepare(`SELECT id, title, kind, source, length(text) AS chars, created_at, updated_at FROM documents ${kind ? "WHERE kind = ?" : ""} ORDER BY updated_at DESC`).all(...(kind ? [kind] : [])) as { id: number; title: string; kind: string; source: string; chars: number; created_at: string; updated_at: string }[]).map((r) => ({ id: r.id, title: r.title, kind: r.kind, source: r.source, chars: r.chars, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  async document(id: number) {
    this.docTables();
    const r = this.db.prepare("SELECT id, title, kind, source, text, created_at, updated_at FROM documents WHERE id = ?").get(id) as { id: number; title: string; kind: string; source: string; text: string; created_at: string; updated_at: string } | undefined;
    return r && { id: r.id, title: r.title, kind: r.kind, source: r.source, text: r.text, chars: r.text.length, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  async deleteDocument(id: number) {
    this.docTables();
    this.db.transaction(() => (this.dropChunks(id), this.db.prepare("DELETE FROM documents WHERE id = ?").run(id)))();
  }
  async searchChunksByVector(vec: Float32Array, k: number) {
    this.docTables();
    return this.db.prepare("SELECT c.id, c.doc_id AS docId, d.title, d.kind, c.text FROM vec_chunks v JOIN doc_chunks c ON c.id = v.rowid JOIN documents d ON d.id = c.doc_id WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance").all(vec, k) as StoredChunk[];
  }
  async searchChunksByText(text: string, k: number) {
    this.docTables();
    const q = ftsQuery(text);
    if (!q) return [];
    return this.db.prepare("SELECT c.id, c.doc_id AS docId, d.title, d.kind, c.text FROM doc_chunks_fts JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid JOIN documents d ON d.id = c.doc_id WHERE doc_chunks_fts MATCH ? ORDER BY bm25(doc_chunks_fts) LIMIT ?").all(q, k) as StoredChunk[];
  }
  async graph() {
    const facts = this.db.prepare("SELECT id, subject, claim, source FROM facts WHERE valid_to IS NULL").all() as StoredFact[];
    const edges = this.db.prepare(`SELECT id, from_subj AS "from", relation, to_subj AS "to" FROM edges WHERE valid_to IS NULL`).all() as StoredEdge[];
    return { facts, edges };
  }

  async getMeta(key: string) {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(`app.${key}`) as { value: string } | undefined)?.value ?? null;
  }
  async setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`app.${key}`, value);
  }
  async episodesSince(afterId: number, limit: number) {
    return this.db.prepare("SELECT id, ts, summary, agent, kind FROM episodes WHERE id > ? ORDER BY id LIMIT ?").all(afterId, limit) as (StoredEpisode & { agent: string; kind: string })[];
  }
  async feedbackSince(afterId: number) {
    return (this.db.prepare("SELECT id, ts, action_id, agent, verdict, reason FROM feedback WHERE id > ? ORDER BY id").all(afterId) as { id: number; ts: string; action_id: string; agent: string; verdict: "approve" | "reject" | "edit"; reason: string | null }[]).map((f) => ({ id: f.id, ts: f.ts, actionId: f.action_id, agent: f.agent, verdict: f.verdict, reason: f.reason }));
  }
  private skillRow = (r: { name: string; version: number; description: string; body: string; status: SkillStatus; successes: number; failures: number; created_at: string }): StoredSkill => ({ name: r.name, version: r.version, description: r.description, body: r.body, status: r.status, successes: r.successes, failures: r.failures, createdAt: r.created_at });
  async saveSkill(sk: { name: string; description: string; body: string }, ts: string) {
    return this.db.transaction(() => {
      const v = ((this.db.prepare("SELECT MAX(version) v FROM skills WHERE name = ?").get(sk.name) as { v: number | null }).v ?? 0) + 1;
      this.db.prepare("INSERT INTO skills (name, version, description, body, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)").run(sk.name, v, sk.description, sk.body, ts);
      return { name: sk.name, version: v, description: sk.description, body: sk.body, status: "draft" as const, successes: 0, failures: 0, createdAt: ts };
    })();
  }
  /** Latest version of each skill. */
  async skills(status?: SkillStatus) {
    const rows = this.db.prepare("SELECT s.* FROM skills s JOIN (SELECT name, MAX(version) v FROM skills GROUP BY name) m ON m.name = s.name AND m.v = s.version ORDER BY s.name").all() as Parameters<typeof this.skillRow>[0][];
    return rows.map(this.skillRow).filter((x) => !status || x.status === status);
  }
  async skill(name: string) {
    return (await this.skills()).find((x) => x.name === name);
  }
  async setSkillStatus(name: string, status: SkillStatus) {
    this.db.prepare("UPDATE skills SET status = ? WHERE name = ? AND version = (SELECT MAX(version) FROM skills WHERE name = ?)").run(status, name, name);
  }
  async recordSkillOutcome(name: string, success: boolean) {
    this.db.prepare(`UPDATE skills SET ${success ? "successes = successes + 1" : "failures = failures + 1"} WHERE name = ? AND version = (SELECT MAX(version) FROM skills WHERE name = ?)`).run(name, name);
  }

  async exportAll(withVectors: boolean): Promise<MemoryDump> {
    const vecOf = (table: "vec_facts" | "vec_episodes", id: number) => {
      if (!withVectors) return undefined;
      const r = this.db.prepare(`SELECT embedding FROM ${table} WHERE rowid = ?`).get(BigInt(id)) as { embedding: Buffer } | undefined;
      return r ? Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)) : undefined;
    };
    type E = { id: number; ts: string; agent: string; task_id: string | null; kind: string; summary: string; raw_ref: string | null; outcome: string | null };
    type F = { id: number; subject: string; attribute: string; claim: string; source: "stated" | "inferred"; confidence: number; valid_from: string; valid_to: string | null; superseded_by: number | null; episode_id: number | null; last_checked: string };
    return {
      format: "deck-memory",
      version: 1,
      dim: this.dim,
      episodes: (this.db.prepare("SELECT * FROM episodes ORDER BY id").all() as E[]).map((e) => ({ id: e.id, ts: e.ts, agent: e.agent, taskId: e.task_id, kind: e.kind, summary: e.summary, rawRef: e.raw_ref, outcome: e.outcome, ...((v) => (v ? { vec: v } : {}))(vecOf("vec_episodes", e.id)) })),
      facts: (this.db.prepare("SELECT * FROM facts ORDER BY id").all() as F[]).map((f) => {
        const v = f.valid_to === null ? vecOf("vec_facts", f.id) : undefined;
        return { id: f.id, subject: f.subject, attribute: f.attribute, claim: f.claim, source: f.source, confidence: f.confidence, validFrom: f.valid_from, validTo: f.valid_to, supersededBy: f.superseded_by, episodeId: f.episode_id, lastChecked: f.last_checked, ...(v ? { vec: v } : {}) };
      }),
      edges: (this.db.prepare("SELECT id, from_subj, relation, to_subj, valid_from, valid_to FROM edges ORDER BY id").all() as { id: number; from_subj: string; relation: string; to_subj: string; valid_from: string; valid_to: string | null }[]).map((e) => ({ id: e.id, from: e.from_subj, relation: e.relation, to: e.to_subj, validFrom: e.valid_from, validTo: e.valid_to })),
      reviews: (this.db.prepare("SELECT id, ts, kind, payload, status FROM review_queue ORDER BY id").all() as { id: number; ts: string; kind: string; payload: string; status: "open" | "resolved" }[]).map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown })),
      skills: (this.db.prepare("SELECT * FROM skills ORDER BY name, version").all() as Parameters<typeof this.skillRow>[0][]).map(this.skillRow),
      meta: Object.fromEntries((this.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'app.%'").all() as { key: string; value: string }[]).map((r) => [r.key.slice(4), r.value])),
      feedback: (this.db.prepare("SELECT id, ts, action_id, agent, verdict, before, after, reason FROM feedback ORDER BY id").all() as { id: number; ts: string; action_id: string; agent: string; verdict: "approve" | "reject" | "edit"; before: string | null; after: string | null; reason: string | null }[]).map((f) => ({ id: f.id, ts: f.ts, actionId: f.action_id, agent: f.agent, verdict: f.verdict, before: f.before, after: f.after, reason: f.reason })),
    };
  }

  async importAll(d: MemoryDump) {
    checkDump(d, this.dim);
    const empty = (this.db.prepare("SELECT (SELECT count(*) FROM facts) + (SELECT count(*) FROM episodes) AS n").get() as { n: number }).n === 0;
    if (!empty) throw new Error("memory: import needs an empty store");
    this.db.transaction(() => {
      for (const e of d.episodes) {
        this.db.prepare("INSERT INTO episodes (id, ts, agent, task_id, kind, summary, raw_ref, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(e.id, e.ts, e.agent, e.taskId, e.kind, e.summary, e.rawRef, e.outcome);
        if (e.vec) this.db.prepare("INSERT INTO vec_episodes (rowid, embedding) VALUES (?, ?)").run(BigInt(e.id), new Float32Array(e.vec));
      }
      for (const f of d.facts) {
        this.db.prepare("INSERT INTO facts (id, subject, attribute, claim, source, confidence, valid_from, valid_to, superseded_by, episode_id, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)").run(f.id, f.subject, f.attribute, f.claim, f.source, f.confidence, f.validFrom, f.validTo, f.episodeId, f.lastChecked);
        if (f.vec && f.validTo === null) this.db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(f.id), new Float32Array(f.vec));
      }
      for (const f of d.facts) if (f.supersededBy !== null) this.db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?").run(f.supersededBy, f.id);
      for (const e of d.edges) this.db.prepare("INSERT INTO edges (id, from_subj, relation, to_subj, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?)").run(e.id, e.from, e.relation, e.to, e.validFrom, e.validTo);
      for (const r of d.reviews) this.db.prepare("INSERT INTO review_queue (id, ts, kind, payload, status) VALUES (?, ?, ?, ?, ?)").run(r.id, r.ts, r.kind, JSON.stringify(r.payload), r.status);
      for (const k of d.skills ?? []) this.db.prepare("INSERT INTO skills (name, version, description, body, status, successes, failures, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(k.name, k.version, k.description, k.body, k.status, k.successes, k.failures, k.createdAt);
      for (const [k, v] of Object.entries(d.meta ?? {})) this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(`app.${k}`, v);
      for (const f of d.feedback) this.db.prepare("INSERT INTO feedback (id, ts, action_id, agent, verdict, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(f.id, f.ts, f.actionId, f.agent, f.verdict, f.before, f.after, f.reason);
    })();
  }

  async setVector(kind: "fact" | "episode", id: number, vec: Float32Array) {
    if (vec.length !== this.dim) throw new Error("memory: vector has the wrong length");
    const table = kind === "fact" ? "vec_facts" : "vec_episodes";
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(BigInt(id));
      this.db.prepare(`INSERT INTO ${table} (rowid, embedding) VALUES (?, ?)`).run(BigInt(id), vec);
    })();
  }

  async close() {
    this.db.close();
  }
}

export function checkDump(d: MemoryDump, dim: number) {
  if (d.format !== "deck-memory" || d.version !== 1) throw new Error("memory: unknown dump format or version");
  const withVec = [...d.facts, ...d.episodes].filter((x) => x.vec);
  if (withVec.length && d.dim !== dim) throw new Error(`memory: dump has ${d.dim}-dim vectors but this store uses ${dim}; import without vectors and re-embed`);
  if (withVec.some((x) => x.vec!.length !== dim)) throw new Error("memory: a vector in the dump has the wrong length");
}
