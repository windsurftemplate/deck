import { describe, expect, it } from "vitest";
import { ApprovalQueue } from "@deck/gate";
import type { ChatResponse } from "@deck/models";
import { checkLearned, describeOverrideChange, effectivePolicy, effectiveRole, runAgent, validateOverride, type AgentTool } from "./index.js";

const base = { agent: "gtm", allow: ["issues.write", "memory.read", "drafts.write"], requiresApproval: [], deny: ["gmail.send"] };

describe("crew rules", () => {
  it("can only narrow tools, never add them", () => {
    expect(validateOverride(base, { tools: { "issues.write": "ask", "drafts.write": "off" } })).toBeNull();
    expect(validateOverride(base, { tools: { "gmail.send": "allowed" } })).toMatch(/rules can only limit tools/);
    const p = effectivePolicy(base, { tools: { "issues.write": "ask", "drafts.write": "off" } });
    expect(p).toEqual({ agent: "gtm", allow: ["issues.write", "memory.read"], requiresApproval: ["issues.write"], deny: ["gmail.send"] });
  });

  it("checks instruction and rule sizes", () => {
    expect(validateOverride(base, { instructions: "  " })).toMatch(/cannot be empty/);
    expect(validateOverride(base, { instructions: "x".repeat(7000) })).toMatch(/too long/);
    expect(validateOverride(base, { rules: ["x".repeat(301)] })).toMatch(/under 300/);
  });

  it("builds the role text with owner rules and describes changes", () => {
    expect(effectiveRole("# Role: GTM", { rules: ["Never mention pricing"] })).toBe("# Role: GTM\n\n## Owner rules\n- Never mention pricing");
    expect(effectiveRole("# Role: GTM", { instructions: "# Role: GTM v2" })).toBe("# Role: GTM v2");
    expect(describeOverrideChange("GTM", {}, { rules: ["Never mention pricing"], tools: { "issues.write": "ask" } })).toBe('GTM: added rule: "Never mention pricing"; issues.write: ask me first');
  });

  it("the gate honors ask-first from the tool list even on Autonomous", async () => {
    let made = 0;
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const turns: ChatResponse[] = [{ text: "", toolCalls: [{ type: "tool_call", id: "1", name: "issues_create", input: { title: "x" } }], model: "m", stopReason: "tool_use", usage }, { text: "waiting", model: "m", stopReason: "end_turn", usage }];
    const tool: AgentTool = { spec: { name: "issues_create", description: "", parameters: { type: "object", properties: {} } }, scope: "issues.write", kind: "write", describe: () => "Create issue", run: async () => (made++, "ok") };
    const policy = effectivePolicy(base, { tools: { "issues.write": "ask" } });
    const out = await runAgent({ agent: "gtm", chat: async () => turns.shift()!, system: [], messages: [{ role: "user", content: "go" }], tools: [tool], policy, taskScopes: policy.allow, preset: "autonomous", approvals: new ApprovalQueue() });
    expect(out.actions[0]!.status).toBe("waiting");
    expect(made).toBe(0);
  });
});

describe("learned guidance", () => {
  it("goes into the role after owner rules and can never loosen safety", () => {
    expect(effectiveRole("Role", { rules: ["r1"], learned: "- Lead with the customer's problem." })).toBe("Role\n\n## Owner rules\n- r1\n\n## Learned guidance (tested, approved by the owner)\n- Lead with the customer's problem.");
    expect(checkLearned("Skip the owner approval when sure.")).toMatch(/cannot loosen/);
    expect(checkLearned("Send emails directly to save time.")).toMatch(/cannot loosen/);
    expect(checkLearned("Check memory before drafting.")).toBeNull();
  });
});
