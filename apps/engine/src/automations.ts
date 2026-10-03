import { randomBytes } from "node:crypto";
import type { DB } from "@deck/memory";

export interface Automation {
  id: string;
  name: string;
  /** chief-of-staff, gtm, ops, code or research */
  agent: string;
  instruction: string;
  /** Local time, HH:MM */
  at: string;
  /** 0 = Sunday ... 6 = Saturday; empty means every day */
  days: number[];
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastResult?: string;
}
export type NewAutomation = Pick<Automation, "name" | "agent" | "instruction" | "at" | "days">;

const DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Checks a new or changed automation. Returns a reason when it is not valid. */
export function checkAutomation(a: Partial<NewAutomation>, agents: string[]): string | null {
  if (!a.name?.trim() || a.name.length > 80) return "Give it a name (80 characters at most).";
  if (!a.agent || !agents.includes(a.agent)) return `Pick who runs it: ${agents.join(", ")}.`;
  if (!a.instruction?.trim() || a.instruction.length > 2000) return "Say what to do (2,000 characters at most).";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.at ?? "")) return "Time must look like 09:00.";
  if (!Array.isArray(a.days) || a.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Days must be 0 (Sunday) to 6 (Saturday).";
  return null;
}

/** Plain-English schedule, like "Mondays at 09:00" or "every day at 08:00". */
export function describeSchedule(at: string, days: number[]): string {
  const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const d = [...new Set(days)].sort();
  if (!d.length || d.length === 7) return `every day at ${at}`;
  if (d.join() === "1,2,3,4,5") return `weekdays at ${at}`;
  return `${d.map((x) => names[x]).join(", ")} at ${at}`;
}

/** Turns "mon,wed" or "weekdays" into day numbers. */
export function parseDays(s: string): number[] {
  const t = s.toLowerCase().trim();
  if (!t || t === "daily" || t === "every day") return [];
  if (t === "weekdays") return [1, 2, 3, 4, 5];
  if (t === "weekends") return [0, 6];
  return [...new Set(t.split(/[\s,]+/).map((w) => DAY.indexOf(w.slice(0, 3))).filter((n) => n >= 0))];
}

/** Recurring jobs the owner schedules, saved in the encrypted workspace. */
export class Automations {
  constructor(private db: DB, private clock: () => Date = () => new Date()) {
    db.exec(`CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, agent TEXT NOT NULL, instruction TEXT NOT NULL, at TEXT NOT NULL, days TEXT NOT NULL, enabled INTEGER NOT NULL, created_at TEXT NOT NULL, last_run TEXT, last_result TEXT)`);
  }
  private row = (r: Record<string, unknown>): Automation => ({
    id: r.id as string,
    name: r.name as string,
    agent: r.agent as string,
    instruction: r.instruction as string,
    at: r.at as string,
    days: JSON.parse(r.days as string) as number[],
    enabled: r.enabled === 1,
    createdAt: r.created_at as string,
    ...(r.last_run ? { lastRun: r.last_run as string } : {}),
    ...(r.last_result ? { lastResult: r.last_result as string } : {}),
  });
  list(): Automation[] {
    return (this.db.prepare("SELECT * FROM automations ORDER BY created_at").all() as Record<string, unknown>[]).map(this.row);
  }
  get(id: string): Automation | undefined {
    const r = this.db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r && this.row(r);
  }
  create(a: NewAutomation): Automation {
    const id = randomBytes(4).toString("hex");
    this.db.prepare("INSERT INTO automations (id, name, agent, instruction, at, days, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(id, a.name.trim(), a.agent, a.instruction.trim(), a.at, JSON.stringify(a.days), this.clock().toISOString());
    return this.get(id)!;
  }
  update(id: string, a: Partial<NewAutomation> & { enabled?: boolean }): Automation {
    const cur = this.get(id);
    if (!cur) throw new Error("That automation no longer exists.");
    const next = { ...cur, ...a };
    this.db.prepare("UPDATE automations SET name = ?, agent = ?, instruction = ?, at = ?, days = ?, enabled = ? WHERE id = ?").run(next.name.trim(), next.agent, next.instruction.trim(), next.at, JSON.stringify(next.days), next.enabled ? 1 : 0, id);
    return this.get(id)!;
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM automations WHERE id = ?").run(id);
  }
  markRun(id: string, result: string) {
    this.db.prepare("UPDATE automations SET last_run = ?, last_result = ? WHERE id = ?").run(this.clock().toISOString(), result.slice(0, 4000), id);
  }
}
