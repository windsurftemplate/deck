import type { ApprovalQueue } from "@deck/gate";
import { redactSecrets } from "@deck/gate";
import type { Block, ChatMessage, ChatRequest, ChatResponse, TextBlock, ToolCallBlock, ToolSpec } from "@deck/models";
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
  chat: (req: ChatRequest, onText?: (delta: string) => void) => Promise<ChatResponse>;
  /** Each tool call as it happens (for the crew channel). */
  onAction?: (a: ActionRecord) => void;
  /** Reply text as it is written, across turns (a blank line separates turns). */
  onText?: (delta: string) => void;
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
  /**
   * Observe, think, act, reflect. plan: write a short plan before the first action. reasoning: the model's
   * built-in reasoning on every step. Both are for complex work; simple requests skip them.
   */
  think?: { plan?: boolean; reasoning?: "low" | "medium" | "high" };
  /** Summaries of the agent's thinking: its plan, its reasoning, and its reflections after a step fails. */
  onThought?: (kind: "plan" | "thinking" | "reflect", text: string) => void;
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

/** Adds a note to the end of the last user message (keeps roles alternating for every provider). */
function withNote(messages: ChatMessage[], note: string): ChatMessage[] {
  const out = [...messages];
  const last = out[out.length - 1];
  if (!last || last.role !== "user") return [...out, { role: "user", content: note }];
  out[out.length - 1] = { role: "user", content: typeof last.content === "string" ? `${last.content}\n\n${note}` : [...last.content, { type: "text", text: note }] };
  return out;
}

