import { describe, expect, it } from "vitest";
import { loadBaseline, runMemoryEvals } from "./memory-evals.js";

describe("memory evals", () => {
  it("does not regress below the baseline", async () => {
    const report = await runMemoryEvals();
    const failed = report.results.filter((r) => !r.pass);
    console.log(`memory evals: ${report.passed}/${report.total} (${Math.round(report.score * 100)}%)` + (failed.length ? `\n  failing: ${failed.map((f) => `${f.id} missing=[${f.missing}] forbidden=[${f.forbidden}]`).join("; ")}` : ""));
    expect(report.score).toBeGreaterThanOrEqual(loadBaseline().memory!);
  });
});
