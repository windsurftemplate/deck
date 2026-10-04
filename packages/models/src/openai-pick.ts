/**
 * OpenAI model choice without hard-coded names. OpenAI renames models often, so deck reads the list the key can
 * use and picks: the newest full reasoning model for heavy work, and the newest mini (else nano) for cheap work.
 */

/** Reasoning models: o-series and GPT-5 onward, excluding chat, audio, realtime, search, speech and image variants. */
export function isOpenAIReasoning(id: string): boolean {
  return /^(o\d|gpt-(?:[5-9]|\d{2}))/i.test(id) && !/chat-latest|audio|realtime|search|transcribe|tts|image|instruct|embedding/i.test(id);
}

const score = (id: string) => {
  const g = id.match(/^gpt-(\d+)(?:\.(\d+))?/i);
  if (g) return 1000 + Number(g[1]) * 100 + Number(g[2] ?? 0);
  const o = id.match(/^o(\d+)/i);
  return o ? Number(o[1]) * 10 : 0;
};
const tier = (id: string) => (/nano/i.test(id) ? "nano" : /mini/i.test(id) ? "mini" : /(^|-)pro(\b|-)/i.test(id) ? "pro" : "full");

export function pickOpenAIModels(ids: string[]): { heavy?: string; cheap?: string } {
  // Skip dated snapshots and special-purpose variants; prefer the plain alias that always points at the latest build.
  const c = ids.filter(isOpenAIReasoning).filter((id) => !/\d{4}-\d{2}-\d{2}/.test(id) && !/codex|cyber|preview|deep-research|oss/i.test(id));
  const best = (t: string) => c.filter((x) => tier(x) === t).sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b))[0];
  const heavy = best("full") ?? best("pro");
  const cheap = best("mini") ?? best("nano") ?? heavy;
  return { ...(heavy ? { heavy } : {}), ...(cheap ? { cheap } : {}) };
}
