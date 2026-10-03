import { describe, expect, it } from "vitest";
import { MemoryReader } from "./read.js";
import type { MemoryStore } from "./store.js";
import { HashEmbedder } from "./testing.js";
import { MemoryWriter } from "./write.js";

/**
 * Behavior every MemoryStore adapter must pass. A new database (Postgres, LanceDB, a server)
 * is ready when this suite is green against it: `memoryStoreContract("postgres", () => makeStore(64))`.
 */
export function memoryStoreContract(name: string, make: (dim: number) => Promise<MemoryStore>) {
  const DIM = 64;
  let t = Date.parse("2026-10-02T09:00:00Z");
  const clock = () => new Date((t += 60_000));
  const setup = async () => {
    const store = await make(DIM);
    const emb = new HashEmbedder(DIM);
    return { store, w: new MemoryWriter(store, emb, clock), r: new MemoryReader(store, emb) };
  };

  describe(`memory store contract: ${name}`, () => {
    it("adds new facts and ignores exact and near duplicates", async () => {
      const { w } = await setup();
      const a = await w.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" });
      expect(a.verdict.kind).toBe("new");
      expect((await w.writeFact({ subject: "Acme", attribute: "timing", claim: "not buying until q2.", source: "inferred" })).verdict).toEqual({ kind: "duplicate", of: a.factId });
      expect((await w.writeFact({ subject: "Acme", attribute: "timing_note", claim: "Not buying until Q2", source: "inferred" })).verdict).toEqual({ kind: "duplicate", of: a.factId });
    });

    it("rejects vague claims", async () => {
      const { w } = await setup();
      expect((await w.writeFact({ subject: "Acme", attribute: "x", claim: "stuff", source: "inferred" })).verdict.kind).toBe("rejected");
    });

    it("supersedes instead of overwriting, and recall returns only current facts", async () => {
      const { store, w, r } = await setup();
      const a = await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" });
      const b = await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Nurture until Q2", source: "inferred" });
      expect(b.verdict).toEqual({ kind: "update", replaces: a.factId });
      expect(await store.currentClaims("Acme")).toEqual(["Nurture until Q2"]);
      const dump = await store.exportAll(false);
      expect(dump.facts.find((f) => f.id === a.factId)).toMatchObject({ supersededBy: b.factId, validTo: expect.any(String) });
      const texts = (await r.retrieve("Acme stage", { episodes: false })).map((m) => m.text).join("\n");
      expect(texts).toContain("Nurture until Q2");
      expect(texts).not.toContain("Demo booked");
    });

    it("sends contradictions of stated facts to the owner and applies the decision", async () => {
      const { store, w } = await setup();
      const a = await w.writeFact({ subject: "Pricing", attribute: "team tier", claim: "$99 per month", source: "stated" });
      const b = await w.writeFact({ subject: "Pricing", attribute: "team tier", claim: "$149 per month", source: "inferred" });
      expect(b.verdict).toEqual({ kind: "contradicts", existing: a.factId });
      expect(await w.openReviews()).toHaveLength(1);
      expect((await w.resolveContradiction(b.reviewId!, true))?.verdict.kind).toBe("update");
      expect(await w.resolveContradiction(b.reviewId!, true)).toBeNull();
      expect(await store.currentClaims("Pricing")).toEqual(["$149 per month"]);
    });

    it("recalls facts, episodes and one graph hop", async () => {
      const { w, r } = await setup();
      const ep = await w.logEpisode({ agent: "gtm", kind: "email_reply", summary: "Acme replied: not until Q2, talk to our CISO Dana" });
      await w.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" }, ep);
      await w.writeFact({ subject: "Globex", attribute: "timing", claim: "Ready to sign this month", source: "inferred" });
      await w.addEdge("Dana", "works at", "Acme");
      const got = await r.retrieve("When should we contact Acme?");
      const texts = got.map((m) => m.text).join("\n");
      expect(texts).toContain("Acme: Not buying until Q2");
      expect(texts).toContain("Dana works at Acme");
      expect(texts).toContain("talk to our CISO Dana");
      expect(got[0]!.text).toMatch(/Acme/);
    });

    it("forget removes a subject completely", async () => {
      const { store, w, r } = await setup();
      await w.writeFact({ subject: "Dana", attribute: "role", claim: "CISO at Acme", source: "inferred" });
      await w.writeFact({ subject: "Dana", attribute: "role", claim: "VP Security at Acme", source: "inferred" });
      await w.addEdge("Dana", "works at", "Acme");
      expect(await w.forgetSubject("Dana")).toBe(2);
      expect((await store.exportAll(false)).facts).toHaveLength(0);
      expect((await r.retrieve("Dana CISO security")).map((m) => m.text).join()).not.toContain("Dana");
    });

    it("exports and imports without losing anything", async () => {
      const { store, w } = await setup();
      const ep = await w.logEpisode({ agent: "ops", kind: "note", summary: "Investor update sent" });
      await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" }, ep);
      await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Pilot signed", source: "inferred" }, ep);
      await w.addEdge("Dana", "works at", "Acme");
      await w.recordFeedback({ actionId: "a1", agent: "gtm", verdict: "edit", before: "Hi", after: "Hello" });
      const dump = await store.exportAll(true);
      const copy = await make(DIM);
      await copy.importAll(dump);
      expect(await copy.exportAll(true)).toEqual(dump);
      expect(await copy.currentClaims("Acme")).toEqual(["Pilot signed"]);
      await expect(copy.importAll(dump)).rejects.toThrow(/empty store/);
    });
  });
}
