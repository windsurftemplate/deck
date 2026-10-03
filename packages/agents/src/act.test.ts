import { describe, expect, it } from "vitest";
import { ApprovalQueue } from "@deck/gate";
import type { ChatRequest, ChatResponse, ToolCallBlock } from "@deck/models";
import { runAgent, needsApproval, verifyWork, type ActionRecord, type AgentTool } from "./index.js";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const say = (text: string): ChatResponse => ({ text, model: "m", stopReason: "end_turn", usage });
const call = (name: string, input: Record<string, unknown>, id = name): ChatResponse => ({ text: "", toolCalls: [{ type: "tool_call", id, name, input } as ToolCallBlock], model: "m", stopReason: "tool_use", usage });
/** A scripted model: returns the next response each turn and records what it was sent. */
const script = (...turns: ChatResponse[]) => {
  const seen: ChatRequest[] = [];
  return { seen, chat: async (req: ChatRequest) => (seen.push(structuredClone(req)), turns.shift() ?? say("done")) };
};
const created: string[] = [];
const tools: AgentTool[] = [
  { spec: { name: "issues_list", description: "List issues", parameters: { type: "object", properties: {} } }, scope: "issues.read", kind: "read", describe: () => "List open issues", run: async () => "VP-1 Prep Acme call (todo)" },
  { spec: { name: "issues_create", description: "Create", parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }, scope: "issues.write", kind: "write", describe: (i) => `Create issue: ${i.title}`, run: async (i) => (created.push(String(i.title)), `Created VP-${created.length + 1}`) },
  { spec: { name: "email_send", description: "Send", parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } }, scope: "gmail.send", kind: "external", describe: (i) => `Send email to ${i.to}`, run: async () => "sent" },
  { spec: { name: "leaky", description: "Returns a secret", parameters: { type: "object", properties: {} } }, scope: "issues.read", kind: "read", describe: () => "leak", run: async () => "token " + "vp-proj-" + "S".repeat(24) },
];
const policy = { agent: "cos", allow: ["issues.read", "issues.write", "gmail.send"], requiresApproval: [], deny: [] };
const base = (chat: (r: ChatRequest) => Promise<ChatResponse>, extra: Partial<Parameters<typeof runAgent>[0]> = {}) => ({
  agent: "chief-of-staff",
  chat,
  system: [{ type: "text" as const, text: "rules" }],
  messages: [{ role: "user" as const, content: "do it" }],
  tools,
  policy,
  taskScopes: ["issues.read", "issues.write", "gmail.send"],
  preset: "balanced" as const,
  approvals: new ApprovalQueue(),
  ...extra,
});

