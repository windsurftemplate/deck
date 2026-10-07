import { describe, expect, it } from "vitest";
import { HashEmbedder } from "@deck/memory";
import { CodeIndex, type CodeFiles } from "./code-index.js";
import { FixMemory } from "./fixes.js";
import type { CodeIndexStore } from "./store.js";

/** A project held in memory. Writing a file bumps its modified time, like a real edit. */
export function memoryFiles(initial: Record<string, string>, commit: string | null = "c0ffee1") {
  const files = new Map(Object.entries(initial).map(([p, t]) => [p, { text: t, mtimeMs: 1 }]));
  let clock = 1;
  let head = commit;
  const api: CodeFiles & { write(p: string, t: string, keepTime?: boolean): void; remove(p: string): void; checkout(c: string): void; reads: string[] } = {
    reads: [],
    async list() {
      return [...files.entries()].map(([path, f]) => ({ path, size: Buffer.byteLength(f.text), mtimeMs: f.mtimeMs }));
    },
    async read(p) {
      api.reads.push(p);
      return files.get(p)?.text ?? null;
    },
    async commit() {
      return head;
    },
    write(p, t, keepTime = false) {
      const old = files.get(p);
      files.set(p, { text: t, mtimeMs: keepTime && old ? old.mtimeMs : ++clock });
    },
    remove(p) {
      files.delete(p);
    },
    checkout(c) {
      head = c;
    },
  };
  return api;
}

/**
 * Behavior every CodeIndexStore adapter must pass, through the CodeIndex that uses it. A new database is ready
 * when this suite is green against it: `codeIndexContract("postgres", (dim) => makeStore(dim))`.
 */
