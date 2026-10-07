import { describe, expect, it } from "vitest";
import { errorSignature, errorSimilarity, formatFixes } from "./index.js";

describe("fix memory", () => {
  it("keeps the lines that identify an error and drops paths, numbers, ids and timings", () => {
    const a = errorSignature("\x1b[31mFAIL\x1b[0m /home/me/app/src/a.test.ts > adds\nAssertionError: expected 3 to be 4\n    at Object.<anonymous> (/home/me/app/src/a.test.ts:10:5)\nDone in 42ms");
    expect(a).toBe("fail <path> > adds\nassertionerror: expected <n> to be <n>");
    const rust = errorSignature("error[E0425]: cannot find value `cfg` in this scope\n --> src/main.rs:4:13\n  |\n4 |     let x = cfg;\n  |             ^^^ not found in this scope");
    expect(rust).toBe("error[e<n>]: cannot find value `cfg` in this scope");
    expect(errorSignature("all good\n")).toBe("all good");
    expect(errorSignature("")).toBe("");
  });

  it("scores alike errors high and different ones low", () => {
    const a = errorSignature("TypeError: Cannot read properties of undefined (reading 'total')\n at Invoice.sum (src/invoice.ts:12:9)");
    const b = errorSignature("TypeError: Cannot read properties of undefined (reading 'total')\n at Invoice.sum (src/invoice.ts:40:2)");
    const c = errorSignature("SyntaxError: Unexpected token '}' in JSON");
    expect(errorSimilarity(a, b)).toBe(1);
    expect(errorSimilarity(a, c)).toBeLessThan(0.3);
  });

  it("says plainly when a recalled fix may be stale", () => {
    const fix = { id: 1, error: "e", signature: "assertionerror: expected <n> to be <n>", summary: "Set the rate to 0.25.", files: [{ path: "src/a.ts", hash: "h" }], commit: "abc1234567890", testCommand: null, createdAt: "2026-10-07T10:00:00.000Z" };
    expect(formatFixes([{ fix, score: 0.8, changedSince: ["src/a.ts"] }])).toContain("POSSIBLY STALE: src/a.ts changed since this fix");
    expect(formatFixes([{ fix, score: 1, changedSince: [] }])).toContain("as they were right after the fix");
    expect(formatFixes([])).toBe("No earlier fix for an error like this.");
  });
});
