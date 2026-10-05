import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { checkSignature, newSigningKey, signSkill, verifySkill, type SkillSignature, type SkillVerification } from "@deck/agents";
import { redactSecrets, scanInjection } from "@deck/gate";
import { checkUrl } from "@deck/ingest";

/* ---------- skills hub: a catalog (index.json) of SKILL.md files, optionally signed ---------- */

export interface HubIndex {
  name: string;
  updated?: string;
  publisher?: { name: string; publicKey: string };
  skills: { name: string; description: string; path: string; sha256?: string; signature?: string; version?: string }[];
}
export interface HubEntry {
  hub: string;
  hubUrl: string;
  name: string;
  description: string;
  url: string;
  sigUrl: string | null;
  sha256: string | null;
}

const MAX_FILE = 200_000;

async function getText(url: string, f: typeof fetch, max = MAX_FILE): Promise<string> {
  const u = checkUrl(url);
  if (u.protocol !== "https:") throw new Error("Skills hubs must use https.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await f(u.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "deck/0.1 (skills hub)" } });
    if (!res.ok) throw new Error(`${u.hostname} returned ${res.status}.`);
    if (res.url) checkUrl(res.url);
    const text = await res.text();
    if (text.length > max) throw new Error("That file is too large for a skill.");
    return text;
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? `${u.hostname} took too long.` : (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

export async function readHub(hub: { name: string; url: string }, f: typeof fetch): Promise<HubEntry[]> {
  const idx = JSON.parse(await getText(hub.url, f, 1_000_000)) as HubIndex;
  if (!Array.isArray(idx?.skills)) throw new Error(`${hub.name}: not a skills hub index.`);
  return idx.skills.slice(0, 500).filter((s) => s && typeof s.name === "string" && typeof s.path === "string").map((s) => ({
    hub: hub.name,
    hubUrl: hub.url,
    name: s.name.slice(0, 64),
    description: String(s.description ?? "").slice(0, 300),
    url: new URL(s.path, hub.url).toString(),
    sigUrl: s.signature ? new URL(s.signature, hub.url).toString() : null,
    sha256: typeof s.sha256 === "string" ? s.sha256 : null,
  }));
}

/** Downloads one hub skill and its signature, and verifies it. The index hash must match the file too. */
export async function previewHubSkill(e: HubEntry, trusted: { name: string; publicKey: string }[], f: typeof fetch): Promise<{ skillMd: string; signature: SkillSignature | null; v: SkillVerification }> {
  const skillMd = await getText(e.url, f);
  let signature: SkillSignature | null = null;
  if (e.sigUrl) {
    try {
      signature = JSON.parse(await getText(e.sigUrl, f, 10_000)) as SkillSignature;
    } catch {
      signature = null;
    }
  }
  const v = verifySkill({ skillMd, signature, trusted });
  if (e.sha256 && e.sha256 !== v.sha256) {
    v.checks.push({ id: "index-hash", label: "Matches the hub's listing", status: "fail", detail: "The file differs from what the hub index lists." });
    v.verdict = "blocked";
  }
  return { skillMd, signature, v };
}

/** Signs every skill folder under `dir` with your key and writes index.json, ready to commit and publish. */
export function publishFolder(dir: string, publisher: string, key: { publicKey: string; privateKey: string }, hubName = "deck"): { index: string; signed: string[]; blocked: string[] } {
  const root = resolve(dir.replace(/^~(?=$|\/)/, homedir()));
  if (!existsSync(root)) throw new Error(`No folder at ${root}.`);
  const signed: string[] = [], blocked: string[] = [];
  const idx: HubIndex = { name: hubName, updated: new Date().toISOString(), publisher: { name: publisher, publicKey: key.publicKey }, skills: [] };
  for (const d of readdirSync(root).sort()) {
    const md = join(root, d, "SKILL.md");
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8");
    const v = verifySkill({ skillMd: text, files: listFiles(join(root, d)) });
    if (v.verdict === "blocked" || !v.skill) {
      blocked.push(`${d}: ${v.checks.filter((c) => c.status === "fail").map((c) => c.detail).join("; ")}`);
      continue;
    }
    writeFileSync(join(root, d, "SKILL.sig.json"), JSON.stringify(signSkill(text, publisher, key), null, 2) + "\n");
    idx.skills.push({ name: v.skill.name, description: v.skill.description, path: `${d}/SKILL.md`, sha256: v.sha256, signature: `${d}/SKILL.sig.json` });
    signed.push(v.skill.name);
  }
  const index = join(root, "index.json");
  writeFileSync(index, JSON.stringify(idx, null, 2) + "\n");
  return { index, signed, blocked };
}

function listFiles(dir: string, base = dir, out: { path: string; size: number }[] = []): { path: string; size: number }[] {
  if (out.length > 200) return out;
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".")) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, base, out);
    else out.push({ path: relative(base, p), size: st.size });
  }
  return out;
}

