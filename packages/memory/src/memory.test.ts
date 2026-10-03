import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryStoreContract } from "./contract.js";
import { HashEmbedder, InMemoryStore, MemoryReader, MemoryWriter, SqliteMemoryStore, ftsQuery, migrateMemory, openMemory } from "./index.js";

const KEY = "test-key-0123456789abcdef"; // gitleaks:allow (fake test key)
const tmp = () => join(mkdtempSync(join(tmpdir(), "mem-")), "m.db");

memoryStoreContract("sqlite", async (dim) => new SqliteMemoryStore({ path: ":memory:", key: KEY, dim }));
memoryStoreContract("in-memory", async (dim) => new InMemoryStore(dim));

describe("sqlite storage", () => {
  it("encrypts the file: wrong key fails, plaintext is not visible", () => {
    const path = tmp();
    const db = openMemory({ path, key: KEY, dim: 64 });
    db.prepare("INSERT INTO conversations (ts, channel, role, text) VALUES ('x','chat','user','secret-plan-alpha')").run();
    db.close();
    expect(readFileSync(path).includes(Buffer.from("secret-plan-alpha"))).toBe(false);
    expect(() => openMemory({ path, key: "wrong-key-0123456789abc", dim: 64 })).toThrow(/wrong key/); // gitleaks:allow
    const again = openMemory({ path, key: KEY, dim: 64 });
    expect((again.prepare("SELECT count(*) n FROM conversations").get() as { n: number }).n).toBe(1);
    again.close();
  });

  it("refuses a short key, a changed dimension, and a mismatched embedder", () => {
    expect(() => openMemory({ path: ":memory:", key: "short", dim: 64 })).toThrow(/at least 16/);
    const path = tmp();
    openMemory({ path, key: KEY, dim: 64 }).close();
    expect(() => openMemory({ path, key: KEY, dim: 128 })).toThrow(/re-embed/);
    expect(() => new MemoryWriter(new InMemoryStore(64), new HashEmbedder(32))).toThrow(/expects 64/);
  });

  it("drops superseded vectors so the index stays small", async () => {
    const store = new SqliteMemoryStore({ path: ":memory:", key: KEY, dim: 64 });
    const w = new MemoryWriter(store, new HashEmbedder(64));
    await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" });
    await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Pilot signed", source: "inferred" });
    expect((store.connection.prepare("SELECT count(*) n FROM vec_facts").get() as { n: number }).n).toBe(1);
  });

  it("respects the token budget", async () => {
    const store = new InMemoryStore(64);
    const emb = new HashEmbedder(64);
    const w = new MemoryWriter(store, emb);
    for (let i = 0; i < 30; i++) await w.writeFact({ subject: `Lead ${i}`, attribute: "note", claim: `Lead ${i} asked about pricing and security reviews in detail`, source: "inferred" });
    const got = await new MemoryReader(store, emb).retrieve("pricing security", { tokenBudget: 40 });
    expect(got.map((m) => m.text).join("").length).toBeLessThanOrEqual(160);
    expect(got.length).toBeGreaterThan(0);
  });

  it("keeps hostile text out of the FTS query syntax", () => {
    expect(ftsQuery('acme" OR 1=1 -- NEAR(')).toBe('"acme" OR "or" OR "near"');
    expect(ftsQuery("!!")).toBeNull();
  });
});

describe("switching databases", () => {
  const seed = async (store: InMemoryStore | SqliteMemoryStore, dim: number) => {
    const w = new MemoryWriter(store, new HashEmbedder(dim));
    const ep = await w.logEpisode({ agent: "gtm", kind: "email_reply", summary: "Acme replied: not until Q2" });
    await w.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" }, ep);
    await w.addEdge("Dana", "works at", "Acme");
  };

  it("moves from SQLite to another store with vectors intact", async () => {
    const from = new SqliteMemoryStore({ path: ":memory:", key: KEY, dim: 64 });
    await seed(from, 64);
    const to = new InMemoryStore(64);
    expect(await migrateMemory(from, to)).toEqual({ facts: 1, episodes: 1, reembedded: false });
    const texts = (await new MemoryReader(to, new HashEmbedder(64)).retrieve("Acme timing")).map((m) => m.text).join("\n");
    expect(texts).toContain("Not buying until Q2");
  });

  it("rebuilds vectors when the embedding size changes", async () => {
    const from = new InMemoryStore(64);
    await seed(from, 64);
    const to = new SqliteMemoryStore({ path: tmp(), key: KEY, dim: 32 });
    await expect(migrateMemory(from, new InMemoryStore(32))).rejects.toThrow(/pass an embedder/);
    expect((await migrateMemory(from, to, new HashEmbedder(32))).reembedded).toBe(true);
    const texts = (await new MemoryReader(to, new HashEmbedder(32)).retrieve("Acme timing")).map((m) => m.text).join("\n");
    expect(texts).toContain("Not buying until Q2");
    await to.close();
  });
});
