import { describe, expect, it } from "vitest";
import { MemoryReader } from "./read.js";
import type { MemoryStore } from "./store.js";
import { HashEmbedder } from "./testing.js";
import { MemoryWriter } from "./write.js";
import { chunkText, embedChunks, ingestDocument } from "./docs.js";

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

    it("skills: versions, approval status, outcomes; meta and episode cursors", async () => {
      const { store } = await setup();
      await store.saveSkill({ name: "prep-call", description: "Prepare a call", body: "1. Read notes" }, "2026-10-02T00:00:00Z");
      const v2 = await store.saveSkill({ name: "prep-call", description: "Prepare a call", body: "1. Read notes\n2. List asks" }, "2026-10-03T00:00:00Z");
      expect(v2).toMatchObject({ version: 2, status: "draft" });
      expect(await store.skills("active")).toEqual([]);
      await store.setSkillStatus("prep-call", "active");
      await store.recordSkillOutcome("prep-call", true);
      await store.recordSkillOutcome("prep-call", false);
      expect(await store.skill("prep-call")).toMatchObject({ version: 2, status: "active", successes: 1, failures: 1, body: "1. Read notes\n2. List asks" });
      expect(await store.getMeta("cursor")).toBeNull();
      await store.setMeta("cursor", "7");
      expect(await store.getMeta("cursor")).toBe("7");
      const ts = "2026-10-02T09:00:00Z";
      await store.addEpisode({ agent: "a", kind: "chat", summary: "one" }, ts, new Float32Array(DIM).fill(0.1));
      const second = await store.addEpisode({ agent: "b", kind: "task", summary: "two" }, ts, new Float32Array(DIM).fill(0.1));
      const first = (await store.episodesSince(0, 10))[0]!.id;
      expect((await store.episodesSince(first, 10)).map((e) => [e.id, e.kind])).toEqual([[second, "task"]]);
    });

    it("exports and imports without losing anything", async () => {
      const { store, w } = await setup();
      const ep = await w.logEpisode({ agent: "ops", kind: "note", summary: "Investor update sent" });
      await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Demo booked", source: "inferred" }, ep);
      await w.writeFact({ subject: "Acme", attribute: "stage", claim: "Pilot signed", source: "inferred" }, ep);
      await w.addEdge("Dana", "works at", "Acme");
      await w.recordFeedback({ actionId: "a1", agent: "gtm", verdict: "edit", before: "Hi", after: "Hello" });
      await store.saveSkill({ name: "s", description: "d", body: "b" }, "2026-10-02T00:00:00Z");
      await store.setMeta("cursor", "3");
      const dump = await store.exportAll(true);
      const copy = await make(DIM);
      await copy.importAll(dump);
      expect(await copy.exportAll(true)).toEqual(dump);
      expect(await copy.currentClaims("Acme")).toEqual(["Pilot signed"]);
      await expect(copy.importAll(dump)).rejects.toThrow(/empty store/);
    });
    it("stores, finds, updates and deletes documents; recall cites their passages", async () => {
      const { store, r } = await setup();
      const emb = new HashEmbedder(DIM);
      const text = "Acme Corp renewal notes.\n\nThe CISO, Dana Wright, wants SSO before signing. Budget is approved for Q1.\n\nNext step: security review call.";
      const { id, chunks } = await ingestDocument(store, emb, { title: "Acme notes", kind: "file", source: "acme.md", text }, "2026-10-01T00:00:00Z");
      expect(chunks).toBe(1);
      expect((await store.documents()).map((d) => d.title)).toEqual(["Acme notes"]);
      expect((await store.searchChunksByText("SSO signing", 3))[0]).toMatchObject({ docId: id, title: "Acme notes" });
      const recall = await r.retrieve("what does Dana want before signing");
      expect(recall.some((m) => m.id.startsWith(`doc:${id}.`) && m.text.includes("SSO"))).toBe(true);
      await store.updateDocument(id, { title: "Acme renewal", text: "Dana now also wants audit logs." }, await embedChunks(emb, "Acme renewal", "Dana now also wants audit logs."), "2026-10-02T00:00:00Z");
      expect(await store.searchChunksByText("SSO", 3)).toHaveLength(0);
      expect((await store.searchChunksByText("audit logs", 3))[0]!.title).toBe("Acme renewal");
      await store.deleteDocument(id);
      expect(await store.documents()).toHaveLength(0);
      expect(await store.searchChunksByText("audit", 3)).toHaveLength(0);
      expect(chunkText("short")).toEqual(["short"]);
      const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the project.`).join(" ");
      expect(chunkText(long, 400, 50).every((p) => p.length <= 400)).toBe(true);
    });
  });
}
