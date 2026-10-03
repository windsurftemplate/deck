import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A workspace pack: a starting setup for a kind of work. Packs only add context and caution:
 * crew rules (which can only narrow an agent), approved skills, starter issues, interview prompts
 * and a default preset. They never add tools or switch off locked rules.
 */
export interface Pack {
  id: string;
  name: string;
  description: string;
  /** The approval preset the pack suggests. */
  preset: "cautious" | "balanced" | "autonomous";
  /** Extra rules per agent (added under "Owner rules"). */
  rules: Record<string, string[]>;
  /** Tool settings per agent: "ask" or "off" only. */
  tools: Record<string, Record<string, "ask" | "off">>;
  skills: { name: string; description: string; steps: string[] }[];
  issues: { title: string; body?: string; priority?: 0 | 1 | 2 | 3 | 4 }[];
  /** Placeholder hints for the onboarding interview. */
  interview: Record<string, string>;
}

const AGENTS = ["chief-of-staff", "gtm", "ops", "code", "research"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "packs");

/** Checks a pack's shape and safety limits. Returns a list of problems (empty when valid). */
export function checkPack(p: Pack): string[] {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(p.id)) errs.push("id must be lowercase letters, digits and dashes");
  if (!p.name?.trim() || !p.description?.trim()) errs.push("name and description are required");
  if (!["cautious", "balanced", "autonomous"].includes(p.preset)) errs.push("preset must be cautious, balanced or autonomous");
  for (const [agent, rules] of Object.entries(p.rules ?? {})) {
    if (!AGENTS.includes(agent)) errs.push(`unknown agent ${agent}`);
    if (rules.length > 20 || rules.some((r) => !r.trim() || r.length > 300)) errs.push(`rules for ${agent} must be 1 to 300 characters, 20 at most`);
  }
  for (const [agent, tools] of Object.entries(p.tools ?? {})) {
    if (!AGENTS.includes(agent)) errs.push(`unknown agent ${agent}`);
    for (const [scope, mode] of Object.entries(tools)) if (!["ask", "off"].includes(mode)) errs.push(`${agent} ${scope}: packs may only set "ask" or "off"`);
  }
  for (const k of p.skills ?? []) {
    if (!/^[a-z0-9-]{3,48}$/.test(k.name)) errs.push(`skill name ${k.name} must be kebab-case`);
    if (k.steps.length < 2 || k.steps.length > 8) errs.push(`skill ${k.name} needs 2 to 8 steps`);
  }
  for (const i of p.issues ?? []) if (!i.title?.trim()) errs.push("every starter issue needs a title");
  return errs;
}

/** All packs shipped with the app, in display order (blank last). */
export function listPacks(dir = root): Pack[] {
  const packs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, "pack.json"), "utf8")) as Pack);
  for (const p of packs) {
    const errs = checkPack(p);
    if (errs.length) throw new Error(`pack ${p.id}: ${errs.join("; ")}`);
  }
  return packs.sort((a, b) => (a.id === "blank" ? 1 : b.id === "blank" ? -1 : a.name.localeCompare(b.name)));
}

export function getPack(id: string, dir = root): Pack | undefined {
  return listPacks(dir).find((p) => p.id === id);
}
