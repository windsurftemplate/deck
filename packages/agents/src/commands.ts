import type { ModelChoice, Provider } from "@deck/settings";

export type Role = "heavy" | "cheap" | "fallback";
export type ModelCommand =
  | { kind: "show" }
  | { kind: "switch"; roles: Role[]; provider: Provider; model: string | null }
  | { kind: "clear-backup" };

const PROVIDER_WORDS: [RegExp, Provider][] = [
  [/\b(claude|anthropic|sonnet|opus|haiku)\b/i, "anthropic"],
  [/\b(gpt[\w.-]*|openai|chatgpt|o\d[\w.-]*)\b/i, "openai"],
  [/\bgemini[\w.-]*\b/i, "gemini"],
  [/\bgoogle\b(?=.*\b(model|models|llm|ai)\b)/i, "gemini"],
  [/\bopen\s?router\b/i, "openrouter"],
];
const ROLE_WORDS: [RegExp, Role][] = [
  [/\b(backup|fallback|fall back)\b/i, "fallback"],
  [/\b(quick|cheap|small|fast|light|triage|summar\w*)\b/i, "cheap"],
  [/\b(heavy|main|big|planning|writing|code|coding|hard)\b/i, "heavy"],
];
const SWITCH = /\b(use|switch|change|swap|set|move|run|put)\b/i;

/** Pulls an explicit model id out of the text, like "gpt-x-mini" or "gemini-pro-x" or "vendor/model". */
function modelId(text: string, provider: Provider): string | null {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9._:/@-]*[A-Za-z0-9]/g) ?? [];
  const looksLikeId = (t: string) => /\d|[-/]/.test(t) && t.length >= 3;
  const byProvider: Record<Provider, RegExp> = {
    anthropic: /^claude-/i,
    openai: /^(gpt|o\d|chatgpt)[\w.-]*$/i,
    gemini: /^gemini-/i,
    openrouter: /\//,
  };
  return tokens.find((t) => looksLikeId(t) && byProvider[provider].test(t)) ?? null;
}

/**
 * Understands owner requests about which models the crew uses. Deterministic: no model call,
 * so it works even when the current model is broken. Returns null when the text is not about models.
 */
export function parseModelCommand(text: string): ModelCommand | null {
  const t = text.trim();
  if (t.length > 300) return null;
  if (/\b(which|what)\b.*\b(model|models|llm|provider)\b/i.test(t) || /\bmodels?\b.*\b(using|in use|now)\??$/i.test(t)) return { kind: "show" };
  if (/\b(remove|clear|turn off|no)\b.*\b(backup|fallback)\b/i.test(t)) return { kind: "clear-backup" };
  const provider = PROVIDER_WORDS.find(([re]) => re.test(t))?.[1];
  if (!provider || !SWITCH.test(t)) return null;
  const roles = ROLE_WORDS.filter(([re]) => re.test(t)).map(([, r]) => r);
  const everything = /\b(everything|all|both|every)\b/i.test(t);
  return { kind: "switch", roles: everything || !roles.length ? ["heavy", "cheap"] : roles, provider, model: modelId(t, provider) };
}

export const ROLE_LABEL: Record<Role, string> = { heavy: "heavy work", cheap: "quick tasks", fallback: "backup" };
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Claude", openai: "OpenAI", gemini: "Gemini", openrouter: "OpenRouter" };

export function describeModels(m: { heavy: ModelChoice; cheap: ModelChoice; fallback: ModelChoice | null }): string {
  const one = (c: ModelChoice) => `${PROVIDER_LABEL[c.provider]} ${c.model}`;
  return [`Heavy work: ${one(m.heavy)}`, `Quick tasks: ${one(m.cheap)}`, `Backup: ${m.fallback ? one(m.fallback) : "none"}`].join("\n");
}
