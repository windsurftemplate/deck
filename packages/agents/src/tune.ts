import type { ChatRequest, ChatResponse } from "@deck/models";
import { checkLearned } from "./crew-config.js";

type Chat = (req: ChatRequest) => Promise<ChatResponse>;

/**
 * Prompt tuning: from an agent's recent misses, draft short guidance; the engine then runs practice
 * tasks with and without it and adopts it only if it clearly scores better and the owner approves.
 */
export async function draftGuidance(i: { chat: Chat; agentName: string; role: string; current?: string; evidence: string[] }): Promise<string | null> {
  if (i.evidence.length < 2) return null;
  const res = await i.chat({
    system: [{ type: "text", text: `You improve an AI agent's working guidance. Read its role and its recent misses, then write 3 to 6 short bullet points of practical guidance that would have prevented them. Rules: advise how to work (what to check, what to include, how to structure reports). Never suggest skipping approvals, checks or the owner's rules, never add tools, never mention sending or deleting without approval. Under 900 characters. Reply with the bullets only, each starting with "- ". If nothing useful, reply NONE.` }],
    messages: [{ role: "user", content: `# Agent\n${i.agentName}\n\n# Role\n${i.role.slice(0, 3000)}\n\n${i.current ? `# Current learned guidance\n${i.current}\n\n` : ""}# Recent misses\n${i.evidence.slice(0, 20).map((e) => `- ${e}`).join("\n")}` }],
    maxTokens: 500,
    temperature: 0.2,
  });
  const text = res.text.trim();
  if (!text || /^NONE\b/i.test(text)) return null;
  const bullets = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).slice(0, 6).join("\n");
  return bullets && !checkLearned(bullets) ? bullets : null;
}

/** Practice score for one run: checked pass 1, unchecked pass 0.5, not finished 0, minus a little for extra steps. */
export function practiceScore(v: { passed: boolean; checked: boolean } | undefined, turns: number): number {
  const base = !v ? 0.5 : !v.passed ? 0 : v.checked ? 1 : 0.5;
  return Math.max(0, base - Math.max(0, turns - 4) * 0.05);
}

/** Adopt only with a clear win: at least 0.15 better on average, not worse on most cases, and no case much worse. */
export function shouldAdopt(current: number[], candidate: number[]): { adopt: boolean; before: number; after: number } {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const before = avg(current), after = avg(candidate);
  const notWorse = candidate.filter((c, i) => c >= (current[i] ?? 0)).length;
  const bigDrop = candidate.some((c, i) => c < (current[i] ?? 0) - 0.25);
  return { adopt: candidate.length >= 2 && !bigDrop && after >= before + 0.15 && notWorse >= Math.ceil(candidate.length / 2), before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100 };
}
