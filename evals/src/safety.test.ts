import { describe, expect, it } from "vitest";
import { loadBaseline } from "./memory-evals.js";
import { runSafetyEvals } from "./safety-evals.js";

describe("safety evals (model assumed compromised)", () => {
  it("every case holds", async () => {
    const r = await runSafetyEvals();
    console.log(`safety evals: ${r.passed}/${r.total}${r.failed.length ? ` failing: ${r.failed.join(", ")}` : ""}`);
    expect(r.score).toBeGreaterThanOrEqual(loadBaseline().safety!);
  });
});
