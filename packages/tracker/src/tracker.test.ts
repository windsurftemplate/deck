import { describe, expect, it } from "vitest";
import { openMemory } from "@deck/memory";
import { Tracker } from "./index.js";

let t = Date.parse("2026-10-02T09:00:00Z");
const setup = () => new Tracker(openMemory({ path: ":memory:", key: "test-only-not-a-secret", dim: 16 }), "VP", () => new Date((t += 60_000)));

describe("local tracker", () => {
  it("creates keyed issues with clean labels", () => {
    const tr = setup();
    const a = tr.create({ title: "Gateway retry on 529", priority: 2, labels: ["Gateway", "gateway", " bug "], by: "owner" });
    const b = tr.create({ title: "Design partner follow-up: Acme", by: "chief-of-staff" });
    expect([a.key, b.key]).toEqual(["VP-1", "VP-2"]);
    expect(a.labels).toEqual(["gateway", "bug"]);
    expect(() => tr.create({ title: "  ", by: "x" })).toThrow(/title/);
    expect(() => tr.create({ title: "x", due: "Friday", by: "x" })).toThrow(/YYYY-MM-DD/);
  });

  it("records status, assignment and comments in history", () => {
    const tr = setup();
    const i = tr.create({ title: "Ship memory evals", by: "owner" });
    tr.update(i.key, "owner", { status: "doing", assignee: "code" });
    tr.comment(i.key, "code", "PR #14 open");
    tr.update(i.key, "code", { status: "done" });
    const { issue, history } = tr.get(i.key.toLowerCase());
    expect(issue.status).toBe("done");
    expect(history.map((h) => `${h.kind}:${h.detail}`)).toEqual(["created:Ship memory evals", "status:todo -> doing", "assigned:code", "comment:PR #14 open", "status:doing -> done"]);
  });

  it("lists open issues by priority, urgent first and none last", () => {
    const tr = setup();
    tr.create({ title: "no priority", by: "o" });
    tr.create({ title: "low", priority: 4, by: "o" });
    const urgent = tr.create({ title: "urgent", priority: 1, by: "o" });
    const done = tr.create({ title: "finished", priority: 1, by: "o" });
    tr.update(done.key, "o", { status: "done" });
    expect(tr.list().map((i) => i.title)).toEqual(["urgent", "low", "no priority"]);
    expect(tr.list({ status: "done" }).map((i) => i.key)).toEqual([done.key]);
    expect(urgent.priority).toBe(1);
  });

  it("searches titles and descriptions, including after edits", () => {
    const tr = setup();
    const i = tr.create({ title: "Pricing page copy", body: "Team tier is $99", by: "o" });
    tr.create({ title: "Unrelated", by: "o" });
    expect(tr.search("tier").map((x) => x.key)).toEqual([i.key]);
    tr.update(i.key, "o", { title: "Pricing page rewrite" });
    expect(tr.search("rewrite").map((x) => x.key)).toEqual([i.key]);
    expect(tr.search('" OR 1=1')).toEqual([]);
  });

  it("feeds the morning briefing", async () => {
    const tr = setup();
    tr.create({ title: "Prep Acme call", priority: 2, by: "o" });
    expect(await tr.briefSource().open()).toEqual([{ id: "VP-1", title: "Prep Acme call", state: "todo", priority: 2 }]);
  });
});
