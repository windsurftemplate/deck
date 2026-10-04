import { HashEmbedder, type Embedder } from "@deck/memory";
import { runMemoryEvals } from "./memory-evals.js";
import { SAFETY_CASES, titleOf } from "./safety-evals.js";

export { runMemoryEvals, loadBaseline, type EvalReport } from "./memory-evals.js";
export { runSafetyEvals, SAFETY_CASES } from "./safety-evals.js";

/** One eval case and how it went. */
export interface EvalCase {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}
/** One suite's run: a score from 0 to 1, every case, how long it took and any tokens it used. */
export interface EvalSuiteResult {
  suite: string;
  title: string;
  score: number;
  passed: number;
  total: number;
  cases: EvalCase[];
  ms: number;
  tokens: number;
}

export const summarize = (suite: string, title: string, cases: EvalCase[], ms: number, tokens = 0): EvalSuiteResult => {
  const passed = cases.filter((c) => c.passed).length;
  return { suite, title, score: cases.length ? passed / cases.length : 0, passed, total: cases.length, cases, ms, tokens };
};

const MEMORY_TITLES: Record<string, string> = {
  "acme-timing": "Finds when something happened",
  "acme-security-contact": "Follows a relationship one hop",
  "team-price-current": "Returns the current price, not the outdated one",
  "latest-design-partner": "Picks the most recent of similar facts",
  "investor-rule": "Recalls a rule you stated",
};

/** Memory recall on a realistic fixture loaded through the real write path. No model calls. */
export async function memorySuite(embedder: Embedder = new HashEmbedder(64)): Promise<EvalSuiteResult> {
  const t0 = Date.now();
  const r = await runMemoryEvals(embedder);
  const cases = r.results.map((x) => ({
    id: x.id,
    title: MEMORY_TITLES[x.id] ?? x.id,
    passed: x.pass,
    detail: x.pass ? "Recalled the right facts." : [x.missing.length && `Missing: ${x.missing.join("; ")}`, x.forbidden.length && `Returned outdated: ${x.forbidden.join("; ")}`].filter(Boolean).join(". "),
  }));
  return summarize("memory", "Memory recall", cases, Date.now() - t0);
}

/** Safety with a model that fully obeys an attacker. No model calls. */
export async function safetySuite(): Promise<EvalSuiteResult> {
  const t0 = Date.now();
  const cases: EvalCase[] = [];
  for (const c of SAFETY_CASES) {
    let ok = false;
    let err = "";
    try {
      ok = await c.run();
    } catch (e) {
      err = (e as Error).message;
    }
    cases.push({ id: c.id, title: titleOf(c), passed: ok, detail: ok ? "Held: nothing harmful happened." : err ? `Crashed: ${err}` : "Failed: the protection did not hold." });
  }
  return summarize("safety", "Safety (compromised model)", cases, Date.now() - t0);
}
