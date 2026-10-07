import { describe, expect, it } from "vitest";
import { ApprovalQueue } from "@deck/gate";
import type { ChatRequest, ChatResponse } from "@deck/models";
import { runAgent, type AgentTool } from "./index.js";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const call = (name: string, input: Record<string, unknown>, id: string): ChatResponse => ({ text: "", toolCalls: [{ type: "tool_call", id, name, input }], model: "m", stopReason: "tool_use", usage });

describe("working memory for long tasks", () => {
  it("a task longer than the context window finishes without losing its plan", async () => {
    let file = "";
    const notes = { where: "workspace/.deck/tasks/t1.md", read: async () => file, write: async (t: string) => void (file = t) };
    // Each step reads a large file: twelve of them are far more than the budget.
    const read: AgentTool = { spec: { name: "read_file", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }, scope: "repo.read", kind: "read", describe: (i) => `Read ${String(i.path)}`, run: async (i) => `${String(i.path)}:\n${"x".repeat(6000)}` };
    const PLAN = "# Plan\nMigrate the 12 modules to the new logger, one by one.\n# To do\n";
    const seen: ChatRequest[] = [];
    let step = 0;
    const chat = async (req: ChatRequest): Promise<ChatResponse> => {
      seen.push(structuredClone(req));
      step++;
      if (step === 1) return call("update_notes", { text: `${PLAN}- [ ] modules 1 to 12` }, "n0");
      if (step <= 13) {
        const k = step - 1;
        // Every third step the agent ticks off progress in its notes.
        if (k % 3 === 0) return call("update_notes", { text: `${PLAN}- [x] modules 1 to ${k}\n- [ ] modules ${k + 1} to 12` }, `n${k}`);
        return call("read_file", { path: `src/module${k}.ts` }, `r${k}`);
      }
      return { text: "All 12 modules migrated.", model: "m", stopReason: "end_turn", usage };
    };
    const thoughts: string[] = [];
    const out = await runAgent({
      agent: "code",
      chat,
      system: [{ type: "text", text: "rules" }],
      messages: [{ role: "user", content: "# Task\nMigrate every module to the new logger." }],
      tools: [read],
      policy: { agent: "code", allow: ["repo.read"], requiresApproval: [], deny: [] },
      taskScopes: ["repo.read"],
      preset: "balanced",
      approvals: new ApprovalQueue(),
      maxTurns: 20,
      notes,
      contextBudget: 4000,
      onThought: (_k, t) => thoughts.push(t),
    });
    expect(out.text).toBe("All 12 modules migrated.");
    const tokens = seen.map((r) => Math.ceil(JSON.stringify(r.messages).length / 4));
    expect(Math.max(...tokens)).toBeLessThan(4000 + 2500); // never more than one step over the budget
    expect(thoughts.filter((t) => t.startsWith("Compacted")).length).toBeGreaterThan(1);
    // After compaction the task, the plan and the latest progress are all still there, read from the file.
    const after = JSON.stringify(seen[seen.length - 1]!.messages);
    expect(after).toContain("Migrate every module to the new logger.");
    expect(after).toContain("Migrate the 12 modules to the new logger, one by one.");
    expect(after).toContain("[x] modules 1 to 12");
    expect(after).toContain("re-read from workspace/.deck/tasks/t1.md");
    expect(out.actions.filter((a) => a.tool === "read_file")).toHaveLength(8);
  });

  it("notes are restated every step, never hold keys, and are left out when not used", async () => {
    let file = "";
    const notes = { where: "n.md", read: async () => file, write: async (t: string) => void (file = t) };
    const seen: ChatRequest[] = [];
    const turns = [call("update_notes", { text: "# Plan\nfix it\nkey " + "sk-ant-" + "api03-" + "a".repeat(40) }, "a"), { text: "done", model: "m", stopReason: "end_turn", usage } as ChatResponse];
    const base = { agent: "code", system: [{ type: "text" as const, text: "r" }], messages: [{ role: "user" as const, content: "go" }], tools: [], policy: { agent: "code", allow: [], requiresApproval: [], deny: [] }, taskScopes: [], preset: "balanced" as const, approvals: new ApprovalQueue() };
    await runAgent({ ...base, notes, chat: async (r) => (seen.push(structuredClone(r)), turns.shift()!) });
    expect(file).toContain("[redacted Anthropic key]");
    expect(JSON.stringify(seen[1]!.messages)).toContain("# Your working notes (n.md)");
    expect(seen[0]!.tools!.map((t) => t.name)).toContain("update_notes");
    const plain: ChatRequest[] = [];
    await runAgent({ ...base, chat: async (r) => (plain.push(r), { text: "ok", model: "m", stopReason: "end_turn", usage }) });
    expect(plain[0]!.tools!.map((t) => t.name)).not.toContain("update_notes");
  });
});