export function codeIndexContract(name: string, make: (dim: number | null) => Promise<CodeIndexStore>) {
  const SRC = {
    "src/billing.ts": "export function chargeCustomer(id: string, cents: number) {\n  return pay(id, cents);\n}\n\nexport class Invoice {\n  total(): number { return 0; }\n}\n",
    "src/auth.py": "def verify_password(user, password):\n    return check_hash(user.hash, password)\n",
    "README.md": "# Not code\n",
  };
  const setup = async (dim: number | null = 64, files = memoryFiles(SRC), project = "/work/app") => {
    const store = await make(dim);
    const index = new CodeIndex({ store, project, files, embedder: dim ? new HashEmbedder(dim) : null });
    return { store, files, index };
  };

  describe(`code index contract: ${name}`, () => {
    it("indexes code files only, at function and class boundaries, with hash and commit on every entry", async () => {
      const { index } = await setup();
      const r = await index.refresh();
      expect(r).toMatchObject({ files: 2, added: 2, changed: 0, removed: 0, commit: "c0ffee1", meaning: "on" });
      const { hits } = await index.search("chargeCustomer");
      expect(hits[0]).toMatchObject({ kind: "function", qualified: "chargeCustomer", path: "src/billing.ts", startLine: 1, endLine: 3, commit: "c0ffee1" });
      expect(hits[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hits[0]!.snippet).toContain("return pay(id, cents);");
      expect((await index.search("Invoice.total")).hits[0]).toMatchObject({ kind: "method", startLine: 6 });
    });

    it("finds code by identifier words and by keyword", async () => {
      const { index } = await setup();
      expect((await index.search("verify password")).hits[0]).toMatchObject({ qualified: "verify_password", path: "src/auth.py" });
      expect((await index.search("check_hash")).hits.map((h) => h.qualified)).toContain("verify_password");
    });

    it("re-indexes only what changed, and finds a renamed function by its new name and never at its old one", async () => {
      const { index, files } = await setup();
      await index.refresh();
      files.write("src/billing.ts", SRC["src/billing.ts"].replace("chargeCustomer", "billCustomer"));
      const { hits, report } = await index.search("billCustomer");
      expect(report).toMatchObject({ added: 0, changed: 1, removed: 0 });
      expect(hits[0]).toMatchObject({ qualified: "billCustomer", path: "src/billing.ts" });
      const old = await index.search("chargeCustomer");
      expect(old.hits.some((h) => h.qualified === "chargeCustomer")).toBe(false);
      // Unchanged files are not read again.
      files.reads.length = 0;
      await index.refresh();
      expect(files.reads).toEqual([]);
    });

    it("never serves an entry whose file changed, even when size and time did not", async () => {
      const { index, files } = await setup();
      await index.refresh();
      // Same length, same modified time: invisible to the quick check, caught when the hit is read.
      files.write("src/billing.ts", SRC["src/billing.ts"].replace("chargeCustomer", "chargeCustomex"), true);
      const { hits } = await index.search("chargeCustomer");
      expect(hits.some((h) => h.qualified === "chargeCustomer")).toBe(false);
      expect((await index.search("chargeCustomex")).hits[0]).toMatchObject({ qualified: "chargeCustomex" });
    });

    it("drops deleted files, keeps unchanged ones on a new commit, and keeps projects apart", async () => {
      const { index, files, store } = await setup();
      await index.refresh();
      files.remove("src/auth.py");
      files.checkout("beef123");
      const r = await index.refresh();
      expect(r).toMatchObject({ removed: 1, changed: 0, commit: "beef123" });
      expect((await index.search("verify_password")).hits.some((h) => h.path === "src/auth.py")).toBe(false);
      const other = new CodeIndex({ store, project: "/work/other", files: memoryFiles({ "x.go": "package x\nfunc Other() {}\n" }), embedder: new HashEmbedder(64) });
      await other.refresh();
      expect((await other.search("chargeCustomer")).hits.some((h) => h.path === "src/billing.ts")).toBe(false);
      expect((await index.search("Other")).hits.some((h) => h.path === "x.go")).toBe(false);
    });

    it("remembers a fix, recalls it for a repeat of the error, and flags it possibly stale once its files change", async () => {
      const store = await make(64);
      const files = memoryFiles({ "src/billing.ts": "export const rate = 0.2;\n" });
      const fixes = new FixMemory({ store, project: "/work/app", files, clock: () => new Date("2026-10-07T10:00:00Z") });
      const failing = "FAIL src/billing.test.ts > charges tax\nAssertionError: expected 120 to be 125\n ❯ src/billing.test.ts:14:22\nTests 1 failed | 4 passed (5) in 812ms";
      files.write("src/billing.ts", "export const rate = 0.25;\n");
      const saved = await fixes.remember({ error: failing, summary: "The tax rate was 0.2; set it to 0.25.", files: ["src/billing.ts"], testCommand: "pnpm test" });
      expect(saved).toMatchObject({ commit: "c0ffee1", files: [{ path: "src/billing.ts" }], testCommand: "pnpm test" });
      // The same failure later, with different line numbers and timings.
      const repeat = "FAIL src/billing.test.ts > charges tax\nAssertionError: expected 120 to be 125\n ❯ src/billing.test.ts:15:9\nTests 1 failed | 6 passed (7) in 1.2s";
      const [hit] = await fixes.recall(repeat);
      expect(hit).toMatchObject({ score: 1, changedSince: [] });
      expect(hit!.fix.summary).toBe("The tax rate was 0.2; set it to 0.25.");
      expect(await fixes.recall("TypeError: cannot read properties of undefined (reading 'name')")).toEqual([]);
      files.write("src/billing.ts", "export const rate = 0.2;\n");
      expect((await fixes.recall(repeat))[0]!.changedSince).toEqual(["src/billing.ts"]);
      files.remove("src/billing.ts");
      expect((await fixes.recall(repeat))[0]!.changedSince).toEqual(["src/billing.ts"]);
      expect(await new FixMemory({ store, project: "/work/other", files }).recall(repeat)).toEqual([]);
    });

    it("works without an embedder (name and keyword search only)", async () => {
      const { index } = await setup(null);
      const { hits, report } = await index.search("chargeCustomer");
      expect(report.meaning).toBe("off");
      expect(hits[0]).toMatchObject({ qualified: "chargeCustomer", via: ["name", "keyword"] });
    });
  });
}
