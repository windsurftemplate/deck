import type { CandidateFact } from "@deck/memory";
import type { ChatRequest, ChatResponse } from "@deck/models";
import type { ActionRecord, Verdict } from "./act.js";

type Chat = (req: ChatRequest) => Promise<ChatResponse>;

/** Pulls the first JSON object out of a model reply. Returns null instead of throwing. */
export function jsonFrom<T>(text: string): T | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
}

export const skillName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

/**
 * After a task passes its check, ask whether it showed a reusable procedure. Most tasks do not;
 * only clear, repeatable steps become a draft skill, and drafts are used only after the owner approves.
 */
export async function reflect(i: { chat: Chat; agent: string; goal: string; report: string; actions: ActionRecord[]; verdict?: Verdict }): Promise<SkillDraft | null> {
  if (!i.verdict?.passed || !i.actions.some((a) => a.status === "done" || a.status === "waiting")) return null;
  const res = await i.chat({
    system: [{ type: "text", text: 'You review finished work to find reusable procedures. Only propose a skill if the same steps would clearly help with similar tasks in future. Reply with JSON only: {"skill": null} or {"skill": {"name": "verb-noun-in-kebab-case", "description": "one line: when to use it", "steps": ["short imperative step", "..."]}}. 3 to 8 steps. No names of people or companies in the steps.' }],
    messages: [{ role: "user", content: `Agent: ${i.agent}\nGoal: ${i.goal}\nReport:\n${i.report.slice(0, 2000)}\nActions:\n${i.actions.map((a) => `- ${a.status}: ${a.summary}`).join("\n")}` }],
    maxTokens: 400,
    temperature: 0,
  });
  const j = jsonFrom<{ skill?: { name?: string; description?: string; steps?: unknown } | null }>(res.text);
  const k = j?.skill;
  if (!k || !k.name || !k.description || !Array.isArray(k.steps)) return null;
  const steps = k.steps.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  const name = skillName(k.name);
  if (steps.length < 2 || !name) return null;
  return { name, description: String(k.description).slice(0, 160), body: steps.map((x, n) => `${n + 1}. ${x}`).join("\n") };
}

/**
 * Nightly: read recent episodes and pull out lasting facts (people, companies, timing, decisions).
 * Every candidate still goes through the memory write gate (duplicates, vague claims, contradictions).
 */
export async function extractFacts(i: { chat: Chat; episodes: { summary: string; kind: string }[] }): Promise<CandidateFact[]> {
  if (!i.episodes.length) return [];
  const res = await i.chat({
    system: [{ type: "text", text: 'Extract lasting facts from these work notes: who people are, what companies need, timing, decisions, preferences of the owner. Skip anything temporary or obvious. Reply with JSON only: {"facts": [{"subject": "person or company or Owner", "topic": "short label like role or timing", "claim": "one specific sentence"}]}. Up to 15 facts. Use {"facts": []} if none.' }],
    messages: [{ role: "user", content: i.episodes.map((e) => `- (${e.kind}) ${e.summary}`).join("\n").slice(0, 8000) }],
    maxTokens: 900,
    temperature: 0,
  });
  const j = jsonFrom<{ facts?: { subject?: string; topic?: string; claim?: string }[] }>(res.text);
  return (j?.facts ?? [])
    .filter((f) => f.subject && f.claim)
    .slice(0, 15)
    .map((f) => ({ subject: String(f.subject).trim().slice(0, 80), attribute: String(f.topic ?? "note").trim().slice(0, 40) || "note", claim: String(f.claim).trim().slice(0, 300), source: "inferred" as const }));
}
