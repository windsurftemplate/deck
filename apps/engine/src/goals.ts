import { randomBytes } from "node:crypto";
import type { DB } from "@deck/memory";

export interface Goal {
  id: string;
  title: string;
  why: string;
  /** YYYY-MM-DD or empty */
  target: string;
  status: "active" | "done" | "dropped";
  createdAt: string;
  updates: { ts: string; text: string }[];
}

/** Big goals the owner sets. Milestones are tracker issues labelled goal-<id>; progress comes from them. */
export class Goals {
  constructor(private db: DB, private clock: () => Date = () => new Date()) {
    db.exec("CREATE TABLE IF NOT EXISTS goal_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, why TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updates TEXT NOT NULL)");
  }
  private row = (r: Record<string, string>): Goal => ({ id: r.id!, title: r.title!, why: r.why!, target: r.target!, status: r.status as Goal["status"], createdAt: r.created_at!, updates: JSON.parse(r.updates!) });
  list(): Goal[] {
    return (this.db.prepare("SELECT * FROM goal_plans ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC").all() as Record<string, string>[]).map(this.row);
  }
  get(id: string): Goal | undefined {
    const r = this.db.prepare("SELECT * FROM goal_plans WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r && this.row(r);
  }
  create(g: { title: string; why?: string; target?: string }): Goal {
    const title = g.title.trim();
    if (!title || title.length > 200) throw new Error("A goal needs a title (200 characters at most).");
    if (g.target && !/^\d{4}-\d{2}-\d{2}$/.test(g.target)) throw new Error("Target date must look like 2026-12-31.");
    const id = randomBytes(4).toString("hex");
    this.db.prepare("INSERT INTO goal_plans (id, title, why, target, status, created_at, updates) VALUES (?, ?, ?, ?, 'active', ?, '[]')").run(id, title, (g.why ?? "").trim().slice(0, 1000), g.target ?? "", this.clock().toISOString());
    return this.get(id)!;
  }
  update(id: string, p: Partial<Pick<Goal, "title" | "why" | "target" | "status">>): Goal {
    const g = this.get(id);
    if (!g) throw new Error("That goal no longer exists.");
    if (p.status && !["active", "done", "dropped"].includes(p.status)) throw new Error("Status is active, done or dropped.");
    if (p.target && !/^\d{4}-\d{2}-\d{2}$/.test(p.target)) throw new Error("Target date must look like 2026-12-31.");
    const n = { ...g, ...p };
    this.db.prepare("UPDATE goal_plans SET title = ?, why = ?, target = ?, status = ? WHERE id = ?").run(n.title.trim(), n.why, n.target, n.status, id);
    return this.get(id)!;
  }
  addUpdate(id: string, text: string) {
    const g = this.get(id);
    if (!g) return;
    const updates = [...g.updates, { ts: this.clock().toISOString(), text: text.slice(0, 2000) }].slice(-30);
    this.db.prepare("UPDATE goal_plans SET updates = ? WHERE id = ?").run(JSON.stringify(updates), id);
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM goal_plans WHERE id = ?").run(id);
  }
}