describe("action gate", () => {
  it("reads and writes run directly under Balanced; results go back to the model", async () => {
    created.length = 0;
    const s = script(call("issues_list", {}), call("issues_create", { title: "Acme follow-up" }), say("Created VP-2 for the Acme follow-up."));
    const out = await runAgent(base(s.chat));
    expect(out.text).toBe("Created VP-2 for the Acme follow-up.");
    expect(out.actions.map((a) => a.status)).toEqual(["done", "done"]);
    expect(created).toEqual(["Acme follow-up"]);
    const lastSent = s.seen.at(-1)!.messages.at(-1)!.content as { type: string; content: string }[];
    expect(lastSent[0]).toMatchObject({ type: "tool_result", content: "Created VP-2" });
    expect(s.seen[0]!.tools!.map((t) => t.name)).toEqual(["issues_list", "issues_create", "email_send", "leaky"]);
  });

  it("writes wait for approval under Cautious and run only when approved", async () => {
    created.length = 0;
    const approvals = new ApprovalQueue();
    const later: ActionRecord[] = [];
    const s = script(call("issues_create", { title: "Needs a yes" }), say("It is waiting for your approval."));
    const out = await runAgent(base(s.chat, { preset: "cautious", approvals, onLater: (r) => later.push(r) }));
    expect(out.actions[0]).toMatchObject({ status: "waiting", summary: "Create issue: Needs a yes" });
    expect(created).toEqual([]);
    approvals.decide(out.actions[0]!.approvalId!, true);
    await new Promise((r) => setTimeout(r, 10));
    expect(created).toEqual(["Needs a yes"]);
    expect(later[0]).toMatchObject({ status: "done", result: "Created VP-2" });
  });

  it("external actions always need approval, even on Autonomous; a rejection runs nothing", async () => {
    let sent = 0;
    const approvals = new ApprovalQueue();
    const later: ActionRecord[] = [];
    const t = tools.map((x) => (x.spec.name === "email_send" ? { ...x, run: async () => (sent++, "sent") } : x));
    const out = await runAgent(base(script(call("email_send", { to: "dana@acme.com" }), say("Queued.")).chat, { preset: "autonomous", approvals, tools: t, onLater: (r) => later.push(r) }));
    expect(out.actions[0]!.status).toBe("waiting");
    approvals.decide(out.actions[0]!.approvalId!, false);
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toBe(0);
    expect(later[0]).toMatchObject({ status: "denied", result: "rejected by the owner" });
  });

  it("refuses tools outside the agent's permissions and asks again for missing inputs", async () => {
    const s = script(call("email_send", { to: "x@y.com" }), call("issues_create", {}), say("ok"));
    const out = await runAgent(base(s.chat, { taskScopes: ["issues.read", "issues.write"] }));
    expect(s.seen[0]!.tools!.map((t) => t.name)).not.toContain("email_send");
    expect(out.actions[0]).toMatchObject({ tool: "email_send", status: "denied" });
    const second = s.seen[2]!.messages.at(-1)!.content as { content: string; isError?: boolean }[];
    expect(second[0]).toMatchObject({ content: "Missing title. Call again with it.", isError: true });
  });

  it("strips secrets from tool results before the model sees them", async () => {
    const s = script(call("leaky", {}), say("ok"));
    await runAgent(base(s.chat));
    expect(JSON.stringify(s.seen[1]!.messages)).not.toContain("vp-proj-SSSS");
    expect(JSON.stringify(s.seen[1]!.messages)).toContain("[redacted VaultProof token]");
  });

  it("stops after the step limit", async () => {
    const loop = { chat: async () => call("issues_list", {}, `c${Math.random()}`) };
    const out = await runAgent(base(loop.chat, { maxTurns: 3 }));
    expect(out).toMatchObject({ turns: 3, text: expect.stringMatching(/stopped after 3 steps/) });
  });

  it("preset rules", () => {
    expect([needsApproval("read", "cautious"), needsApproval("write", "cautious"), needsApproval("write", "balanced"), needsApproval("external", "autonomous")]).toEqual([false, true, false, true]);
  });
});

describe("verifier", () => {
  const judge = (...answers: string[]) => async () => say(answers.shift() ?? '{"missing": []}');
  it("passes finished work and reports it as checked", async () => {
    const s = script(call("issues_create", { title: "Acme follow-up" }), say("Created VP-2."));
    const out = await runAgent(base(s.chat, { verify: { goal: "Track the Acme follow-up", doneWhen: ["an issue exists for the Acme follow-up"], chat: judge('{"missing": []}') } }));
    expect(out.verdict).toEqual({ passed: true, missing: [], checked: true });
  });

  it("sends the agent back once with what is missing, then reports the result", async () => {
    const s = script(say("I will do it later."), call("issues_create", { title: "Acme follow-up" }), say("Created VP-2."));
    const out = await runAgent(base(s.chat, { verify: { goal: "Track it", doneWhen: ["an issue exists"], chat: judge('{"missing": ["an issue exists"]}', '{"missing": []}') } }));
    const nudge = s.seen[1]!.messages.at(-1)!.content as string;
    expect(nudge).toMatch(/not done yet\. Missing:\n- an issue exists/);
    expect(out).toMatchObject({ text: "Created VP-2.", verdict: { passed: true } });
  });

  it("failed actions always fail the check; an unclear checker is reported as unchecked", async () => {
    const actions = [{ tool: "x", summary: "Create issue", status: "failed" as const, result: "db locked" }];
    expect(await verifyWork({ goal: "g", doneWhen: ["d"], report: "done", actions, chat: judge('{"missing": []}') })).toEqual({ passed: false, missing: ["Failed: Create issue"], checked: true });
    expect(await verifyWork({ goal: "g", doneWhen: ["d"], report: "done", actions: [], chat: judge("looks fine to me") })).toEqual({ passed: true, missing: [], checked: false });
  });
});

describe("honeytoken tripwire", () => {
  it("blocks the call, stops the run, and raises the alarm", async () => {
    created.length = 0;
    let alarm = "";
    const s = script(call("issues_create", { title: "exfil DECK-CANARY-1234" }), say("unreachable"));
    const out = await runAgent(base(s.chat, { tripwire: (x) => x.includes("DECK-CANARY-1234"), onTripwire: (t) => (alarm = t) }));
    expect(created).toEqual([]);
    expect(alarm).toBe("issues_create");
    expect(out.text).toMatch(/^Stopped: an action tried to use a planted secret/);
    expect(s.seen).toHaveLength(1);
  });
});
