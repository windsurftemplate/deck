import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalEmbedder } from "./index.js";

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);

// Downloads the model once; skipped when offline (set DECK_SKIP_MODEL_TESTS=1).
describe.skipIf(process.env.DECK_SKIP_MODEL_TESTS === "1")("local embeddings", () => {
  it("returns unit vectors where related sentences are closer", async () => {
    const e = new LocalEmbedder({ cacheDir: process.env.DECK_MODEL_CACHE ?? mkdtempSync(join(tmpdir(), "models-")) });
    const [q, near, far] = await e.embed(["When will Acme buy?", "Acme is not buying until Q2", "The office plants need water"]);
    expect(q!.length).toBe(384);
    expect(dot(q!, q!)).toBeCloseTo(1, 4);
    expect(dot(q!, near!)).toBeGreaterThan(dot(q!, far!));
  }, 120_000);
});
