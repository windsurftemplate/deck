export interface ToolPolicy {
  agent: string;
  allow: string[];
  requiresApproval: string[];
  deny: string[];
}

const match = (pattern: string, scope: string) =>
  pattern === scope || (pattern.endsWith(".*") && scope.startsWith(pattern.slice(0, -1))) || (pattern.startsWith("*.") && scope.endsWith(pattern.slice(1)));

/** Scopes a run may use: allowed by the agent's policy AND granted by the task. Deny always wins. */
export function effectiveScopes(policy: ToolPolicy, taskScopes: string[]): string[] {
  return taskScopes.filter((s) => policy.allow.some((p) => match(p, s)) && !policy.deny.some((p) => match(p, s)));
}

export type ToolDecision = "allow" | "approval" | "deny";

export function decideTool(policy: ToolPolicy, taskScopes: string[], scope: string): ToolDecision {
  if (!effectiveScopes(policy, taskScopes).includes(scope)) return "deny";
  return policy.requiresApproval.some((p) => match(p, scope)) ? "approval" : "allow";
}
