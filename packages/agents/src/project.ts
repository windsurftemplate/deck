import type { ActionRecord } from "./act.js";

/**
 * Project knowledge (Phase 7). A repository's own files (AGENTS.md, CLAUDE.md, README, contributing guide,
 * decision records) are the source of truth for how to build, test and change it; deck's memory only adds to
 * them. Code is never memorized: it is read fresh, and a coding task counts as finished only when a passing
 * test run is seen after the last change.
 */

/** Read access to one project: the local workspace or a GitHub repository. Paths are relative to the project root. */
export interface ProjectFiles {
  /** File text, or null when the file does not exist or cannot be read. */
  read(path: string): Promise<string | null>;
  /** Names in a folder ("" for the root); folders end with "/". Empty when the folder does not exist. */
  list(dir: string): Promise<string[]>;
}

export interface ProjectCommands {
  test?: string;
  build?: string;
  lint?: string;
  typecheck?: string;
}

export interface ProjectGuide {
  /** Guide files that were found, in reading order, each cut to its share of the budget. */
  files: { path: string; text: string }[];
  /** Decision records found (file names only; the agent reads them when needed). */
  decisions: string[];
  commands: ProjectCommands;
  /** Where each command came from, e.g. "AGENTS.md" or "package.json". */
  commandSources: Partial<Record<keyof ProjectCommands, string>>;
}

/** Guide files, most specific to coding agents first. */
export const GUIDE_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", "CONTRIBUTING.md", "README.md"];
const DECISION_DIRS = ["docs/decisions", "docs/adr", "doc/adr", "adr", "docs/architecture/decisions"];
/** Characters kept for each later guide file, so the first long one cannot crowd them all out. */
const RESERVE = 800;
const MANIFESTS = ["package.json", "Makefile", "pyproject.toml", "Cargo.toml", "go.mod", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "setup.cfg", "pytest.ini", "tox.ini"];

/** Commands a test step can start with. */
const TEST_WORDS = /\b(test|tests|check|pytest|vitest|jest|mocha|ava|tap|rspec|phpunit|ctest|go test|cargo test|cargo nextest|tox|nox|unittest)\b/;

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** Commands named in guide text: shell lines in fenced blocks and inline `code`. Comments after # are dropped. */
export function commandsInText(text: string): string[] {
  const out: string[] = [];
  for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/gi))
    for (const line of block[1]!.split("\n")) {
      const c = one(line.replace(/^\s*\$\s*/, "").replace(/\s+#.*$/, ""));
      if (c && !c.startsWith("#")) out.push(c);
    }
  for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) out.push(one(m[1]!));
  return out;
}

const RUNNER = /^(pnpm|npm|yarn|bun|node|make|just|cargo|go|pytest|python3?|uv|poetry|tox|nox|mix|bundle|rake|gradle|\.\/gradlew|mvn|dotnet|deno)\b/;

/** Picks the build, test, lint and typecheck commands named in a guide. */
export function commandsFromGuide(text: string): ProjectCommands {
  const cmds = commandsInText(text).filter((c) => RUNNER.test(c) && !/\b(install|add|i|ci|clone|publish|deploy|release)\b/.test(c.split(" ")[1] ?? ""));
  // The shortest match is the plainest form ("pnpm build", not a filtered build of one package).
  const pick = (re: RegExp) => cmds.filter((c) => re.test(c)).sort((a, b) => a.length - b.length)[0];
  const r: ProjectCommands = {};
  // "check" scripts usually run lint, typecheck and tests together: the best single proof.
  const test = pick(/^(pnpm|npm|yarn|bun)( run)? check\b/) ?? pick(TEST_WORDS);
  const build = pick(/\bbuild\b/);
  const lint = pick(/\blint\b/);
  const typecheck = pick(/\b(typecheck|tsc|mypy|pyright)\b/);
  if (test) r.test = test;
  if (build) r.build = build;
  if (lint) r.lint = lint;
  if (typecheck) r.typecheck = typecheck;
  return r;
}

