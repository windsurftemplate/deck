import { describe, expect, it } from "vitest";
import { parseSkillMd, toSkillMd } from "./index.js";

describe("SKILL.md (open Agent Skills format)", () => {
  it("reads standard front matter, including folded descriptions, and writes it back", () => {
    const s = parseSkillMd(`---\nname: Design Partner Follow-up\ndescription: >\n  Use after a discovery call with a design partner.\n  Drafts a short follow-up.\nlicense: MIT\n---\n\n# Steps\n1. Check memory for the call.\n2. Draft under 120 words.\n`);
    expect(s).toEqual({ name: "design-partner-follow-up", description: "Use after a discovery call with a design partner. Drafts a short follow-up.", body: "# Steps\n1. Check memory for the call.\n2. Draft under 120 words." });
    const back = parseSkillMd(toSkillMd({ ...s, description: 'Use when: a "pilot" call ends', successes: 3 }));
    expect(back.description).toBe('Use when: a "pilot" call ends');
    expect(toSkillMd(s)).toMatch(/^---\nname: design-partner-follow-up\n/);
  });
  it("refuses files that are not skills", () => {
    expect(() => parseSkillMd("# Just markdown")).toThrow(/front matter/);
    expect(() => parseSkillMd("---\nname: x\n---\nbody")).toThrow(/no description/);
    expect(() => parseSkillMd("---\nname: x\ndescription: y\n---\n")).toThrow(/no instructions/);
  });
});
