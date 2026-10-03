/** Turns text into a vector. In the app this calls the embedding model through the Gateway. */
export interface Embedder {
  dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export type FactSource = "stated" | "inferred";

export interface Fact {
  id: number;
  subject: string;
  attribute: string;
  claim: string;
  source: FactSource;
  confidence: number;
  validFrom: string;
  validTo: string | null;
}

export interface CandidateFact {
  subject: string;
  attribute: string;
  claim: string;
  source: FactSource;
  confidence?: number;
}

export type GateVerdict =
  | { kind: "new" }
  | { kind: "duplicate"; of: number }
  | { kind: "update"; replaces: number }
  | { kind: "contradicts"; existing: number }
  | { kind: "rejected"; reason: string };

export interface EpisodeInput {
  agent: string;
  kind: string;
  summary: string;
  taskId?: string;
  rawRef?: string;
  outcome?: string;
}

export interface Memory {
  id: string;
  kind: "fact" | "episode" | "edge" | "doc";
  text: string;
  score: number;
}

/** Clock is injectable so tests control time. */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
