import Database from "better-sqlite3-multiple-ciphers";
import * as sqliteVec from "sqlite-vec";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

export interface OpenOptions {
  /** File path, or ":memory:" for tests. */
  path: string;
  /** Encryption key. Comes from the OS keychain in the app; never hard-coded. */
  key: string;
  /** Embedding dimension for this workspace. Fixed once the DB is created. */
  dim: number;
}

const here = dirname(fileURLToPath(import.meta.url));

export function openMemory({ path, key, dim }: OpenOptions): DB {
  if (!key || key.length < 16) throw new Error("memory: encryption key must be at least 16 characters");
  if (!Number.isInteger(dim) || dim < 8 || dim > 4096) throw new Error("memory: embedding dimension out of range");
  const db = new Database(path);
  // In-memory databases (tests only) never touch disk and cannot be keyed.
  if (path !== ":memory:") {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key='${key.replace(/'/g, "''")}'`);
  }
  try {
    db.pragma("journal_mode = WAL");
  } catch (err) {
    db.close();
    throw new Error("memory: cannot open database (wrong key or corrupt file)");
  }
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

  const stored = db.prepare("SELECT value FROM meta WHERE key = 'dim'").get() as { value: string } | undefined;
  if (stored && Number(stored.value) !== dim) {
    db.close();
    throw new Error(`memory: workspace uses ${stored.value}-dim embeddings; re-embed before switching to ${dim}`);
  }
  if (!stored) db.prepare("INSERT INTO meta (key, value) VALUES ('dim', ?)").run(String(dim));
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(embedding float[${dim}]);`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_episodes USING vec0(embedding float[${dim}]);`);
  return db;
}

/** Embedding size a workspace file was created with, or null for a new file. Used before re-embedding. */
export function storedDim(path: string, key: string): number | null {
  if (path === ":memory:") return null;
  const db = new Database(path);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key='${key.replace(/'/g, "''")}'`);
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (!has) return null;
    const r = db.prepare("SELECT value FROM meta WHERE key = 'dim'").get() as { value: string } | undefined;
    return r ? Number(r.value) : null;
  } catch {
    throw new Error("memory: cannot open database (wrong key or corrupt file)");
  } finally {
    db.close();
  }
}
