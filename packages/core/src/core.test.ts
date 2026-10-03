import { describe, expect, it, vi } from "vitest";
import { EventBus, Scheduler, TaskBoard, gatewayEnv, nextRun, runToEnd, type AgentRunner, type DeckEvent } from "./index.js";

const board = () => {
  const bus = new EventBus();
  const events: DeckEvent[] = [];
  bus.on("*", (e) => events.push(e));
  return { bus, events, tb: new TaskBoard(bus, () => new Date("2026-10-02T09:00:00Z")) };
};
const base = { title: "Draft follow-up", why: "Acme asked for Q2", doneWhen: ["draft saved"], scopes: ["gmail.draft", "memory.read"] };

describe("TaskBoard", () => {
  it("moves through valid states and emits events", () => {
    const { tb, events } = board();
    const t = tb.create({ ...base, agent: "gtm" });
    tb.move(t.id, "running");
    tb.move(t.id, "needs_approval");
    tb.move(t.id, "running");
    tb.move(t.id, "done", { result: "sent" });
    expect(events.map((e) => e.type)).toEqual(["task.created", "task.updated", "task.updated", "task.updated", "task.updated"]);
    expect(tb.get(t.id).status).toBe("done");
  });

  it("refuses invalid transitions and running without an agent", () => {
    const { tb } = board();
    const t = tb.create(base);
    expect(() => tb.move(t.id, "done")).toThrow(/cannot move/);
    expect(() => tb.move(t.id, "running")).toThrow(/needs an agent/);
  });

  it("subtasks can narrow but never widen scope", () => {
    const { tb } = board();
    const p = tb.create(base);
    expect(() => tb.create({ ...base, scopes: ["memory.read"], parentId: p.id })).not.toThrow();
    expect(() => tb.create({ ...base, scopes: ["gmail.send"], parentId: p.id })).toThrow(/widen scope/);
  });

  it("kill switch cancels an agent's open tasks only", () => {
    const { tb, events } = board();
    const a = tb.create({ ...base, agent: "gtm" });
    const b = tb.create({ ...base, agent: "ops" });
    tb.move(a.id, "running");
    expect(tb.cancelAgent("gtm")).toBe(1);
    expect(tb.get(a.id).status).toBe("cancelled");
    expect(tb.get(b.id).status).toBe("queued");
    expect(events.at(-1)).toEqual({ type: "agent.killed", agent: "gtm" });
  });

  it("requires a done-when check", () => {
    expect(() => board().tb.create({ ...base, doneWhen: [] })).toThrow(/done-when/);
  });
});

describe("EventBus", () => {
  it("keeps delivering when one handler throws", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.on("agent.message", () => {
      throw new Error("boom");
    });
    bus.on("agent.message", (e) => seen.push(e.text));
    bus.emit({ type: "agent.message", agent: "x", text: "hi" });
    expect(seen).toEqual(["hi"]);
    spy.mockRestore();
  });
});

describe("Scheduler", () => {
  it("computes the next run, skipping disallowed days", () => {
    const fri = new Date(2026, 9, 2, 9, 0); // Friday 09:00 local
    expect(nextRun("08:00", fri).getDate()).toBe(3);
    expect(nextRun("10:30", fri)).toEqual(new Date(2026, 9, 2, 10, 30));
    expect(nextRun("08:00", fri, [1, 2, 3, 4, 5])).toEqual(new Date(2026, 9, 5, 8, 0)); // next Monday
    expect(() => nextRun("8am", fri)).toThrow(/HH:MM/);
  });

  it("fires the job, emits an event, and reschedules", async () => {
    const bus = new EventBus();
    const fired: string[] = [];
    bus.on("schedule.fired", (e) => fired.push(e.job));
    let pending: (() => void) | null = null;
    const timers = { set: (fn: () => void) => ((pending = fn), 1), clear: () => {} };
    const run = vi.fn();
    const s = new Scheduler(bus, () => new Date(2026, 9, 2, 7, 0), timers);
    s.add({ name: "brief", at: "08:00", run });
    await (pending as unknown as () => Promise<void>)();
    expect(run).toHaveBeenCalledOnce();
    expect(fired).toEqual(["brief"]);
    expect(pending).not.toBeNull();
  });
});

describe("agent loop", () => {
  it("runs a fake agent to the end", async () => {
    const runner: AgentRunner = {
      async *run() {
        yield { type: "tool_call", tool: "calendar.read", input: {} };
        yield { type: "done", result: "brief ready", turns: 2 };
      },
    };
    const seen: string[] = [];
    const out = await runToEnd(runner, { agent: "cos", system: "", prompt: "", allowedTools: [], maxTurns: 5 }, (e) => seen.push(e.type));
    expect(out).toEqual({ result: "brief ready", turns: 2 });
    expect(seen).toEqual(["tool_call", "done"]);
  });

  it("points the SDK at the Gateway with no provider key", () => {
    expect(gatewayEnv("https://gw.example.com/", "vp-proj-abc")).toEqual({ ANTHROPIC_BASE_URL: "https://gw.example.com/anthropic", ANTHROPIC_AUTH_TOKEN: "vp-proj-abc", ANTHROPIC_API_KEY: "" });
    expect(() => gatewayEnv("https://gw", "sk-ant-x")).toThrow(/vp-proj/);
  });
});
