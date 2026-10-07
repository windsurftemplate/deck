import { ftsQuery, type DB } from "@deck/memory";
import { identifierWords } from "./chunk.js";
import type { ChunkToStore, CodeIndexStore, IndexedFile, StoredCodeChunk } from "./store.js";

const COLS = "c.id, c.path, c.name, c.qualified, c.kind, c.start_line AS startLine, c.end_line AS endLine, c.signature, c.text, c.hash, c.commit_id AS 'commit'";

/**
 * SQLite adapter. Lives in the encrypted workspace file (pass the memory store's connection), with FTS5 for
 * keywords and sqlite-vec for meaning. The index is a cache of the code: when the vector size changes it is
 * emptied and rebuilt from the files.
 */
export class SqliteCodeIndexStore implements CodeIndexStore {
  constructor(
    private db: DB,
    private vecDim: number | null,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS code_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS code_files (project TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, commit_id TEXT, size INTEGER NOT NULL, mtime REAL NOT NULL, PRIMARY KEY (project, path));
      CREATE TABLE IF NOT EXISTS code_chunks (id INTEGER PRIMARY KEY, project TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, qualified TEXT NOT NULL, kind TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, signature TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, commit_id TEXT, words TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS code_chunks_file ON code_chunks (project, path);
      CREATE INDEX IF NOT EXISTS code_chunks_name ON code_chunks (project, name COLLATE NOCASE);
      CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(name, words, signature, text);
    `);
    const stored = (db.prepare("SELECT value FROM code_meta WHERE key = 'dim'").get() as { value: string } | undefined)?.value;
    const want = vecDim === null ? "none" : String(vecDim);
    if (stored !== undefined && stored !== want) {
      // A different embedding model: the old vectors mean nothing now. Start the cache over.
      db.exec("DELETE FROM code_files; DELETE FROM code_chunks; DELETE FROM code_fts; DROP TABLE IF EXISTS vec_code;");
    }
    if (vecDim !== null) db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_code USING vec0(embedding float[${vecDim}])`);
    db.prepare("INSERT INTO code_meta (key, value) VALUES ('dim', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(want);
  }

  async dim() {
    return this.vecDim;
  }

  async files(project: string) {
    return (this.db.prepare("SELECT path, hash, commit_id AS 'commit', size, mtime AS mtimeMs FROM code_files WHERE project = ? ORDER BY path").all(project) as IndexedFile[]).map((f) => ({ ...f, commit: f.commit ?? null }));
  }

  private dropChunks(project: string, path: string) {
    for (const r of this.db.prepare("SELECT id FROM code_chunks WHERE project = ? AND path = ?").all(project, path) as { id: number }[]) {
      this.db.prepare("DELETE FROM code_fts WHERE rowid = ?").run(r.id);
      if (this.vecDim !== null) this.db.prepare("DELETE FROM vec_code WHERE rowid = ?").run(BigInt(r.id));
    }
    this.db.prepare("DELETE FROM code_chunks WHERE project = ? AND path = ?").run(project, path);
  }

  async putFile(project: string, file: IndexedFile, chunks: ChunkToStore[]) {
    this.db.transaction(() => {
      this.dropChunks(project, file.path);
      this.db.prepare("INSERT INTO code_files (project, path, hash, commit_id, size, mtime) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project, path) DO UPDATE SET hash = excluded.hash, commit_id = excluded.commit_id, size = excluded.size, mtime = excluded.mtime").run(project, file.path, file.hash, file.commit, file.size, file.mtimeMs);
      for (const c of chunks) {
        const id = Number(
          this.db.prepare("INSERT INTO code_chunks (project, path, name, qualified, kind, start_line, end_line, signature, text, hash, commit_id, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(project, file.path, c.name, c.qualified, c.kind, c.startLine, c.endLine, c.signature, c.text, file.hash, file.commit, c.words).lastInsertRowid,
        );
        this.db.prepare("INSERT INTO code_fts (rowid, name, words, signature, text) VALUES (?, ?, ?, ?, ?)").run(id, c.name, c.words, c.signature, c.text);
        if (c.vec && this.vecDim !== null) {
          if (c.vec.length !== this.vecDim) throw new Error(`code index: vector has ${c.vec.length} dimensions, expected ${this.vecDim}`);
          this.db.prepare("INSERT INTO vec_code (rowid, embedding) VALUES (?, ?)").run(BigInt(id), c.vec);
        }
      }
    })();
  }

  async touchFile(project: string, path: string, size: number, mtimeMs: number) {
    this.db.prepare("UPDATE code_files SET size = ?, mtime = ? WHERE project = ? AND path = ?").run(size, mtimeMs, project, path);
  }

  async removeFile(project: string, path: string) {
    this.db.transaction(() => {
      this.dropChunks(project, path);
      this.db.prepare("DELETE FROM code_files WHERE project = ? AND path = ?").run(project, path);
    })();
  }

  async byName(project: string, name: string, limit: number) {
    const n = name.trim();
    if (!n) return [];
    const exact = this.db.prepare(`SELECT ${COLS} FROM code_chunks c WHERE c.project = ? AND (c.name = ? COLLATE NOCASE OR c.qualified = ? COLLATE NOCASE) ORDER BY c.kind = 'file', c.path, c.start_line LIMIT ?`).all(project, n, n, limit) as StoredCodeChunk[];
    if (exact.length >= limit) return exact;
    const like = `%${n.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const partial = this.db.prepare(`SELECT ${COLS} FROM code_chunks c WHERE c.project = ? AND c.kind != 'file' AND (c.name LIKE ? ESCAPE '\\' OR c.qualified LIKE ? ESCAPE '\\') ORDER BY length(c.name), c.path LIMIT ?`).all(project, like, like, limit) as StoredCodeChunk[];
    const seen = new Set(exact.map((c) => c.id));
    return [...exact, ...partial.filter((c) => !seen.has(c.id))].slice(0, limit);
  }

  async byKeyword(project: string, query: string, limit: number) {
    const q = ftsQuery(`${identifierWords(query)} ${query}`);
    if (!q) return [];
    return this.db.prepare(`SELECT ${COLS} FROM code_fts JOIN code_chunks c ON c.id = code_fts.rowid WHERE code_fts MATCH ? AND c.project = ? ORDER BY bm25(code_fts, 8.0, 4.0, 2.0, 1.0) LIMIT ?`).all(q, project, limit) as StoredCodeChunk[];
  }

  async byVector(project: string, vec: Float32Array, limit: number) {
    if (this.vecDim === null) return [];
    // Nearest across all projects first, then this project's (a vec0 search cannot filter by another table).
    const k = Math.min(400, limit * 8);
    return this.db.prepare(`SELECT ${COLS} FROM vec_code v JOIN code_chunks c ON c.id = v.rowid WHERE v.embedding MATCH ? AND k = ? AND c.project = ? ORDER BY v.distance LIMIT ?`).all(vec, k, project, limit) as StoredCodeChunk[];
  }

  async clear(project: string) {
    for (const f of await this.files(project)) await this.removeFile(project, f.path);
  }
}