/** A short, readable summary of reasoning text for Crew chat. */
export function summarizeThought(t: string, max = 420): string {
  const one = t.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut.trimEnd()}…`;
}

/** Internal reads that stay available under the plan lock: they cannot send or change anything. */
const SAFE_READS = new Set(["memory.read", "issues.read", "skills.read", "skills.use", "drafts.read"]);

const PLAN_PROMPT = "Before acting, think it through. Reply with a short plan only (no tool calls): the goal in one line, 2 to 5 steps naming the tools you will use, and the main risk or unknown. Under 120 words.";

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
  // Streamed text: a blank line between turns, so text before and after tool use reads as paragraphs.
  const record = (a: ActionRecord) => {
    actions.push(a);
    i.onAction?.(a);
  };
  let anyText = false;
  let newTurn = false;
  const onText =
    i.onText &&
    ((d: string) => {
      if (!d) return;
      if (newTurn && anyText) i.onText!("\n\n");
      newTurn = false;
      anyText = true;
      i.onText!(d);
    });
  // Think: a short plan before the first action (complex work only). It joins the conversation so later steps follow it.
  let plan = "";
  if (i.think?.plan) {
    try {
      const names = allowed.map((t) => t.spec.name).join(", ") || "none";
      plan = (await i.chat({ system: i.system, messages: withNote(messages, `${PLAN_PROMPT}\nTools you can use: ${names}.`), maxTokens: 350 })).text.trim();
      if (plan) {
        i.onThought?.("plan", plan);
        messages.splice(0, messages.length, ...withNote(messages, `# Your plan (follow it, and change it if results show it is wrong)\n${plan}`));
      }
    } catch {
      /* no plan is fine; act without one */
    }
  }
  // Plan lock (plan-then-execute): once outside content is in play, only tools named in the plan (and safe
  // internal reads) may run, so instructions hidden in that content cannot add new actions.
  const planTools = new Set(plan ? allowed.filter((t) => plan.includes(t.spec.name)).map((t) => t.spec.name) : []);
  const hasUntrusted = (m: ChatMessage[]) => JSON.stringify(m).includes("<untrusted");
  let outside = hasUntrusted(messages);
  const locked = (name: string) => {
    if (!plan || !outside || planTools.has(name)) return false;
    const t = allowed.find((x) => x.spec.name === name);
    return !(t && t.kind === "read" && SAFE_READS.has(t.scope));
  };
  for (let turn = 1; turn <= max; turn++) {
    newTurn = turn > 1;
    const res = await i.chat({ system: i.system, messages, tools: allowed.map((t) => t.spec), maxTokens: i.maxTokens ?? 900, ...(i.think?.reasoning ? { reasoning: i.think.reasoning } : {}) }, onText);
    if (res.thinking) i.onThought?.("thinking", summarizeThought(res.thinking));
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
      record({ tool: tripped.name, summary: `Blocked ${tripped.name}: it carried a planted secret`, status: "denied" });
      i.onTripwire?.(tripped.name);
      return { text: "Stopped: an action tried to use a planted secret, which means something in the input was trying to misuse the crew. All agents are stopped; the owner has been told.", actions, turns: turn };
    }
    const results: Block[] = [];
    const before = actions.length;
    for (const call of calls) {
      if (locked(call.name)) {
        record({ tool: call.name, summary: `Refused ${call.name}: not in the plan while outside content is in play`, status: "denied" });
        results.push({ type: "tool_result", id: call.id, name: call.name, content: "Refused: this tool is not in your plan, and outside content (which may carry hidden instructions) is in the conversation. Finish the plan, or report that the owner should decide.", isError: true });
        continue;
      }
      results.push(await handle(call, i, allowed, actions));
    }
    if (results.some((r) => r.type === "tool_result" && r.content.includes("<untrusted"))) outside = true;
    // Reflect: when a step fails or is refused, say so plainly and ask the agent to revise before the next step.
    const problems = [...actions.slice(before).filter((a) => a.status === "failed" || a.status === "denied").map((a) => `${a.summary}${a.result ? ` (${a.result.slice(0, 160)})` : ""}`), ...results.filter((r) => r.type === "tool_result" && r.isError && !actions.slice(before).some((a) => a.tool === r.name)).map((r) => (r.type === "tool_result" ? `${r.name}: ${r.content.slice(0, 160)}` : ""))].filter(Boolean);
    if (problems.length && turn < max) {
      const note = `Reflect before the next step: ${problems.join("; ")}. Check your plan: try a different way, skip it, or report what is blocked. Do not repeat the same call.`;
      results.push({ type: "text", text: note });
      i.onThought?.("reflect", `${problems.join("; ")}. Revising the plan.`);
    }
    // Living to-do list: restate the plan and what is done at the end, where the model attends most.
    if (plan) {
      const done = actions.map((a) => `- ${a.status}: ${a.summary}`).slice(-8).join("\n") || "- nothing yet";
      results.push({ type: "text", text: `# Progress\nPlan:\n${plan}\nDone so far:\n${done}\nNext: the first planned step not done yet, or report if everything is done.` });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: `I stopped after ${max} steps without finishing. Here is what I did so far.`, actions, turns: max };
}

function logAction(log: ActionRecord[], i: RunAgentInput, a: ActionRecord) {
  log.push(a);
  i.onAction?.(a);
}

async function handle(call: ToolCallBlock, i: RunAgentInput, allowed: AgentTool[], log: ActionRecord[]): Promise<Block> {
  const reply = (content: string, isError = false): Block => ({ type: "tool_result", id: call.id, name: call.name, content, ...(isError ? { isError } : {}) });
  const tool = allowed.find((t) => t.spec.name === call.name);
  if (!tool) {
    logAction(log, i, { tool: call.name, summary: `Tried ${call.name}`, status: "denied" });
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
    logAction(log, i, r);
    return reply(r.status === "done" ? r.result! : `Failed: ${r.result}`, r.status === "failed");
  }
  const { approval, decision } = i.approvals.request({ agent: i.agent, summary, detail: JSON.stringify(call.input, null, 2), scope: tool.scope });
  logAction(log, i, { tool: call.name, summary, status: "waiting", approvalId: approval.id });
  void decision.then(async (a) => {
    if (a.status === "approved") i.onLater?.(await execute());
    else i.onLater?.({ tool: call.name, summary, status: "denied", approvalId: a.id, result: a.status === "expired" ? "approval expired" : "rejected by the owner" });
  });
  return reply(`Queued for the owner's approval (id ${approval.id}). Do not call it again; tell the owner it is waiting for them.`);
}
