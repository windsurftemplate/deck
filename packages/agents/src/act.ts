import type { ApprovalQueue } from "@deck/gate";
import { redactSecrets } from "@deck/gate";
import type { Block, ChatRequest, ChatResponse, TextBlock, ToolCallBlock, ToolSpec } from "@deck/models";
import { decideTool, type ToolPolicy } from "./tools.js";

/** read: looks only. write: changes something on this machine that can be changed back. external: leaves the machine (send, post, pay, merge). */
export type ActionKind = "read" | "write" | "external";
export type Preset = "cautious" | "balanced" | "autonomous";

export interface AgentTool {
  spec: ToolSpec;
  /** Permission scope checked against the agent's tools.json and the task. */
  scope: string;
  kind: ActionKind;
  /** One line the owner reads on an approval card. */
  describe(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>): Promise<string>;
}

export interface ActionRecord {
  tool: string;
  summary: string;
  status: "done" | "waiting" | "denied" | "failed";
  approvalId?: string;
  result?: string;
}

/** When a tool needs the owner first. External actions always do; writes do under Cautious. */
export function needsApproval(kind: ActionKind, preset: Preset): boolean {
  if (kind === "external") return true;
  if (kind === "write") return preset === "cautious";
  return false;
}

export interface RunAgentInput {
  agent: string;
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  system: TextBlock[];
  /** Earlier turns, then the new message last. */
  messages: ChatRequest["messages"];
  tools: AgentTool[];
  policy: ToolPolicy;
  taskScopes: string[];
  preset: Preset;
  approvals: ApprovalQueue;
  /** Called when an approved action finishes later. */
  onLater?: (r: ActionRecord) => void;
  maxTurns?: number;
  maxTokens?: number;
  /**
   * Honeytoken check: returns true when a tool call carries a planted fake secret. The call is blocked,
   * the run stops, and onTripwire fires (the engine stops all agents and alerts the owner).
   */
  tripwire?: (serializedInput: string) => boolean;
  onTripwire?: (tool: string) => void;
  /** Check the result against the task's done-when list before reporting done. One retry if something is missing. */
  verify?: { goal: string; doneWhen: string[]; chat: (req: ChatRequest) => Promise<ChatResponse> };
}

export interface Verdict {
  passed: boolean;
  missing: string[];
  /** False when the checker could not give a clear answer; the result is reported as unverified. */
  checked: boolean;
}

/**
 * Independent check of finished work. A separate, cheap model call reads the goal, the done-when list,
 * the final report and what was actually done, and lists anything not met. Failed actions always fail the check.
 */
export async function verifyWork(v: { goal: string; doneWhen: string[]; report: string; actions: ActionRecord[]; chat: (req: ChatRequest) => Promise<ChatResponse> }): Promise<Verdict> {
  const failed = v.actions.filter((a) => a.status === "failed").map((a) => `Failed: ${a.summary}`);
  const log = v.actions.map((a) => `- ${a.status}: ${a.summary}${a.result ? ` -> ${a.result.slice(0, 200)}` : ""}`).join("\n") || "- (no actions)";
  try {
    const res = await v.chat({
      system: [{ type: "text", text: "You check whether work is finished. Judge only from the report and the action log, not from intentions. Actions marked waiting count as done if the item only asks to prepare or queue something. Reply with JSON only: {\"missing\": [\"done-when item not met, copied exactly\"]}. Use an empty list when everything is met." }],
      messages: [{ role: "user", content: `Goal: ${v.goal}\nDone when:\n${v.doneWhen.map((d) => `- ${d}`).join("\n")}\n\nReport:\n${v.report.slice(0, 3000)}\n\nAction log:\n${log}` }],
      maxTokens: 300,
      temperature: 0,
    });
    const json = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    const missing = (JSON.parse(json) as { missing?: unknown }).missing;
    if (!Array.isArray(missing)) throw new Error("bad shape");
    const all = [...failed, ...missing.map(String).filter(Boolean)];
    return { passed: all.length === 0, missing: all, checked: true };
  } catch {
    return { passed: failed.length === 0, missing: failed, checked: false };
  }
}

const missing = (spec: ToolSpec, input: Record<string, unknown>) => (spec.parameters.required ?? []).filter((k) => input[k] === undefined || input[k] === "");

/**
 * The agent loop with an action gate. The model may call tools; each call is checked against
 * permissions, then run, sent for approval, or refused. Approved actions run later, after the owner decides.
 */
