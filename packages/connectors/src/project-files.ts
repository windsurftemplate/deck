import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { GitHubRepo } from "./github.js";

/** Read-only access to one project's files, the shape `loadProjectGuide` in @deck/agents reads. */
export interface ProjectFileReader {
  read(path: string): Promise<string | null>;
  list(dir: string): Promise<string[]>;
}

const MAX_FILE = 200_000;
/** Files and folders that mark the top of a project. */
const MARKERS = [".git", "AGENTS.md", "CLAUDE.md", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "Makefile"];

/** Resolves a path inside root, following links, or null when it would leave root. */
function inside(root: string, path: string): string | null {
  const p = resolve(root, path);
  if (!existsSync(p)) return null;
  const real = realpathSync(p);
  return real === root || real.startsWith(root + sep) ? real : null;
}

/** A project folder on this computer. Reads never leave the folder, even through links, and skip large files. */
export function localProjectFiles(dir: string): ProjectFileReader {
  const root = realpathSync(dir);
  return {
    async read(path) {
      const p = inside(root, path);
      if (!p) return null;
      const st = statSync(p);
      return st.isFile() && st.size <= MAX_FILE ? readFileSync(p, "utf8") : null;
    },
    async list(path) {
      const p = inside(root, path);
      if (!p || !statSync(p).isDirectory()) return [];
      return readdirSync(p, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
    },
  };
}

/** A GitHub repository, read through the API with the owner's token. */
export function githubProjectFiles(repo: Pick<GitHubRepo, "list" | "read">): ProjectFileReader {
  const listing = new Map<string, Promise<string[]>>();
  const list = (dir: string) => {
    if (!listing.has(dir))
      listing.set(
        dir,
        repo.list(dir).then(
          (text) => text.split("\n").flatMap((l) => (/^dir /.test(l) ? [`${l.slice(4).trim()}/`] : /^file /.test(l) ? [l.slice(5).replace(/ \(\d+ bytes\)$/, "").trim()] : [])),
          () => [],
        ),
      );
    return listing.get(dir)!;
  };
  return {
    list,
    async read(path) {
      // The API answers missing files with text, so check the folder listing first.
      const at = path.lastIndexOf("/");
      const names = await list(at < 0 ? "" : path.slice(0, at));
      if (!names.includes(path.slice(at + 1))) return null;
      return repo.read(path).catch(() => null);
    },
  };
}

/** The nearest folder from dir up to stopAt (inclusive) that marks a project, or null. */
export function projectRootOf(dir: string, stopAt: string): string | null {
  const stop = realpathSync(stopAt);
  let d = existsSync(dir) ? realpathSync(dir) : null;
  while (d && (d === stop || d.startsWith(stop + sep))) {
    if (MARKERS.some((m) => existsSync(join(d!, m)))) return d;
    if (d === stop) break;
    d = resolve(d, "..");
  }
  return null;
}

/**
 * The project folder inside the shell workspace: the workspace itself when it is a project, otherwise its only
 * project subfolder. null when there is none, or more than one (the agent then names the folder).
 */
export function findProjectRoot(workspace: string): string | null {
  if (!existsSync(workspace)) return null;
  const root = realpathSync(workspace);
  if (MARKERS.some((m) => existsSync(join(root, m)))) return root;
  const subs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && MARKERS.some((m) => existsSync(join(root, e.name, m))));
  return subs.length === 1 ? join(root, subs[0]!.name) : null;
}

/** Folders that hold dependencies, builds, caches or editor state, never the project's own code. */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", ".venv", "venv", "env", "__pycache__", ".next", ".nuxt", ".turbo", ".cache", "coverage", "bin", "obj", ".idea", ".vscode", ".gradle", "Pods", "DerivedData", ".pnpm-store", ".mypy_cache", ".pytest_cache", ".tox", "site-packages"]);

/** Simple .gitignore lines at the project root: folder and file names, and *.ext patterns. Others are ignored. */
function rootIgnores(root: string): (rel: string, name: string, dir: boolean) => boolean {
  const lines = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("!")) : [];
  const names = new Set(lines.filter((l) => /^\/?[\w.-]+\/?$/.test(l)).map((l) => l.replace(/^\/|\/$/g, "")));
  const exts = lines.filter((l) => /^\*\.[\w]+$/.test(l)).map((l) => l.slice(1));
  return (_rel, name, dir) => names.has(name) || (!dir && exts.some((e) => name.endsWith(e)));
}

/** The commit checked out, read from .git without running Git. null outside a repository. */
export function gitHead(root: string): string | null {
  try {
    let git = join(root, ".git");
    if (!existsSync(git)) return null;
    if (statSync(git).isFile()) git = resolve(root, readFileSync(git, "utf8").replace(/^gitdir:\s*/, "").trim()); // worktree
    const head = readFileSync(join(git, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
    const ref = head.slice(4).trim();
    const common = existsSync(join(git, "commondir")) ? resolve(git, readFileSync(join(git, "commondir"), "utf8").trim()) : git;
    for (const g of [git, common]) if (existsSync(join(g, ref))) return readFileSync(join(g, ref), "utf8").trim();
    const packed = existsSync(join(common, "packed-refs")) ? readFileSync(join(common, "packed-refs"), "utf8") : "";
    return packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * A project folder for the code index: every file under it except dependency, build and ignored folders.
 * Links are not followed, so the walk never leaves the folder.
 */
export function localCodeFiles(dir: string, maxEntries = 50_000) {
  const root = realpathSync(dir);
  const reader = localProjectFiles(root);
  return {
    async list() {
      const ignored = rootIgnores(root);
      const out: { path: string; size: number; mtimeMs: number }[] = [];
      let seen = 0;
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (++seen > maxEntries) return;
          const p = join(d, e.name);
          const rel = relative(root, p).split(sep).join("/");
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name) && !ignored(rel, e.name, true)) walk(p);
          } else if (e.isFile() && !ignored(rel, e.name, false)) {
            const st = lstatSync(p);
            out.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
          }
        }
      };
      walk(root);
      return out;
    },
    read: (path: string) => reader.read(path),
    commit: async () => gitHead(root),
  };
}
