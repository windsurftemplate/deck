import { randomUUID } from "node:crypto";
import type { EventBus } from "./events.js";

export type TaskStatus = "queued" | "running" | "needs_approval" | "blocked" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  title: string;
  /** Why the task exists, so the agent can make judgment calls. */
  why: string;
  doneWhen: string[];
  agent: string | null;
  status: TaskStatus;
  /** Tool scopes this task may use. A handoff can only narrow these. */
  scopes: string[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  result?: string;
  note?: string;
}

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["needs_approval", "blocked", "done", "failed", "cancelled"],
  needs_approval: ["running", "cancelled"],
  blocked: ["running", "cancelled", "failed"],
  done: [],
  failed: ["queued"],
  cancelled: [],
};

export class TaskBoard {
  private tasks = new Map<string, Task>();
  constructor(
    private bus: EventBus,
    private clock: () => Date = () => new Date(),
  ) {}

  create(t: { title: string; why: string; doneWhen: string[]; scopes: string[]; agent?: string; parentId?: string }): Task {
    if (!t.doneWhen.length) throw new Error("taskboard: a task needs at least one done-when check");
    if (t.parentId) {
      const parent = this.get(t.parentId);
      const wider = t.scopes.filter((s) => !parent.scopes.includes(s));
      if (wider.length) throw new Error(`taskboard: subtask cannot widen scope (${wider.join(", ")})`);
    }
    const now = this.clock().toISOString();
    const task: Task = { id: randomUUID(), title: t.title, why: t.why, doneWhen: t.doneWhen, scopes: t.scopes, agent: t.agent ?? null, status: "queued", parentId: t.parentId ?? null, createdAt: now, updatedAt: now };
    this.tasks.set(task.id, task);
    this.bus.emit({ type: "task.created", task: { ...task } });
    return { ...task };
  }

  get(id: string): Task {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`taskboard: no task ${id}`);
    return t;
  }

  move(id: string, to: TaskStatus, patch: { result?: string; note?: string; agent?: string } = {}): Task {
    const t = this.get(id);
    if (!NEXT[t.status].includes(to)) throw new Error(`taskboard: cannot move ${t.status} to ${to}`);
    if (to === "running" && !(patch.agent ?? t.agent)) throw new Error("taskboard: a running task needs an agent");
    const from = t.status;
    Object.assign(t, patch, { status: to, updatedAt: this.clock().toISOString() });
    this.bus.emit({ type: "task.updated", task: { ...t }, from });
    return { ...t };
  }

  /** Stop everything an agent is doing (kill switch). */
  cancelAgent(agent: string | "all"): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if ((agent === "all" || t.agent === agent) && NEXT[t.status].includes("cancelled")) {
        this.move(t.id, "cancelled", { note: "stopped by owner" });
        n++;
      }
    }
    this.bus.emit({ type: "agent.killed", agent });
    return n;
  }

  list(filter: Partial<Pick<Task, "status" | "agent">> = {}): Task[] {
    return [...this.tasks.values()].filter((t) => (!filter.status || t.status === filter.status) && (!filter.agent || t.agent === filter.agent)).map((t) => ({ ...t }));
  }
}
