import { LIMITS } from "./prompt-builder.js";
import type { ToolPolicy } from "./tools.js";

export type ToolMode = "allowed" | "ask" | "off";

/** The owner's changes to one agent. Anything not set keeps the built-in default. */
export interface CrewOverride {
  /** Replaces the role file's text. */
  instructions?: string;
  /** Added under "Owner rules" in every prompt for this agent. */
  rules?: string[];
  /** Per tool scope: keep allowed, ask first, or switch off. Only scopes the agent has built in. */
  tools?: Record<string, ToolMode>;
}

export type CrewOverrides = Record<string, CrewOverride>;

/** Locked-on rules, shown read-only in Settings. Enforced in code, not by these strings. */
export const LOCKED_RULES = [
  "Anything that leaves your machine (send, post, pay, merge) always waits for your approval.",
  "Secrets are stripped from prompts and tool results before any model sees them.",
  "Text from email, web pages and documents is treated as data, never as instructions.",
  "Using the planted honeytoken stops every agent and alerts you.",
  "Crew members cannot hand work to other agents.",
  "Each request stops after 6 steps.",
];

const tokens = (s: string) => Math.ceil(s.length / 4);

/** Checks an override against the agent's built-in tools and the prompt size limits. Returns an error message or null. */
export function validateOverride(base: ToolPolicy, o: CrewOverride): string | null {
  if (o.instructions !== undefined) {
    if (!o.instructions.trim()) return "Instructions cannot be empty. Use Reset to go back to the default.";
    if (tokens(o.instructions) > LIMITS.role) return `Instructions are too long (${tokens(o.instructions)} tokens, limit ${LIMITS.role}).`;
  }
  if (o.rules) {
    if (o.rules.length > 20) return "Keep it to 20 rules or fewer.";
    if (o.rules.some((r) => !r.trim() || r.length > 300)) return "Each rule needs text and must be under 300 characters.";
  }
  for (const [scope, mode] of Object.entries(o.tools ?? {})) {
    if (!["allowed", "ask", "off"].includes(mode)) return `Unknown setting "${mode}" for ${scope}.`;
    if (!base.allow.includes(scope)) return `${base.agent} does not have ${scope} built in; rules can only limit tools, not add them.`;
  }
  return null;
}

/** The built-in policy narrowed by the owner's tool settings. Never wider than the default. */
export function effectivePolicy(base: ToolPolicy, o: CrewOverride = {}): ToolPolicy {
  const t = o.tools ?? {};
  return {
    agent: base.agent,
    allow: base.allow.filter((s) => t[s] !== "off"),
    requiresApproval: [...new Set([...base.requiresApproval, ...base.allow.filter((s) => t[s] === "ask")])],
    deny: base.deny,
  };
}

/** The role text the agent sees: owner instructions (or the default) plus owner rules. */
export function effectiveRole(defaultRole: string, o: CrewOverride = {}): string {
  const role = o.instructions?.trim() || defaultRole.trim();
  const rules = (o.rules ?? []).map((r) => r.trim()).filter(Boolean);
  return rules.length ? `${role}\n\n## Owner rules\n${rules.map((r) => `- ${r}`).join("\n")}` : role;
}

/** One line describing a change, for history and confirm cards. */
export function describeOverrideChange(agentName: string, before: CrewOverride, after: CrewOverride): string {
  const parts: string[] = [];
  if ((before.instructions ?? "") !== (after.instructions ?? "")) parts.push(after.instructions ? "edited instructions" : "reset instructions to default");
  const added = (after.rules ?? []).filter((r) => !(before.rules ?? []).includes(r));
  const removed = (before.rules ?? []).filter((r) => !(after.rules ?? []).includes(r));
  if (added.length) parts.push(`added rule${added.length > 1 ? "s" : ""}: ${added.map((r) => `"${r}"`).join(", ")}`);
  if (removed.length) parts.push(`removed rule${removed.length > 1 ? "s" : ""}: ${removed.map((r) => `"${r}"`).join(", ")}`);
  const label = { allowed: "allowed", ask: "ask me first", off: "off" };
  for (const s of new Set([...Object.keys(before.tools ?? {}), ...Object.keys(after.tools ?? {})])) {
    const a = before.tools?.[s] ?? "allowed", b = after.tools?.[s] ?? "allowed";
    if (a !== b) parts.push(`${s}: ${label[b]}`);
  }
  return parts.length ? `${agentName}: ${parts.join("; ")}` : `${agentName}: no change`;
}
