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
}

const missing = (spec: ToolSpec, input: Record<string, unknown>) => (spec.parameters.required ?? []).filter((k) => input[k] === undefined || input[k] === "");

/**
 * The agent loop with an action gate. The model may call tools; each call is checked against
 * permissions, then run, sent for approval, or refused. Approved actions run later, after the owner decides.
 */
export async function runAgent(i: RunAgentInput): Promise<{ text: string; actions: ActionRecord[]; turns: number }> {
  const allowed = i.tools.filter((t) => decideTool(i.policy, i.taskScopes, t.scope) !== "deny");
  const messages = [...i.messages];
  const actions: ActionRecord[] = [];
  const max = i.maxTurns ?? 6;
  for (let turn = 1; turn <= max; turn++) {
    const res = await i.chat({ system: i.system, messages, tools: allowed.map((t) => t.spec), maxTokens: i.maxTokens ?? 900 });
    const calls = res.toolCalls ?? [];
    if (!calls.length) return { text: res.text.trim(), actions, turns: turn };
    const assistant: Block[] = [...(res.text.trim() ? [{ type: "text" as const, text: res.text }] : []), ...calls];
    messages.push({ role: "assistant", content: assistant });
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
  if (!needsApproval(tool.kind, i.preset)) {
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
