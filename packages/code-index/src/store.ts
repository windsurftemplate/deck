import type { CodeChunk } from "./chunk.js";

/** What the index knows about one file: the content hash its chunks came from, and the commit at indexing time. */
export interface IndexedFile {
  path: string;
  /** sha256 of the file content. */
  hash: string;
  /** Commit checked out when the file was indexed, or null outside Git. */
  commit: string | null;
  size: number;
  mtimeMs: number;
}

export interface StoredCodeChunk extends CodeChunk {
  id: number;
  hash: string;
  commit: string | null;
}

/** Name and identifier words used for keyword search. */
export interface ChunkToStore extends CodeChunk {
  words: string;
  vec: Float32Array | null;
}

/** A fix that worked: the error, what changed, and the files as they were right after the fix. */
export interface FixRecord {
  id: number;
  /** The failing output (keys already removed), cut short. */
  error: string;
  /** Normalized error lines used to match a repeat (paths, numbers and ids removed). */
  signature: string;
  /** What fixed it, from the agent's report. */
  summary: string;
  /** Files changed by the fix, with their content hash right after it. */
  files: { path: string; hash: string }[];
  commit: string | null;
  testCommand: string | null;
  createdAt: string;
}

/**
 * Storage for the code index (a port). Every method is atomic on its own. A project is the absolute path of its
 * root folder; projects never see each other's entries.
 */
export interface CodeIndexStore {
  files(project: string): Promise<IndexedFile[]>;
  /** Replaces everything stored for one file (its record and all its chunks) in one step. */
  putFile(project: string, file: IndexedFile, chunks: ChunkToStore[]): Promise<void>;
  /** Updates a file's size and modified time when its content (hash) did not change. Chunks stay. */
  touchFile(project: string, path: string, size: number, mtimeMs: number): Promise<void>;
  removeFile(project: string, path: string): Promise<void>;
  /** Exact name or qualified name (case-insensitive) first, then names containing the text. */
  byName(project: string, name: string, limit: number): Promise<StoredCodeChunk[]>;
  /** Keyword search over names, identifier words, signatures and text. */
  byKeyword(project: string, query: string, limit: number): Promise<StoredCodeChunk[]>;
  /** Nearest by meaning. Chunks stored without a vector are never returned here. */
  byVector(project: string, vec: Float32Array, limit: number): Promise<StoredCodeChunk[]>;
  addFix(project: string, fix: Omit<FixRecord, "id">): Promise<number>;
  /** Newest first. */
  listFixes(project: string, limit: number): Promise<FixRecord[]>;
  /** Forgets a project entirely (its index and its fixes). */
  clear(project: string): Promise<void>;
  /** Vector size this store holds, or null when it has none yet. */
  dim(): Promise<number | null>;
}
