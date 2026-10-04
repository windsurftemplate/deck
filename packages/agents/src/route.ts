/**
 * Complexity routing: decides whether a request needs the heavy model or the cheap one is enough.
 * No model call: plain signals, so routing itself costs nothing. When unsure, it picks heavy.
 */
export function routeComplexity(text: string, history = 0): { level: "simple" | "complex"; reason: string } {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const hard = /\b(research|plan|strategy|analy[sz]e|compare|draft|write|design|why|explain|review|debug|propose|evaluate|summari[sz]e .{20,}|delegate|have (gtm|ops|operations|engineering|research)|every (day|week|monday|tuesday|wednesday|thursday|friday)|from now on|pros and cons|trade-?offs?)\b/i;
  const easy = /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|good morning|gm)\b|^(remember|note) that\b|^(create|add|open|close|mark|list|show|what is|what's|when is|who is|how many)\b/i;
  if (hard.test(t)) return { level: "complex", reason: "asks for thinking or writing" };
  if (words > 40 || t.split(/[.?!]\s/).length > 3) return { level: "complex", reason: "long or several parts" };
  if (easy.test(t) && words <= 25) return { level: "simple", reason: "short lookup or action" };
  if (words <= 6 && history > 0) return { level: "simple", reason: "short follow-up" };
  return { level: "complex", reason: "unsure, so the stronger model" };
}
