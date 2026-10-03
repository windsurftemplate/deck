import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HashEmbedder, MemoryReader, MemoryWriter, openMemory, type CandidateFact, type Embedder } from "@deck/memory";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Question {
  id: string;
  q: string;
  expect: string[];
  forbid?: string[];
}
type Step = { episode: { agent: string; kind: string; summary: string } } | { fact: CandidateFact } | { edge: [string, string, string] };

export interface EvalReport {
  suite: string;
  score: number;
  passed: number;
  total: number;
  results: { id: string; pass: boolean; missing: string[]; forbidden: string[] }[];
}

/**
 * Retrieval eval: load the fixtures through the real write path, ask each question,
 * and check the expected facts are recalled and forbidden (outdated) ones are not.
 */
export async function runMemoryEvals(embedder: Embedder = new HashEmbedder(64), topN = 6): Promise<EvalReport> {
  const db = openMemory({ path: ":memory:", key: "evals-only-not-a-secret", dim: embedder.dim });
  let t = Date.parse("2026-09-01T09:00:00Z");
  const w = new MemoryWriter(db, embedder, () => new Date((t += 3_600_000)));
  const r = new MemoryReader(db, embedder);
  const fx = JSON.parse(readFileSync(join(root, "fixtures/memory.json"), "utf8")) as { steps: Step[] };
  let episode: number | undefined;
  for (const s of fx.steps) {
    if ("episode" in s) episode = await w.logEpisode(s.episode);
    else if ("fact" in s) await w.writeFact(s.fact, episode);
    else w.addEdge(...s.edge);
  }
  const questions = JSON.parse(readFileSync(join(root, "memory/questions.json"), "utf8")) as Question[];
  const results = [];
  for (const q of questions) {
    const text = (await r.retrieve(q.q, { k: topN }))
      .slice(0, topN)
      .map((m) => m.text)
      .join("\n");
    const missing = q.expect.filter((e) => !text.includes(e));
    const forbidden = (q.forbid ?? []).filter((f) => text.includes(f));
    results.push({ id: q.id, pass: !missing.length && !forbidden.length, missing, forbidden });
  }
  db.close();
  const passed = results.filter((x) => x.pass).length;
  return { suite: "memory", score: passed / results.length, passed, total: results.length, results };
}

export function loadBaseline(): Record<string, number> {
  return JSON.parse(readFileSync(join(root, "baseline.json"), "utf8")) as Record<string, number>;
}
