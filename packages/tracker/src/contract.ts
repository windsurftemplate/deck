import { describe, expect, it } from "vitest";
import type { TrackerStore } from "./store.js";
import { Tracker } from "./tracker.js";

/** Behavior every TrackerStore adapter must pass. */
export function trackerStoreContract(name: string, make: () => Promise<TrackerStore>) {
  let t = Date.parse("2026-10-02T09:00:00Z");
  const setup = async () => new Tracker(await make(), "VP", () => new Date((t += 60_000)));

  describe(`tracker store contract: ${name}`, () => {
    it("creates keyed issues with clean labels", async () => {
      const tr = await setup();
      const a = await tr.create({ title: "Gateway retry on 529", priority: 2, labels: ["Gateway", "gateway", " bug "], by: "owner" });
      const b = await tr.create({ title: "Design partner follow-up: Acme", by: "chief-of-staff" });
      expect([a.key, b.key]).toEqual(["VP-1", "VP-2"]);
      expect(a.labels).toEqual(["gateway", "bug"]);
      await expect(tr.create({ title: "  ", by: "x" })).rejects.toThrow(/title/);
      await expect(tr.create({ title: "x", due: "Friday", by: "x" })).rejects.toThrow(/YYYY-MM-DD/);
    });

    it("records status, assignment and comments in history", async () => {
      const tr = await setup();
      const i = await tr.create({ title: "Ship memory evals", by: "owner" });
      await tr.update(i.key, "owner", { status: "doing", assignee: "code" });
      await tr.comment(i.key, "code", "PR #14 open");
      await tr.update(i.key, "code", { status: "done" });
      const { issue, history } = await tr.get(i.key.toLowerCase());
      expect(issue.status).toBe("done");
      expect(history.map((h) => `${h.kind}:${h.detail}`)).toEqual(["created:Ship memory evals", "status:todo -> doing", "assigned:code", "comment:PR #14 open", "status:doing -> done"]);
    });

    it("lists open issues by priority, urgent first and none last", async () => {
      const tr = await setup();
      await tr.create({ title: "no priority", by: "o" });
      await tr.create({ title: "low", priority: 4, by: "o" });
      await tr.create({ title: "urgent", priority: 1, by: "o" });
      const done = await tr.create({ title: "finished", priority: 1, by: "o" });
      await tr.update(done.key, "o", { status: "done" });
      expect((await tr.list()).map((i) => i.title)).toEqual(["urgent", "low", "no priority"]);
      expect((await tr.list({ status: "done" })).map((i) => i.key)).toEqual([done.key]);
    });

    it("searches titles and descriptions, including after edits", async () => {
      const tr = await setup();
      const i = await tr.create({ title: "Pricing page copy", body: "Team tier is $99", by: "o" });
      await tr.create({ title: "Unrelated", by: "o" });
      expect((await tr.search("tier")).map((x) => x.key)).toEqual([i.key]);
      await tr.update(i.key, "o", { title: "Pricing page rewrite" });
      expect((await tr.search("rewrite")).map((x) => x.key)).toEqual([i.key]);
      expect(await tr.search('" OR 1=1')).toEqual([]);
    });

    it("feeds the morning briefing", async () => {
      const tr = await setup();
      await tr.create({ title: "Prep Acme call", priority: 2, by: "o" });
      expect(await tr.briefSource().open()).toEqual([{ id: "VP-1", title: "Prep Acme call", state: "todo", priority: 2 }]);
    });

    it("exports and imports without losing anything", async () => {
      const store = await make();
      const tr = new Tracker(store, "VP", () => new Date((t += 60_000)));
      const i = await tr.create({ title: "Move to Postgres someday", labels: ["infra"], by: "o" });
      await tr.comment(i.key, "o", "not yet");
      const dump = await store.exportAll();
      const copy = await make();
      await copy.importAll(dump);
      expect(await copy.exportAll()).toEqual(dump);
      const next = await new Tracker(copy, "VP").create({ title: "after import", by: "o" });
      expect(next.key).toBe("VP-2");
    });
  });
}
