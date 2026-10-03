/**
 * The agent loop is the Claude Agent SDK. This file keeps the rest of the app independent of it:
 * agents talk to an AgentRunner, and tests use a fake one.
 */
export interface AgentRunInput {
  agent: string;
  /** Fully built prompt layers from @deck/agents. */
  system: string;
  prompt: string;
  /** Tools this run may call, already narrowed to the task's scopes. */
  allowedTools: string[];
  maxTurns: number;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; ok: boolean }
  | { type: "done"; result: string; turns: number }
  | { type: "error"; message: string };

export interface AgentRunner {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}

/** Runs to completion and returns the final result, forwarding every event. */
export async function runToEnd(runner: AgentRunner, input: AgentRunInput, onEvent?: (e: AgentEvent) => void): Promise<{ result: string; turns: number }> {
  for await (const e of runner.run(input)) {
    onEvent?.(e);
    if (e.type === "error") throw new Error(`${input.agent}: ${e.message}`);
    if (e.type === "done") return { result: e.result, turns: e.turns };
  }
  throw new Error(`${input.agent}: run ended without a result`);
}

/**
 * Environment for the Claude Agent SDK so every call goes through VaultProof Gateway.
 * The SDK reads these; no provider key is ever set.
 */
export function gatewayEnv(baseUrl: string, scopedToken: string): Record<string, string> {
  if (!scopedToken.startsWith("vp-proj-")) throw new Error("agent-loop: expected a scoped vp-proj token");
  return { ANTHROPIC_BASE_URL: baseUrl.replace(/\/$/, "") + "/anthropic", ANTHROPIC_AUTH_TOKEN: scopedToken, ANTHROPIC_API_KEY: "" };
}
