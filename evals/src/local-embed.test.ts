import { describe, expect, it } from "vitest";
import { LocalEmbedder } from "@deck/embed-local";
import { runMemoryEvals } from "./memory-evals.js";

describe.skipIf(process.env.DECK_SKIP_MODEL_TESTS === "1")("memory evals with the local embedding model", () => {
  it("passes every question", async () => {
    const report = await runMemoryEvals(new LocalEmbedder({ ...(process.env.DECK_MODEL_CACHE ? { cacheDir: process.env.DECK_MODEL_CACHE } : {}) }));
    console.log(`memory evals (local model): ${report.passed}/${report.total}` + report.results.filter((r) => !r.pass).map((r) => ` ${r.id} missing=[${r.missing}] forbidden=[${r.forbidden}]`).join(""));
    expect(report.score).toBe(1);
  }, 120_000);
});
