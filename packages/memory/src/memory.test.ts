import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HashEmbedder, MemoryReader, MemoryWriter, ftsQuery, openMemory } from "./index.js";

const KEY = "test-key-0123456789abcdef"; // gitleaks:allow (fake test key)
let t = Date.parse("2026-10-02T09:00:00Z");
const clock = () => new Date((t += 60_000));
const setup = () => {
  const db = openMemory({ path: ":memory:", key: KEY, dim: 64 });
  const emb = new HashEmbedder(64);
  return { db, w: new MemoryWriter(db, emb, clock), r: new MemoryReader(db, emb) };
};

describe("storage", () => {
  it("encrypts the file: wrong key fails, plaintext is not visible", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mem-")), "m.db");
    const db = openMemory({ path, key: KEY, dim: 64 });
    db.prepare("INSERT INTO conversations (ts, channel, role, text) VALUES ('x','chat','user','secret-plan-alpha')").run();
    db.close();
    expect(readFileSync(path).includes(Buffer.from("secret-plan-alpha"))).toBe(false);
    expect(() => openMemory({ path, key: "wrong-key-0123456789abc", dim: 64 })).toThrow(/wrong key/); // gitleaks:allow
    const again = openMemory({ path, key: KEY, dim: 64 });
    expect((again.prepare("SELECT count(*) n FROM conversations").get() as { n: number }).n).toBe(1);
    again.close();
  });

  it("refuses a short key and a changed embedding dimension", () => {
    expect(() => openMemory({ path: ":memory:", key: "short", dim: 64 })).toThrow(/at least 16/);
    const path = join(mkdtempSync(join(tmpdir(), "mem-")), "m.db");
    openMemory({ path, key: KEY, dim: 64 }).close();
    expect(() => openMemory({ path, key: KEY, dim: 128 })).toThrow(/re-embed/);
  });
});

describe("write gate", () => {
  it("adds new facts and ignores exact and near duplicates", async () => {
    const { w } = setup();
    const a = await w.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" });
    expect(a.verdict.kind).toBe("new");
    const b = await w.writeFact({ subject: "Acme", attribute: "timing", claim: "not buying until q2.", source: "inferred" });
    expect(b.verdict).toEqual({ kind: "duplicate", of: a.factId });
    const c = await w.writeFact({ subject: "Acme", attribute: "timing_note", claim: "Not buying until Q2", source: "inferred" });
    expect(c.verdict).toEqual({ kind: "duplicate", of: a.factId });
  });

  it("rejects vague claims", async () => {
    const { w } = setup();
    expect((await w.writeFact({ subject: "Acme", attribute: "x", claim: "stuff", source: "inferred" })).verdict.kind).toBe("rejected");
  });

  it("supersedes instead of overwriting, keeping history", async () => {
    const { db, w } = setup();
    const a = await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" });
    const b = await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Nurture until Q2", source: "inferred" });
    expect(b.verdict).toEqual({ kind: "update", replaces: a.factId });
    const old = db.prepare("SELECT valid_to, superseded_by FROM facts WHERE id = ?").get(a.factId) as { valid_to: string; superseded_by: number };
    expect(old.valid_to).toBeTruthy();
    expect(old.superseded_by).toBe(b.factId);
  });

  it("sends an inferred claim that contradicts a stated fact to the owner, then applies the decision", async () => {
    const { db, w } = setup();
    const a = await w.writeFact({ subject: "Pricing", attribute: "team tier", claim: "$99 per month", source: "stated" });
    const b = await w.writeFact({ subject: "Pricing", attribute: "team tier", claim: "$149 per month", source: "inferred" });
    expect(b.verdict).toEqual({ kind: "contradicts", existing: a.factId });
    expect(b.factId).toBeUndefined();
    expect(w.openReviews()).toHaveLength(1);
    const res = await w.resolveContradiction(b.reviewId!, true);
    const current = db.prepare("SELECT claim, source FROM facts WHERE subject = 'Pricing' AND valid_to IS NULL").all();
    expect(res?.verdict.kind).toBe("update");
    expect(current).toEqual([{ claim: "$149 per month", source: "stated" }]);
    expect(w.openReviews()).toHaveLength(0);
  });

  it("lets an external decider override the built-in verdict", async () => {
    const db = openMemory({ path: ":memory:", key: KEY, dim: 64 });
    const w = new MemoryWriter(db, new HashEmbedder(64), clock, async () => ({ kind: "rejected", reason: "decider said no" }));
    expect((await w.writeFact({ subject: "Acme", attribute: "x", claim: "Uses AWS", source: "inferred" })).verdict).toEqual({ kind: "rejected", reason: "decider said no" });
  });
});

describe("recall", () => {
  it("walkthrough: an email reply becomes facts, a graph link and recall later", async () => {
    const { w, r } = setup();
    const ep = await w.logEpisode({ agent: "gtm", kind: "email_reply", summary: "Acme replied: not until Q2, talk to our CISO Dana", rawRef: "gmail:abc" });
    await w.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" }, ep);
    await w.writeFact({ subject: "Dana", attribute: "role", claim: "CISO at Acme", source: "inferred" }, ep);
    await w.writeFact({ subject: "Globex", attribute: "timing", claim: "Ready to sign this month", source: "inferred" });
    w.addEdge("Dana", "works at", "Acme");
    const got = await r.retrieve("When should we contact Acme?");
    const texts = got.map((m) => m.text).join("\n");
    expect(texts).toContain("Acme: Not buying until Q2");
    expect(texts).toContain("Dana works at Acme");
    expect(got[0]!.text).toMatch(/Acme/);
    expect(MemoryReader.format(got)).toMatch(/^\[(fact|episode|edge):\d+\]/);
  });

  it("returns only current facts", async () => {
    const { w, r } = setup();
    await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" });
    await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Nurture until Q2", source: "inferred" });
    const texts = (await r.retrieve("Acme stage", { episodes: false })).map((m) => m.text);
    expect(texts).toContain("Acme: Nurture until Q2");
    expect(texts.join()).not.toContain("Demo booked");
  });

  it("respects the token budget", async () => {
    const { w, r } = setup();
    for (let i = 0; i < 30; i++) await w.writeFact({ subject: `Lead ${i}`, attribute: "note", claim: `Lead ${i} asked about pricing and security reviews in detail`, source: "inferred" });
    const got = await r.retrieve("pricing security", { tokenBudget: 40 });
    expect(got.map((m) => m.text).join("").length).toBeLessThanOrEqual(160);
    expect(got.length).toBeGreaterThan(0);
  });

  it("forget removes a subject completely", async () => {
    const { w, r } = setup();
    await w.writeFact({ subject: "Dana", attribute: "role", claim: "CISO at Acme", source: "inferred" });
    await w.writeFact({ subject: "Dana", attribute: "role", claim: "VP Security at Acme", source: "inferred" });
    w.addEdge("Dana", "works at", "Acme");
    expect(w.forgetSubject("Dana")).toBe(2);
    const texts = (await r.retrieve("Dana CISO security")).map((m) => m.text).join();
    expect(texts).not.toContain("Dana");
  });

  it("keeps hostile text out of the FTS query syntax", () => {
    expect(ftsQuery('acme" OR 1=1 -- NEAR(')).toBe('"acme" OR "or" OR "near"');
    expect(ftsQuery("!!")).toBeNull();
  });
});