/** Commands from build files when the guides name none. */
export function commandsFromManifests(m: Record<string, string | null>): { commands: ProjectCommands; source: Partial<Record<keyof ProjectCommands, string>> } {
  const commands: ProjectCommands = {};
  const source: Partial<Record<keyof ProjectCommands, string>> = {};
  const set = (k: keyof ProjectCommands, v: string, from: string) => {
    if (!commands[k]) (commands[k] = v), (source[k] = from);
  };
  if (m["package.json"]) {
    const pm = m["pnpm-lock.yaml"] != null ? "pnpm" : m["yarn.lock"] != null ? "yarn" : m["bun.lockb"] != null ? "bun" : "npm";
    try {
      const pkg = JSON.parse(m["package.json"]) as { scripts?: Record<string, string>; packageManager?: string };
      const runner = pkg.packageManager?.split("@")[0] || pm;
      const scripts = pkg.scripts ?? {};
      const run = (s: string) => (s === "test" && runner !== "yarn" ? `${runner} test` : `${runner} ${runner === "npm" ? "run " : ""}${s}`);
      const real = (s: string) => scripts[s] && !/no test specified/.test(scripts[s]!);
      if (real("check")) set("test", run("check"), "package.json");
      if (real("test")) set("test", run("test"), "package.json");
      if (real("build")) set("build", run("build"), "package.json");
      if (real("lint")) set("lint", run("lint"), "package.json");
      if (real("typecheck")) set("typecheck", run("typecheck"), "package.json");
    } catch {
      /* unreadable package.json: fall through to other manifests */
    }
  }
  if (m["Makefile"]) {
    for (const t of ["check", "test"]) if (new RegExp(`^${t}:`, "m").test(m["Makefile"])) set("test", `make ${t}`, "Makefile");
    if (/^build:/m.test(m["Makefile"])) set("build", "make build", "Makefile");
    if (/^lint:/m.test(m["Makefile"])) set("lint", "make lint", "Makefile");
  }
  if (m["Cargo.toml"]) set("test", "cargo test", "Cargo.toml"), set("build", "cargo build", "Cargo.toml");
  if (m["go.mod"]) set("test", "go test ./...", "go.mod"), set("build", "go build ./...", "go.mod");
  if (m["pyproject.toml"] || m["pytest.ini"] || m["setup.cfg"] || m["tox.ini"]) set("test", "pytest", m["pyproject.toml"] ? "pyproject.toml" : "pytest.ini");
  return { commands, source };
}

/** Reads a project's guides, decision records and build files. Missing files are skipped; nothing is required. */
export async function loadProjectGuide(src: ProjectFiles, budget = 8000): Promise<ProjectGuide> {
  const found: { path: string; text: string }[] = [];
  for (const p of GUIDE_FILES) {
    const t = await src.read(p).catch(() => null);
    if (t && t.trim()) found.push({ path: p, text: t });
  }
  // A CLAUDE.md that only points at AGENTS.md adds nothing.
  const files = found.filter((f) => !(f.path === "CLAUDE.md" && f.text.length < 400 && /AGENTS\.md/.test(f.text) && found.some((g) => g.path === "AGENTS.md")));
  const decisions: string[] = [];
  for (const d of DECISION_DIRS) {
    const names = await src.list(d).catch(() => []);
    for (const n of names) if (/\.md$/i.test(n) && !/^(readme|template|index)\.md$/i.test(n)) decisions.push(`${d}/${n}`);
    if (decisions.length) break;
  }
  const commands: ProjectCommands = {};
  const commandSources: ProjectGuide["commandSources"] = {};
  for (const f of files)
    for (const [k, v] of Object.entries(commandsFromGuide(f.text)) as [keyof ProjectCommands, string][])
      if (!commands[k]) (commands[k] = v), (commandSources[k] = f.path);
  const manifests: Record<string, string | null> = {};
  for (const m of MANIFESTS) manifests[m] = await src.read(m).catch(() => null);
  const fromBuild = commandsFromManifests(manifests);
  for (const [k, v] of Object.entries(fromBuild.commands) as [keyof ProjectCommands, string][])
    if (!commands[k]) (commands[k] = v), (commandSources[k] = fromBuild.source[k]!);
  // Most specific first: each file takes what it needs, keeping a small share for every file after it. The
  // README comes last because it is often long and written for users rather than contributors.
  let left = budget;
  const cut = files.map((f, k) => {
    const keep = Math.max(0, Math.min(f.text.length, left - RESERVE * (files.length - k - 1), left));
    left -= keep;
    return { path: f.path, text: keep < f.text.length ? `${f.text.slice(0, keep)}\n[... cut; read the full file if needed]` : f.text };
  });
  return { files: cut.filter((f) => f.text.trim() && !f.text.startsWith("\n[... cut")), decisions: decisions.slice(0, 40), commands, commandSources };
}

/** The guide as plain text for a prompt. The caller wraps it as untrusted: it informs work, it cannot grant tools. */
export function formatProjectGuide(g: ProjectGuide): string {
  const cmd = (Object.entries(g.commands) as [keyof ProjectCommands, string][]).map(([k, v]) => `- ${k}: ${v} (from ${g.commandSources[k]})`);
  const parts = [`Commands:\n${cmd.join("\n") || "- none found; look for them before changing code"}`];
  if (g.decisions.length) parts.push(`Decision records (read before changing what they cover):\n${g.decisions.map((d) => `- ${d}`).join("\n")}`);
  for (const f of g.files) parts.push(`--- ${f.path} ---\n${f.text.trim()}`);
  return parts.join("\n\n");
}