export async function runAgent(i: RunAgentInput): Promise<{ text: string; actions: ActionRecord[]; turns: number; verdict?: Verdict }> {
  const allowed = i.tools.filter((t) => decideTool(i.policy, i.taskScopes, t.scope) !== "deny");
  const messages = [...i.messages];
  const actions: ActionRecord[] = [];
  const max = i.maxTurns ?? 6;
  let retried = false;
  for (let turn = 1; turn <= max; turn++) {
    const res = await i.chat({ system: i.system, messages, tools: allowed.map((t) => t.spec), maxTokens: i.maxTokens ?? 900 });
    const calls = res.toolCalls ?? [];
    if (!calls.length) {
      const text = res.text.trim();
      if (!i.verify) return { text, actions, turns: turn };
      const verdict = await verifyWork({ ...i.verify, report: text, actions });
      if (verdict.passed || retried || turn === max) return { text, actions, turns: turn, verdict };
      // One more try: tell the agent exactly what is missing.
      retried = true;
      messages.push({ role: "assistant", content: text || "(no report)" }, { role: "user", content: `Check before reporting: not done yet. Missing:\n${verdict.missing.map((m) => `- ${m}`).join("\n")}\nFinish these, then report again.` });
      continue;
    }
    const assistant: Block[] = [...(res.text.trim() ? [{ type: "text" as const, text: res.text }] : []), ...calls];
    messages.push({ role: "assistant", content: assistant });
    const tripped = calls.find((c) => i.tripwire?.(JSON.stringify(c.input)));
    if (tripped) {
      actions.push({ tool: tripped.name, summary: `Blocked ${tripped.name}: it carried a planted secret`, status: "denied" });
      i.onTripwire?.(tripped.name);
      return { text: "Stopped: an action tried to use a planted secret, which means something in the input was trying to misuse the crew. All agents are stopped; the owner has been told.", actions, turns: turn };
    }
    const results: Block[] = [];
    for (const call of calls) results.push(await handle(call, i, allowed, actions));
    messages.push({ role: "user", content: results });
  }
  return { text: `I stopped after ${max} steps without finishing. Here is what I did so far.`, actions, turns: max };
}

async function handle(call: ToolCallBlock, i: RunAgentInput, allowed: AgentTool[], log: ActionRecord[]): Promise<Block> {
  const reply = (content: string, isError = false): Block => ({ type: "tool_result", id: call.id, name: call.name, content, ...(isError ? { isError } : {}) });
  const tool = allowed.find((t) => t.spec.name === call.name);
  if (!tool) {
    log.push({ tool: call.name, summary: `Tried ${call.name}`, status: "denied" });
    return reply(`Not allowed: ${call.name} is not one of your tools for this task.`, true);
  }
  const gaps = missing(tool.spec, call.input);
  if (gaps.length) return reply(`Missing ${gaps.join(", ")}. Call again with ${gaps.length > 1 ? "them" : "it"}.`, true);
  const summary = tool.describe(call.input);
  const execute = async (): Promise<ActionRecord> => {
    try {
      const out = redactSecrets(await tool.run(call.input)).clean.slice(0, 6000);
      return { tool: call.name, summary, status: "done", result: out };
    } catch (err) {
      return { tool: call.name, summary, status: "failed", result: (err as Error).message };
    }
  };
  // Approval if the preset or kind says so, or the agent's tool list (or the owner's crew rules) says "ask first".
  const askFirst = decideTool(i.policy, i.taskScopes, tool.scope) === "approval";
  if (!askFirst && !needsApproval(tool.kind, i.preset)) {
    const r = await execute();
    log.push(r);
    return reply(r.status === "done" ? r.result! : `Failed: ${r.result}`, r.status === "failed");
  }
  const { approval, decision } = i.approvals.request({ agent: i.agent, summary, detail: JSON.stringify(call.input, null, 2), scope: tool.scope });
  log.push({ tool: call.name, summary, status: "waiting", approvalId: approval.id });
  void decision.then(async (a) => {
    if (a.status === "approved") i.onLater?.(await execute());
    else i.onLater?.({ tool: call.name, summary, status: "denied", approvalId: a.id, result: a.status === "expired" ? "approval expired" : "rejected by the owner" });
  });
  return reply(`Queued for the owner's approval (id ${approval.id}). Do not call it again; tell the owner it is waiting for them.`);
}