export const newKey = newSigningKey;
export { checkSignature };

/* ---------- OpenClaw import ---------- */

export interface OpenClawItem {
  kind: "user" | "memory" | "daily" | "persona" | "heartbeat" | "skill";
  file: string;
  title: string;
  chars: number;
  flags: string[];
  skill?: { name: string; verdict: string; checks: { label: string; status: string; detail: string }[]; scripts: number };
}
export interface OpenClawScan {
  root: string;
  workspace: string | null;
  items: OpenClawItem[];
  skipped: string[];
}

const PERSONA = ["SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md"];
/** Files and folders deck never reads: credentials, config with secrets, and session databases. */
const NEVER = /(^|\/)(auth-profiles\.json|openclaw\.json|\.env[^/]*|.*\.sqlite[^/]*|sessions|credentials|codex-home|\.git)(\/|$)/i;

/** Finds an OpenClaw install: `~/.openclaw` (its workspace and shared skills) or a workspace folder given directly. */
export function scanOpenClaw(input?: string): OpenClawScan {
  const raw = (input?.trim() || "~/.openclaw").replace(/^~(?=$|\/)/, homedir());
  const root = resolve(raw);
  if (!existsSync(root)) throw new Error(`Nothing found at ${root}. Point to your OpenClaw folder (usually ~/.openclaw) or its workspace.`);
  const ws = existsSync(join(root, "SOUL.md")) || existsSync(join(root, "AGENTS.md")) ? root : existsSync(join(root, "workspace")) ? join(root, "workspace") : null;
  const items: OpenClawItem[] = [];
  const skipped: string[] = [];
  const read = (p: string) => readFileSync(p, "utf8").slice(0, 400_000);
  const flags = (t: string) => {
    const f: string[] = [];
    const inj = scanInjection(t);
    if (inj.score >= 0.5) f.push(`looks like it instructs an AI (${inj.signals.slice(0, 2).join("; ")})`);
    const secrets = redactSecrets(t).findings.reduce((a, x) => a + x.count, 0);
    if (secrets) f.push(`${secrets} key or token${secrets > 1 ? "s" : ""} will be removed`);
    return f;
  };
  const add = (kind: OpenClawItem["kind"], file: string, title: string) => {
    if (NEVER.test(relative(root, file))) return skipped.push(relative(root, file));
    const t = read(file);
    if (!t.trim()) return;
    items.push({ kind, file, title, chars: t.length, flags: flags(t) });
  };
  if (ws) {
    if (existsSync(join(ws, "USER.md"))) add("user", join(ws, "USER.md"), "About you (USER.md)");
    if (existsSync(join(ws, "MEMORY.md"))) add("memory", join(ws, "MEMORY.md"), "Long-term memory (MEMORY.md)");
    const mem = join(ws, "memory");
    if (existsSync(mem)) for (const f of readdirSync(mem).filter((n) => /\.md$/i.test(n)).sort().slice(-400)) add("daily", join(mem, f), `Daily log ${f.replace(/\.md$/i, "")}`);
    for (const f of PERSONA) if (existsSync(join(ws, f))) add("persona", join(ws, f), `Persona and instructions (${f})`);
    if (existsSync(join(ws, "HEARTBEAT.md"))) add("heartbeat", join(ws, "HEARTBEAT.md"), "Heartbeat checklist (HEARTBEAT.md)");
  }
  const skillDirs = [ws && join(ws, "skills"), join(root, "skills"), join(homedir(), ".agents", "skills")].filter((d, i, a): d is string => !!d && existsSync(d) && a.indexOf(d) === i);
  for (const sd of skillDirs)
    for (const d of readdirSync(sd).sort().slice(0, 200)) {
      const md = join(sd, d, "SKILL.md");
      if (!existsSync(md)) continue;
      const text = read(md);
      const files = listFiles(join(sd, d));
      const v = verifySkill({ skillMd: text, files });
      items.push({ kind: "skill", file: md, title: v.skill?.name ?? d, chars: text.length, flags: [], skill: { name: v.skill?.name ?? d, verdict: v.verdict, checks: v.checks.map((c) => ({ label: c.label, status: c.status, detail: c.detail })), scripts: files.filter((x) => !/\.(md|txt|json|ya?ml)$/i.test(x.path)).length } });
    }
  for (const n of ["openclaw.json", "agents", ".env"]) if (existsSync(join(root, n))) skipped.push(n);
  return { root, workspace: ws, items, skipped: [...new Set(skipped)] };
}

export const readItem = (file: string) => readFileSync(file, "utf8").slice(0, 400_000);
export const ensureDir = (d: string) => mkdirSync(d, { recursive: true });
