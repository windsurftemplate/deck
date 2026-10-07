import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findProjectRoot, gitHead, githubProjectFiles, localCodeFiles, localProjectFiles } from "./index.js";

const made: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), "project-"));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("project files", () => {
  it("reads inside the project only, even through links, and skips large files", async () => {
    const outside = dir();
    writeFileSync(join(outside, "secret.txt"), "not yours");
    const p = dir();
    writeFileSync(join(p, "AGENTS.md"), "# Rules");
    mkdirSync(join(p, "docs"));
    writeFileSync(join(p, "docs", "a.md"), "a");
    writeFileSync(join(p, "big.txt"), "x".repeat(300_000));
    symlinkSync(join(outside, "secret.txt"), join(p, "link.txt"));
    const f = localProjectFiles(p);
    expect(await f.read("AGENTS.md")).toBe("# Rules");
    expect(await f.read("missing.md")).toBeNull();
    expect(await f.read("../" + outside.split("/").pop() + "/secret.txt")).toBeNull();
    expect(await f.read("link.txt")).toBeNull();
    expect(await f.read("big.txt")).toBeNull();
    expect(await f.list("")).toEqual(["AGENTS.md", "big.txt", "docs/", "link.txt"]);
    expect(await f.list("docs")).toEqual(["a.md"]);
    expect(await f.list("..")).toEqual([]);
  });

  it("finds the project in the workspace: the workspace itself, its only project, or none when unclear", () => {
    const ws = dir();
    expect(findProjectRoot(ws)).toBeNull();
    mkdirSync(join(ws, "app"));
    writeFileSync(join(ws, "app", "package.json"), "{}");
    mkdirSync(join(ws, "notes"));
    expect(findProjectRoot(ws)?.endsWith("/app")).toBe(true);
    mkdirSync(join(ws, "lib"));
    writeFileSync(join(ws, "lib", "Cargo.toml"), "");
    expect(findProjectRoot(ws)).toBeNull();
    writeFileSync(join(ws, "AGENTS.md"), "");
    expect(findProjectRoot(ws)).toBe(realpathSync(ws));
    expect(findProjectRoot(join(ws, "nope"))).toBeNull();
  });

  it("reads a GitHub repository through its listing, so missing files are null", async () => {
    const read: string[] = [];
    const repo = {
      list: async (p: string) => (p === "" ? "file AGENTS.md (12 bytes)\ndir docs" : p === "docs/adr" ? "file 0001-x.md (3 bytes)" : "Nothing at that path."),
      read: async (p: string) => (read.push(p), `text of ${p}`),
    };
    const f = githubProjectFiles(repo);
    expect(await f.list("")).toEqual(["AGENTS.md", "docs/"]);
    expect(await f.read("AGENTS.md")).toBe("text of AGENTS.md");
    expect(await f.read("README.md")).toBeNull();
    expect(await f.read("docs/adr/0001-x.md")).toBe("text of docs/adr/0001-x.md");
    expect(read).toEqual(["AGENTS.md", "docs/adr/0001-x.md"]);
  });

  it("lists a project's files for the code index, skipping dependencies, builds, ignored files and links", async () => {
    const p = dir();
    const put = (rel: string, text = "x") => (mkdirSync(join(p, rel, ".."), { recursive: true }), writeFileSync(join(p, rel), text));
    put("src/a.ts");
    put("src/deep/b.py");
    put("node_modules/lib/index.js");
    put("dist/a.js");
    put("generated/c.ts");
    put("src/d.log");
    put(".gitignore", "# build output\n/generated/\n*.log\n");
    symlinkSync(join(p, "src"), join(p, "again"));
    const files = await localCodeFiles(p).list();
    expect(files.map((f) => f.path).sort()).toEqual([".gitignore", "src/a.ts", "src/deep/b.py"]);
    expect(files[0]!.mtimeMs).toBeGreaterThan(0);
    expect(await localCodeFiles(p).read("src/a.ts")).toBe("x");
  });

  it("reads the checked-out commit from .git without running Git", () => {
    const p = dir();
    expect(gitHead(p)).toBeNull();
    const sha = "a".repeat(40);
    mkdirSync(join(p, ".git/refs/heads"), { recursive: true });
    writeFileSync(join(p, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(p, ".git/refs/heads/main"), `${sha}\n`);
    expect(gitHead(p)).toBe(sha);
    rmSync(join(p, ".git/refs/heads/main"));
    writeFileSync(join(p, ".git/packed-refs"), `# pack-refs\n${"b".repeat(40)} refs/heads/main\n`);
    expect(gitHead(p)).toBe("b".repeat(40));
    writeFileSync(join(p, ".git/HEAD"), `${"c".repeat(40)}\n`); // detached
    expect(gitHead(p)).toBe("c".repeat(40));
  });
});
