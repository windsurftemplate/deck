import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
