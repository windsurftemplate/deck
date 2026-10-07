import { openMemory } from "@deck/memory";
import { describe, expect, it } from "vitest";
import { codeIndexContract } from "./contract.js";
import { InMemoryCodeIndexStore, SqliteCodeIndexStore } from "./index.js";

codeIndexContract("in-memory", async (dim) => new InMemoryCodeIndexStore(dim));
codeIndexContract("sqlite", async (dim) => new SqliteCodeIndexStore(openMemory({ path: ":memory:", key: "k".repeat(32), dim: 64 }), dim));

describe("sqlite code index store", () => {
  it("starts over when the vector size changes (a different embedding model)", async () => {
    const db = openMemory({ path: ":memory:", key: "k".repeat(32), dim: 64 });
    const a = new SqliteCodeIndexStore(db, 64);
    await a.putFile("/p", { path: "a.ts", hash: "h", commit: null, size: 1, mtimeMs: 1 }, [{ path: "a.ts", name: "f", qualified: "f", kind: "function", startLine: 1, endLine: 1, signature: "function f()", text: "function f() {}", words: "f", vec: new Float32Array(64) }]);
    expect(await a.files("/p")).toHaveLength(1);
    const b = new SqliteCodeIndexStore(db, 32);
    expect(await b.files("/p")).toEqual([]);
    expect(await b.dim()).toBe(32);
  });

  it("rebuilds an index written in an older format", async () => {
    const db = openMemory({ path: ":memory:", key: "k".repeat(32), dim: 64 });
    const a = new SqliteCodeIndexStore(db, 64);
    await a.putFile("/p", { path: "a.ts", hash: "h", commit: null, size: 1, mtimeMs: 1 }, []);
    db.prepare("DELETE FROM code_meta WHERE key = 'format'").run(); // as written before the code graph
    expect(await new SqliteCodeIndexStore(db, 64).files("/p")).toEqual([]);
    await new SqliteCodeIndexStore(db, 64).putFile("/p", { path: "a.ts", hash: "h", commit: null, size: 1, mtimeMs: 1 }, []);
    expect(await new SqliteCodeIndexStore(db, 64).files("/p")).toHaveLength(1); // same format: kept
  });
});
