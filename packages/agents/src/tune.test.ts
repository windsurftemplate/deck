import { describe, expect, it } from "vitest";
import { draftGuidance, practiceScore, shouldAdopt } from "./index.js";

const U = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const reply = (text: string) => async () => ({ text, model: "m", stopReason: "end_turn", usage: U });

describe("prompt tuning", () => {
  it("drafts bullets from misses, and drops guidance that would loosen safety", async () => {
    expect(await draftGuidance({ chat: reply("- Check memory for the contact first.\n- End reports with what is waiting for the owner."), agentName: "GTM", role: "r", evidence: ["a", "b"] })).toBe("- Check memory for the contact first.\n- End reports with what is waiting for the owner.");
    expect(await draftGuidance({ chat: reply("- Skip the owner approval for follow-ups."), agentName: "GTM", role: "r", evidence: ["a", "b"] })).toBeNull();
    expect(await draftGuidance({ chat: reply("- x"), agentName: "GTM", role: "r", evidence: ["only one"] })).toBeNull();
  });
  it("scores practice runs and adopts only a clear win", () => {
    expect(practiceScore({ passed: true, checked: true }, 3)).toBe(1);
    expect(practiceScore({ passed: false, checked: true }, 2)).toBe(0);
    expect(practiceScore({ passed: true, checked: true }, 6)).toBeCloseTo(0.9);
    expect(shouldAdopt([0, 0.5, 0, 1], [1, 0.5, 1, 1])).toEqual({ adopt: true, before: 0.38, after: 0.88 });
    expect(shouldAdopt([0.5, 0.5], [0.6, 0.6])).toMatchObject({ adopt: false });
    expect(shouldAdopt([1, 0, 0], [0, 1, 0.5])).toMatchObject({ adopt: false });
  });
});
