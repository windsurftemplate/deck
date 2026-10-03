import { describe, expect, it } from "vitest";
import type { ChatResponse } from "@deck/models";
import { extractFacts, jsonFrom, reflect, skillName } from "./index.js";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const answer = (text: string) => async (): Promise<ChatResponse> => ({ text, model: "m", stopReason: "end_turn", usage });
const passed = { passed: true, missing: [], checked: true };
const did = [{ tool: "draft_message", summary: "Draft a message to dana@acme.com", status: "done" as const }];

describe("learning", () => {
  it("turns a clear, repeatable procedure into a draft skill", async () => {
    const k = await reflect({ chat: answer('Sure: {"skill": {"name": "Draft Follow Up!", "description": "Use for a follow-up after a call", "steps": ["Search memory for the last call", "Name one next step", "Keep it under 120 words"]}}'), agent: "gtm", goal: "g", report: "r", actions: did, verdict: passed });
    expect(k).toEqual({ name: "draft-follow-up", description: "Use for a follow-up after a call", body: "1. Search memory for the last call\n2. Name one next step\n3. Keep it under 120 words" });
  });

  it("learns nothing from unchecked or failed work, or from a vague answer", async () => {
    const chat = answer('{"skill": {"name": "x", "description": "y", "steps": ["a", "b"]}}');
    expect(await reflect({ chat, agent: "gtm", goal: "g", report: "r", actions: did, verdict: { passed: false, missing: ["x"], checked: true } })).toBeNull();
    expect(await reflect({ chat, agent: "gtm", goal: "g", report: "r", actions: [], verdict: passed })).toBeNull();
    expect(await reflect({ chat: answer('{"skill": null}'), agent: "gtm", goal: "g", report: "r", actions: did, verdict: passed })).toBeNull();
    expect(await reflect({ chat: answer("no idea"), agent: "gtm", goal: "g", report: "r", actions: did, verdict: passed })).toBeNull();
  });

  it("extracts lasting facts and drops malformed ones", async () => {
    const facts = await extractFacts({ chat: answer('{"facts": [{"subject": "Acme", "topic": "timing", "claim": "Not buying until Q2"}, {"subject": "", "claim": "x"}, {"claim": "no subject"}]}'), episodes: [{ kind: "chat", summary: "Owner: Acme is waiting until Q2" }] });
    expect(facts).toEqual([{ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" }]);
    expect(await extractFacts({ chat: answer("{}"), episodes: [] })).toEqual([]);
  });

  it("helpers", () => {
    expect(jsonFrom<{ a: number }>('text {"a": 1} text')).toEqual({ a: 1 });
    expect(jsonFrom("{broken")).toBeNull();
    expect(skillName("  Prep: The Call!! ")).toBe("prep-the-call");
  });
});
