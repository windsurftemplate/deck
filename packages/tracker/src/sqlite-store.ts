import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ftsQuery, type DB } from "@deck/memory";
import { issueOrder, type TrackerDump, type TrackerStore } from "./store.js";
import type { Issue, IssueEvent, IssueStatus } from "./types.js";

type Row = { id: number; key: string; title: string; body: string; status: IssueStatus; priority: Issue["priority"]; labels: string; assignee: string | null; due: string | null; created_by: string; created_at: string; updated_at: string };
const toIssue = (r: Row): Issue => ({ key: r.key, title: r.title, body: r.body, status: r.status, priority: r.priority, labels: JSON.parse(r.labels) as string[], assignee: r.assignee, due: r.due, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
const COLS: Record<string, string> = { title: "title", body: "body", status: "status", priority: "priority", labels: "labels", assignee: "assignee", due: "due", updatedAt: "updated_at" };

/** SQLite adapter: issues in the same encrypted workspace file as memory. */
export class SqliteTrackerStore implements TrackerStore {
  readonly engine = "sqlite";
  constructor(private db: DB) {
    db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tracker.sql"), "utf8"));
  }
  private id(key: string): number {
    const r = this.db.prepare("SELECT id FROM issues WHERE key = ?").get(key) as { id: number } | undefined;
    if (!r) throw new Error(`tracker: no issue ${key}`);
    return r.id;
  }
  async create(prefix: string, i: Omit<Issue, "key">, created: Omit<IssueEvent, "kind">) {
    return this.db.transaction(() => {
      const n = (this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM issues").get() as { n: number }).n;
      const key = `${prefix}-${n}`;
      const id = Number(
        this.db
          .prepare("INSERT INTO issues (id, key, title, body, status, priority, labels, assignee, due, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(n, key, i.title, i.body, i.status, i.priority, JSON.stringify(i.labels), i.assignee, i.due, i.createdBy, i.createdAt, i.updatedAt).lastInsertRowid,
      );
      this.db.prepare("INSERT INTO issue_events (issue_id, ts, actor, kind, detail) VALUES (?, ?, ?, 'created', ?)").run(id, created.ts, created.actor, created.detail);
      return { key, ...i };
    })();
  }
  async get(key: string) {
    const r = this.db.prepare("SELECT * FROM issues WHERE key = ?").get(key) as Row | undefined;
    return r && toIssue(r);
  }
  async update(key: string, fields: Partial<Issue>, events: IssueEvent[]) {
    this.db.transaction(() => {
      const id = this.id(key);
      const set = Object.keys(fields).filter((k) => COLS[k]);
      if (set.length) {
        const vals = set.map((k) => (k === "labels" ? JSON.stringify(fields.labels) : (fields as Record<string, unknown>)[k]));
        this.db.prepare(`UPDATE issues SET ${set.map((k) => `${COLS[k]} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
      }
      for (const e of events) this.db.prepare("INSERT INTO issue_events (issue_id, ts, actor, kind, detail) VALUES (?, ?, ?, ?, ?)").run(id, e.ts, e.actor, e.kind, e.detail);
    })();
    return (await this.get(key))!;
  }
  async addEvent(key: string, e: IssueEvent, ts: string) {
    this.db.transaction(() => {
      const id = this.id(key);
      this.db.prepare("INSERT INTO issue_events (issue_id, ts, actor, kind, detail) VALUES (?, ?, ?, ?, ?)").run(id, e.ts, e.actor, e.kind, e.detail);
      this.db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(ts, id);
    })();
  }
  async events(key: string) {
    return this.db.prepare("SELECT ts, actor, kind, detail FROM issue_events WHERE issue_id = ? ORDER BY id").all(this.id(key)) as IssueEvent[];
  }
  async list(statuses: IssueStatus[], assignee?: string) {
    const rows = this.db.prepare(`SELECT * FROM issues WHERE status IN (${statuses.map(() => "?").join(",")}) ${assignee ? "AND assignee = ?" : ""}`).all(...statuses, ...(assignee ? [assignee] : [])) as Row[];
    return rows.map(toIssue).sort(issueOrder);
  }
  async search(text: string, limit: number) {
    const q = ftsQuery(text);
    if (!q) return [];
    return (this.db.prepare("SELECT i.* FROM issues_fts JOIN issues i ON i.id = issues_fts.rowid WHERE issues_fts MATCH ? ORDER BY bm25(issues_fts) LIMIT ?").all(q, limit) as Row[]).map(toIssue);
  }
  async exportAll(): Promise<TrackerDump> {
    const rows = this.db.prepare("SELECT * FROM issues ORDER BY id").all() as Row[];
    return { format: "deck-tracker", version: 1, issues: await Promise.all(rows.map(async (r) => ({ ...toIssue(r), events: await this.events(r.key) }))) };
  }
  async importAll(d: TrackerDump) {
    if (d.format !== "deck-tracker" || d.version !== 1) throw new Error("tracker: unknown dump format");
    if ((this.db.prepare("SELECT count(*) n FROM issues").get() as { n: number }).n) throw new Error("tracker: import needs an empty store");
    this.db.transaction(() => {
      for (const i of d.issues) {
        const n = Number(i.key.split("-").pop());
        this.db.prepare("INSERT INTO issues (id, key, title, body, status, priority, labels, assignee, due, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(n, i.key, i.title, i.body, i.status, i.priority, JSON.stringify(i.labels), i.assignee, i.due, i.createdBy, i.createdAt, i.updatedAt);
        for (const e of i.events) this.db.prepare("INSERT INTO issue_events (issue_id, ts, actor, kind, detail) VALUES (?, ?, ?, ?, ?)").run(n, e.ts, e.actor, e.kind, e.detail);
      }
    })();
  }
}
