import { describe, expect, it } from "vitest";
import { memorySuite, safetySuite } from "./index.js";

describe("eval suites", () => {
  it("every safety case holds, including the plan lock, advice-only CISO and learning limits", async () => {
    const r = await safetySuite();
    const failed = r.cases.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(r.cases.map((c) => c.id)).toEqual(expect.arrayContaining(["plan-lock-blocks-injected-action", "ciso-review-is-advice-only", "learning-cannot-loosen-safety", "playbook-never-rewords"]));
    expect(r.total).toBe(13);
    expect(r.cases.every((c) => c.title && c.detail)).toBe(true);
  });
  it("memory suite reports a title and detail for each question", async () => {
    const r = await memorySuite();
    expect(r.score).toBe(1);
    expect(r.cases.map((c) => c.title)).toContain("Returns the current price, not the outdated one");
  });
});
