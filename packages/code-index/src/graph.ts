import { dirname, extname, posix } from "node:path";
import type { RefreshReport } from "./code-index.js";
import type { CodeIndexStore, StoredCodeChunk, StoredEdge } from "./store.js";

/**
 * The code graph: who imports a file, who calls a function or uses a type, and which tests reach it. Links are
 * stored per file (rebuilt with the file); imports are resolved against the current file list at question time,
 * so a file added later is never missed. Calls are matched by name, so each caller says how sure the match is.
 */

/** Test files by the usual conventions across languages. */
export function isTestFile(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec|specs)\//.test(path) || /[._-](test|spec)\.[a-z]+$/i.test(path) || /_test\.(go|py|rb|exs)$/.test(path) || /(^|\/)test_[^/]+\.py$/.test(path) || /Tests?\.(java|cs|kt|swift)$/.test(path);
}

const JS_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The project file (or, for Go, folder ending in "/") a module name refers to, or null when it is outside. */
export function resolveImport(from: string, spec: string, files: Set<string>, dirs: Set<string>): string | null {
  const ext = extname(from).toLowerCase();
  const first = (cands: string[]) => cands.map((c) => posix.normalize(c).replace(/^\.\//, "")).find((c) => files.has(c)) ?? null;
  if (JS_EXT.includes(ext)) {
    if (!spec.startsWith(".")) return null; // a package; links between packages are matched by name
    const base = posix.join(dirname(from), spec);
    const noJs = base.replace(/\.(m|c)?jsx?$/, "");
    return first([base, ...JS_EXT.map((e) => noJs + e), ...JS_EXT.map((e) => `${base}/index${e}`)]);
  }
  if (ext === ".py") {
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const mod = spec.slice(dots).replace(/\./g, "/");
    let dir = dots ? dirname(from) : "";
    for (let k = 1; k < dots; k++) dir = dirname(dir);
    const base = dots ? posix.join(dir, mod) : mod;
    return first([`${base}.py`, `${base}/__init__.py`, `src/${base}.py`, `src/${base}/__init__.py`]);
  }
  if (ext === ".go") {
    // Go imports name a folder: the longest project folder the import path ends with.
    const hit = [...dirs].filter((d) => d && (spec === d || spec.endsWith(`/${d}`))).sort((a, b) => b.length - a.length)[0];
    return hit ? `${hit}/` : null;
  }
  if (ext === ".java") {
    const p = spec.replace(/\.\*$/, "").replace(/\./g, "/");
    return [...files].find((f) => f.endsWith(`${p}.java`)) ?? (spec.endsWith(".*") && [...dirs].find((d) => d.endsWith(p)) ? `${[...dirs].find((d) => d.endsWith(p))}/` : null);
  }
  if (ext === ".rs") {
    const parts = spec.replace(/^(crate|self|super)::/, "").split("::").filter((x) => /^\w+$/.test(x));
    for (let n = parts.length; n > 0; n--) {
      const p = parts.slice(0, n).join("/");
      const got = first([`src/${p}.rs`, `src/${p}/mod.rs`]);
      if (got) return got;
    }
  }
  return null;
}

export interface GraphRef {
  path: string;
  /** The definition the link is in (the file path for top-level code). */
  from: string;
  line: number | null;
  /** sure: same file, imports the file, same Go package, or the only definition with that name. name: the name matches but another definition shares it. */
  match: "sure" | "name";
}

export interface Impact {
  target: Pick<StoredCodeChunk, "path" | "qualified" | "kind" | "startLine" | "endLine">;
  callers: GraphRef[];
  /** Files that import the target's file. */
  importers: string[];
  /** Tests that call it (direct) or call one of its callers (via). */
  tests: { path: string; from: string; via: string | null; match: "sure" | "name" }[];
}

const short = (q: string) => q.split(".").pop() ?? q;

/** What depends on a function, method, class or type: callers, importing files, and the tests that reach it. */
export async function codeImpact(o: { store: CodeIndexStore; project: string; refresh: () => Promise<RefreshReport> }, name: string): Promise<{ report: RefreshReport; impacts: Impact[] }> {
  const report = await o.refresh();
  const { store, project } = o;
  const n = name.trim();
  const targets = (await store.byName(project, n, 20)).filter((c) => c.kind !== "file" && c.kind !== "lines" && (c.qualified.toLowerCase() === n.toLowerCase() || c.name.toLowerCase() === n.toLowerCase()));
  if (!targets.length) return { report, impacts: [] };
  const fileList = (await store.files(project)).map((f) => f.path);
  const files = new Set(fileList);
  const dirs = new Set(fileList.map((f) => dirname(f)).filter((d) => d !== "."));
  // Who imports what, resolved now against the current files.
  const imports = new Map<string, Set<string>>();
  for (const e of await store.edges(project, { kind: "import" })) {
    const to = resolveImport(e.path, e.name, files, dirs);
    if (to) (imports.get(e.path) ?? imports.set(e.path, new Set()).get(e.path)!).add(to);
  }
  const importsFile = (p: string, target: string) => {
    const s = imports.get(p);
    return !!s && (s.has(target) || s.has(`${dirname(target)}/`));
  };
  const lineOf = async (path: string, from: string) => (from === path ? null : ((await store.byName(project, from, 10)).find((c) => c.path === path && c.qualified === from)?.startLine ?? null));
  const sameGoPackage = (a: string, b: string) => a.endsWith(".go") && b.endsWith(".go") && dirname(a) === dirname(b);

  /** Links to a name, each judged sure or by-name-only against the file that defines it. */
  const refsTo = async (defName: string, defPath: string, defQualified: string, kinds: StoredEdge["kind"][]) => {
    const defs = new Set((await store.byName(project, defName, 50)).filter((c) => c.name === defName && c.kind !== "file").map((c) => c.path));
    const out: GraphRef[] = [];
    for (const kind of kinds)
      for (const e of await store.edges(project, { kind, name: defName })) {
        if (e.path === defPath && e.from === defQualified) continue; // recursion
        const match = e.path === defPath || importsFile(e.path, defPath) || sameGoPackage(e.path, defPath) || defs.size === 1 ? "sure" : "name";
        // Calls a same-named definition it imports from elsewhere (or defines itself): not a caller of this one.
        if (match === "name" && [...defs].some((d) => d !== defPath && (d === e.path || importsFile(e.path, d) || sameGoPackage(e.path, d)))) continue;
        if (!out.some((r) => r.path === e.path && r.from === e.from)) out.push({ path: e.path, from: e.from, line: null, match });
      }
    for (const r of out) r.line = await lineOf(r.path, r.from);
    return out.sort((a, b) => Number(a.match === "name") - Number(b.match === "name") || a.path.localeCompare(b.path));
  };

  const impacts: Impact[] = [];
  for (const t of targets.slice(0, 5)) {
    const isType = ["class", "interface", "type", "enum", "struct", "trait"].includes(t.kind);
    const callers = await refsTo(t.name, t.path, t.qualified, isType ? ["call", "type"] : ["call"]);
    const importers = fileList.filter((p) => p !== t.path && importsFile(p, t.path));
    const tests: Impact["tests"] = callers.filter((c) => isTestFile(c.path)).map((c) => ({ path: c.path, from: c.from, via: null, match: c.match }));
    // One hop: tests that call a (non-test) caller.
    for (const c of callers.filter((x) => !isTestFile(x.path) && x.match === "sure" && x.from !== x.path))
      for (const r of await refsTo(short(c.from), c.path, c.from, ["call"]))
        if (isTestFile(r.path) && !tests.some((x) => x.path === r.path && x.from === r.from)) tests.push({ path: r.path, from: r.from, via: c.from, match: r.match });
    impacts.push({ target: { path: t.path, qualified: t.qualified, kind: t.kind, startLine: t.startLine, endLine: t.endLine }, callers: callers.filter((c) => !isTestFile(c.path)), importers, tests });
  }
  return { report, impacts };
}

/** The impact as text for an agent: what to check and which tests to run if this changes. */
export function formatImpact(name: string, impacts: Impact[], r: RefreshReport): string {
  const head = `Code graph at commit ${r.commit?.slice(0, 10) ?? "none"}; this question re-indexed ${r.added + r.changed} changed file(s). Calls are matched by name: "sure" means same file, imported, same package or the only definition with that name.`;
  if (!impacts.length) return `${head}\nNo function, method, class or type named "${name}".`;
  const at = (x: { path: string; line: number | null }) => (x.line ? `${x.path}:${x.line}` : x.path);
  return [
    head,
    ...impacts.map((i) => {
      const callers = i.callers.length ? i.callers.slice(0, 40).map((c) => `  - ${c.from === c.path ? "(top level)" : c.from} at ${at(c)}${c.match === "name" ? " (name match only)" : ""}`).join("\n") : "  - none found";
      const tests = i.tests.length ? i.tests.slice(0, 40).map((t) => `  - ${t.path}${t.from !== t.path ? ` (${t.from})` : ""}${t.via ? ` via ${t.via}` : ""}${t.match === "name" ? " (name match only)" : ""}`).join("\n") : "  - none found: changing it is not covered by any test that calls it";
      return `\n${i.target.kind} ${i.target.qualified} at ${i.target.path}:${i.target.startLine}-${i.target.endLine}\nCallers and users (${i.callers.length}):\n${callers}\nFiles that import ${i.target.path} (${i.importers.length}): ${i.importers.slice(0, 30).join(", ") || "none"}\nTests that reach it (${i.tests.length}):\n${tests}`;
    }),
  ].join("\n");
}
