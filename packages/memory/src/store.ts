import type { CandidateFact, EpisodeInput, FactSource } from "./types.js";

/**
 * Storage port for memory. The writer and reader only talk to this interface, so the database
 * can change (SQLite today; Postgres + pgvector, LanceDB or a server later) without touching
 * memory logic. Every method is atomic on its own; there is no cross-call transaction.
 * Every adapter must pass `memoryStoreContract` (contract.ts).
 */
export interface MemoryStore {
  readonly engine: string;
  readonly dim: number;

  addEpisode(e: EpisodeInput, ts: string, vec: Float32Array): Promise<number>;

  currentFacts(subject: string, attribute: string): Promise<StoredFactRef[]>;
  /** Closest current fact for the same subject, by vector distance (L2 on unit vectors). */
  nearestCurrentFact(subject: string, vec: Float32Array): Promise<{ id: number; distance: number } | undefined>;
  /** Insert a fact; if `supersedes` is set, close that fact in the same atomic step. */
  insertFact(f: NewFact, vec: Float32Array, ts: string, supersedes?: number): Promise<number>;
  touchFact(id: number, ts: string, confidence: number): Promise<void>;
  currentClaims(subject: string): Promise<string[]>;
  /** Removes every fact, vector and edge about a subject. Returns the number of facts removed. */
  forgetSubject(subject: string): Promise<number>;

  addReview(kind: string, payload: unknown, ts: string): Promise<number>;
  /** Marks an open review resolved and returns its payload, or null if missing or already resolved. */
  takeReview(id: number): Promise<{ kind: string; payload: unknown } | null>;
  openReviews(): Promise<{ id: number; kind: string; payload: unknown }[]>;

  addEdge(from: string, relation: string, to: string, ts: string): Promise<number>;
  endEdge(id: number, ts: string): Promise<void>;
  edgesFor(subject: string, limit: number): Promise<StoredEdge[]>;

  addFeedback(f: { ts: string; actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before?: string; after?: string; reason?: string }): Promise<number>;

  /** Current facts nearest to the vector. */
  searchFactsByVector(vec: Float32Array, k: number): Promise<StoredFact[]>;
  /** Current facts matching words in free text. The adapter sanitizes the text. */
  searchFactsByText(text: string, k: number): Promise<StoredFact[]>;
  searchEpisodesByVector(vec: Float32Array, k: number): Promise<StoredEpisode[]>;
  searchEpisodesByText(text: string, k: number): Promise<StoredEpisode[]>;

  /** Everything needed to move to another adapter. Vectors included when `withVectors` is true. */
  exportAll(withVectors: boolean): Promise<MemoryDump>;
  /** Load a dump into an empty store. Vectors must match `dim` if present. */
  importAll(dump: MemoryDump): Promise<void>;
  /** Set or replace one vector (used when re-embedding after a model change). */
  setVector(kind: "fact" | "episode", id: number, vec: Float32Array): Promise<void>;
  close(): Promise<void>;
}

export interface NewFact extends Omit<CandidateFact, "confidence"> {
  confidence: number;
  episodeId?: number;
}
export interface StoredFactRef {
  id: number;
  claim: string;
  source: FactSource;
}
export interface StoredFact extends StoredFactRef {
  subject: string;
}
export interface StoredEpisode {
  id: number;
  ts: string;
  summary: string;
}
export interface StoredEdge {
  id: number;
  from: string;
  relation: string;
  to: string;
}

/** Portable, engine-neutral snapshot. Version bumps when the shape changes. */
export interface MemoryDump {
  format: "deck-memory";
  version: 1;
  dim: number;
  episodes: { id: number; ts: string; agent: string; taskId: string | null; kind: string; summary: string; rawRef: string | null; outcome: string | null; vec?: number[] }[];
  facts: { id: number; subject: string; attribute: string; claim: string; source: FactSource; confidence: number; validFrom: string; validTo: string | null; supersededBy: number | null; episodeId: number | null; lastChecked: string; vec?: number[] }[];
  edges: { id: number; from: string; relation: string; to: string; validFrom: string; validTo: string | null }[];
  reviews: { id: number; ts: string; kind: string; payload: unknown; status: "open" | "resolved" }[];
  feedback: { id: number; ts: string; actionId: string; agent: string; verdict: "approve" | "reject" | "edit"; before: string | null; after: string | null; reason: string | null }[];
}