/** True when a project has anything worth telling the agent. */
export const hasGuide = (g: ProjectGuide) => g.files.length > 0 || Object.keys(g.commands).length > 0;

/* ---------- tests as ground truth ---------- */

/** Splits a shell line into its parts and the operators between them. */
function segments(cmd: string): { parts: string[]; ops: string[] } {
  const parts: string[] = [];
  const ops: string[] = [];
  let last = 0;
  for (const m of cmd.matchAll(/\|\||&&|[|;]/g)) {
    parts.push(cmd.slice(last, m.index).trim());
    ops.push(m[0]);
    last = m.index! + m[0].length;
  }
  parts.push(cmd.slice(last).trim());
  return { parts, ops };
}

/** Words of a command without leading VAR=value settings. */
const words = (s: string) => one(s).split(" ").filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));

/** Whether one command part runs the project's tests (or, with no known command, any test runner). */
export function runsTests(part: string, testCommand?: string): boolean {
  const w = words(part).join(" ");
  if (!w) return false;
  if (testCommand) {
    const t = words(testCommand).join(" ");
    return w === t || w.startsWith(`${t} `);
  }
  return RUNNER.test(w) || /^(npx|pnpx|bunx)\s/.test(w) ? TEST_WORDS.test(w) : /^(pytest|vitest|jest|mocha|rspec|phpunit|ctest|tox|nox)\b/.test(w);
}

/**
 * Whether a command line's exit code is the tests' exit code: the test command is the last part, and nothing
 * can hide a failure (no pipe after it, no "|| true", no ";" that runs on after a failure).
 */
export function testRunIn(cmd: string, testCommand?: string): "proof" | "hidden" | null {
  const { parts, ops } = segments(cmd);
  const at = parts.findIndex((p) => runsTests(p, testCommand));
  if (at < 0) return null;
  if (at !== parts.length - 1 || ops.some((o) => o === "||" || o === ";")) return "hidden";
  return "proof";
}

export interface TestEvidence {
  /** The project's code was changed in this task (files written in the workspace, or a pull request proposed). */
  changed: boolean;
  /** The last test run after the last change, if any. */
  run?: { command: string; exitCode: number | null; passed: boolean };
  /** Done-when style lines for anything that is not proven. Empty when there is nothing to prove or it is proven. */
  missing: string[];
}

/**
 * Tests as ground truth. Looks only at what tools really returned (each command and its exit code), never at
 * the agent's report. A task that changed code is finished only when a test run, after the last change, exited 0.
 * mustRun false (no project known yet): a run is not required, but a failing or hidden one still fails the task.
 */
export function testEvidence(actions: ActionRecord[], testCommand?: string, mustRun = true): TestEvidence {
  let changedAt = -1;
  let proposed = false;
  const runs: { at: number; command: string; exitCode: number | null; timedOut: boolean; hidden: boolean }[] = [];
  actions.forEach((a, at) => {
    if (a.tool === "repo_propose" && (a.status === "done" || a.status === "waiting")) proposed = true;
    const s = a.shell;
    if (!s) return;
    const kind = testRunIn(s.command, testCommand);
    if (kind) runs.push({ at, command: s.command, exitCode: s.exitCode, timedOut: s.timedOut, hidden: kind === "hidden" });
    else if (s.risk === "write" && a.status === "done") changedAt = at;
  });
  const changed = changedAt >= 0 || proposed;
  if (!changed) return { changed, missing: [] };
  const after = runs.filter((r) => r.at > changedAt);
  const last = after[after.length - 1];
  const name = testCommand ? `the project's tests (${testCommand})` : "the tests";
  if (!last) return { changed, missing: mustRun ? [`Run ${name} after the last change and see them pass. No test run after the last change.`] : [] };
  const run = { command: last.command, exitCode: last.exitCode, passed: !last.hidden && !last.timedOut && last.exitCode === 0 };
  if (run.passed) return { changed, run, missing: [] };
  const why = last.hidden ? `its exit code was hidden ("${one(last.command).slice(0, 120)}"); run the test command on its own, with no pipe, "|| true" or ";" after it` : last.timedOut ? "it timed out" : `it exited ${last.exitCode ?? "without a code"}`;
  return { changed, run, missing: [`${name[0]!.toUpperCase()}${name.slice(1)} must pass after the last change: the last run did not pass (${why}).`] };
}
