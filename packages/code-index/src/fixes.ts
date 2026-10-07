import { sha256, type CodeFiles } from "./code-index.js";
import type { CodeIndexStore, FixRecord } from "./store.js";

/**
 * Fix memory: "this error came from X; this change fixed it", tied to the commit and the files the fix changed.
 * A fix is only a lead: before it is offered again, the files are hashed and any that changed since are named,
 * so the agent knows the fix may no longer apply.
 */

/** Lines that say what went wrong, in the formats test runners and compilers use. */
const ERROR_LINE = /\b(error|errors|fail|failed|failure|exception|panic|panicked|assert|assertion|expected|traceback|cannot|undefined|not found|not defined|no such|unresolved|mismatch|TS\d{4}|E\d{4})\b/i;
const NOISE = /^\s*(at |File "|\d*\s*\||-->|\^+\s*$|❯ |⎯)/;

/** Normalizes failing output to the lines that identify the error: paths, line numbers, ids and timings removed. */
export function errorSignature(output: string): string {
  const lines = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/<\/?untrusted[^>]*>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.test(l));
  const pick = lines.filter((l) => ERROR_LINE.test(l));
  const chosen = (pick.length ? pick : lines.slice(-5)).map((l) =>
    l
      .replace(/(?:[A-Za-z]:)?[\w.@~-]*[/\\][\w./\\@~-]+/g, "<path>")
      .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{7,64}\b/gi, "<id>")
      .replace(/\b\d+(\.\d+)?\s?(ms|s|m)\b/g, "<time>")
      .replace(/\d+/g, "<n>")
      .replace(/\s+/g, " ")
      .toLowerCase(),
  );
  return [...new Set(chosen)].slice(0, 8).join("\n");
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []);

/** How alike two error signatures are, 0 to 1 (shared words over all words). Identical signatures score 1. */
export function errorSimilarity(a: string, b: string): number {
  if (a && a === b) return 1;
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

export interface RecalledFix {
  fix: FixRecord;
  score: number;
  /** Files the fix changed that are different now (or gone). Non-empty means the fix may be stale. */
  changedSince: string[];
}

export class FixMemory {
  constructor(private o: { store: CodeIndexStore; project: string; files: CodeFiles; clock?: () => Date; minScore?: number }) {}

  /** Records a fix. Hashes the changed files now, right after the fix, so later changes can be detected. */
  async remember(f: { error: string; summary: string; files: string[]; testCommand?: string | null }): Promise<FixRecord | null> {
    const signature = errorSignature(f.error);
    if (!signature || !f.files.length) return null;
    const files: FixRecord["files"] = [];
    for (const path of [...new Set(f.files)].slice(0, 40)) {
      const text = await this.o.files.read(path);
      if (text !== null) files.push({ path, hash: sha256(text) });
    }
    if (!files.length) return null;
    const rec: Omit<FixRecord, "id"> = { error: f.error.slice(-3000), signature, summary: f.summary.trim().slice(0, 1200), files, commit: await this.o.files.commit().catch(() => null), testCommand: f.testCommand ?? null, createdAt: (this.o.clock?.() ?? new Date()).toISOString() };
    return { ...rec, id: await this.o.store.addFix(this.o.project, rec) };
  }

  /** Earlier fixes for an error like this one, best first, each re-checked against the files as they are now. */
  async recall(errorOutput: string, limit = 3): Promise<RecalledFix[]> {
    const sig = errorSignature(errorOutput);
    if (!sig) return [];
    const min = this.o.minScore ?? 0.5;
    const found = (await this.o.store.listFixes(this.o.project, 500)).map((fix) => ({ fix, score: errorSimilarity(sig, fix.signature) })).filter((x) => x.score >= min).sort((a, b) => b.score - a.score || b.fix.id - a.fix.id).slice(0, limit);
    const out: RecalledFix[] = [];
    for (const { fix, score } of found) {
      const changedSince: string[] = [];
      for (const f of fix.files) {
        const text = await this.o.files.read(f.path);
        if (text === null || sha256(text) !== f.hash) changedSince.push(f.path);
      }
      out.push({ fix, score, changedSince });
    }
    return out;
  }
}

/** Recalled fixes as text for an agent. Always a lead to check, never an instruction. */
export function formatFixes(found: RecalledFix[]): string {
  if (!found.length) return "No earlier fix for an error like this.";
  return found
    .map(({ fix, score, changedSince }, k) => {
      const state = changedSince.length ? `POSSIBLY STALE: ${changedSince.join(", ")} changed since this fix; check before reusing it` : "the files it changed are as they were right after the fix";
      return `${k + 1}. Fixed on ${fix.createdAt.slice(0, 10)} at commit ${fix.commit?.slice(0, 10) ?? "none"} (match ${Math.round(score * 100)}%; ${state}).\nError: ${fix.signature.split("\n").slice(0, 3).join(" | ")}\nFiles: ${fix.files.map((f) => f.path).join(", ")}\nWhat fixed it: ${fix.summary}`;
    })
    .join("\n\n");
}
