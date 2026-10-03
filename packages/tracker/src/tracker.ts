import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "@deck/memory";
import { ftsQuery } from "@deck/memory";
import type { Issue as BriefIssue } from "@deck/connectors";

export type IssueStatus = "todo" | "doing" | "blocked" | "done" | "cancelled";
/** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export type Priority = 0 | 1 | 2 | 3 | 4;

export interface Issue {
  key: string;
  title: string;
  body: string;
  status: IssueStatus;
  priority: Priority;
  labels: string[];
  assignee: string | null;
  due: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueEvent {
  ts: string;
  actor: string;
  kind: "created" | "status" | "assigned" | "edited" | "comment";
  detail: string;
}

type Row = { id: number; key: string; title: string; body: string; status: IssueStatus; priority: Priority; labels: string; assignee: string | null; due: string | null; created_by: string; created_at: string; updated_at: string };
const toIssue = (r: Row): Issue => ({ key: r.key, title: r.title, body: r.body, status: r.status, priority: r.priority, labels: JSON.parse(r.labels) as string[], assignee: r.assignee, due: r.due, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
const OPEN: IssueStatus[] = ["todo", "doing", "blocked"];
const PRIORITY_NAME = ["none", "urgent", "high", "medium", "low"];

/** A small local replacement for Linear: issues, history, comments and search, in the encrypted workspace DB. */
export class Tracker {
  constructor(
    private db: DB,
    private prefix = "DECK",
    private clock: () => Date = () => new Date(),
  ) {
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(prefix)) throw new Error("tracker: prefix must be 2 to 10 capital letters or digits");
    db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tracker.sql"), "utf8"));
  }

  private now() {
    return this.clock().toISOString();
  }
  private row(key: string): Row {
    const r = this.db.prepare("SELECT * FROM issues WHERE key = ?").get(key.toUpperCase()) as Row | undefined;
    if (!r) throw new Error(`tracker: no issue ${key}`);
    return r;
  }
  private event(id: number, actor: string, kind: IssueEvent["kind"], detail: string) {
    this.db.prepare("INSERT INTO issue_events (issue_id, ts, actor, kind, detail) VALUES (?, ?, ?, ?, ?)").run(id, this.now(), actor, kind, detail);
  }

  create(i: { title: string; body?: string; priority?: Priority; labels?: string[]; assignee?: string; due?: string; by: string }): Issue {
    const title = i.title.trim();
    if (!title) throw new Error("tracker: an issue needs a title");
    if (i.due && !/^\d{4}-\d{2}-\d{2}$/.test(i.due)) throw new Error("tracker: due date must be YYYY-MM-DD");
    return this.db.transaction(() => {
      const n = (this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM issues").get() as { n: number }).n;
      const key = `${this.prefix}-${n}`;
      const now = this.now();
      const info = this.db
        .prepare("INSERT INTO issues (key, title, body, priority, labels, assignee, due, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(key, title, i.body ?? "", i.priority ?? 0, JSON.stringify([...new Set((i.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean))]), i.assignee ?? null, i.due ?? null, i.by, now, now);
      this.event(Number(info.lastInsertRowid), i.by, "created", title);
      return this.get(key).issue;
    })();
  }

  update(key: string, by: string, patch: { status?: IssueStatus; priority?: Priority; assignee?: string | null; title?: string; body?: string; labels?: string[]; due?: string | null }): Issue {
    const r = this.row(key);
    this.db.transaction(() => {
      const set: string[] = [];
      const vals: unknown[] = [];
      if (patch.status && patch.status !== r.status) (set.push("status = ?"), vals.push(patch.status), this.event(r.id, by, "status", `${r.status} -> ${patch.status}`));
      if (patch.assignee !== undefined && patch.assignee !== r.assignee) (set.push("assignee = ?"), vals.push(patch.assignee), this.event(r.id, by, "assigned", patch.assignee ?? "unassigned"));
      if (patch.priority !== undefined && patch.priority !== r.priority) (set.push("priority = ?"), vals.push(patch.priority), this.event(r.id, by, "edited", `priority ${PRIORITY_NAME[patch.priority]}`));
      if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== r.title) (set.push("title = ?"), vals.push(patch.title.trim()), this.event(r.id, by, "edited", "title"));
      if (patch.body !== undefined && patch.body !== r.body) (set.push("body = ?"), vals.push(patch.body), this.event(r.id, by, "edited", "description"));
      if (patch.labels) (set.push("labels = ?"), vals.push(JSON.stringify([...new Set(patch.labels.map((l) => l.trim().toLowerCase()).filter(Boolean))])));
      if (patch.due !== undefined) (set.push("due = ?"), vals.push(patch.due));
      if (!set.length) return;
      set.push("updated_at = ?");
      vals.push(this.now(), r.id);
      this.db.prepare(`UPDATE issues SET ${set.join(", ")} WHERE id = ?`).run(...vals);
    })();
    return this.get(key).issue;
  }

  comment(key: string, by: string, text: string): void {
    if (!text.trim()) throw new Error("tracker: comment is empty");
    const r = this.row(key);
    this.event(r.id, by, "comment", text.trim());
    this.db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(this.now(), r.id);
  }

  get(key: string): { issue: Issue; history: IssueEvent[] } {
    const r = this.row(key);
    const history = this.db.prepare("SELECT ts, actor, kind, detail FROM issue_events WHERE issue_id = ? ORDER BY id").all(r.id) as IssueEvent[];
    return { issue: toIssue(r), history };
  }

  /** Open issues first by priority (urgent first, none last), then most recently updated. */
  list(f: { status?: IssueStatus | "open"; assignee?: string; label?: string } = { status: "open" }): Issue[] {
    const statuses = f.status === "open" || !f.status ? OPEN : [f.status];
    const rows = this.db
      .prepare(`SELECT * FROM issues WHERE status IN (${statuses.map(() => "?").join(",")}) ${f.assignee ? "AND assignee = ?" : ""} ORDER BY CASE priority WHEN 0 THEN 9 ELSE priority END, updated_at DESC`)
      .all(...statuses, ...(f.assignee ? [f.assignee] : [])) as Row[];
    return rows.map(toIssue).filter((i) => !f.label || i.labels.includes(f.label.toLowerCase()));
  }

  search(text: string, limit = 20): Issue[] {
    const q = ftsQuery(text);
    if (!q) return [];
    return (this.db.prepare("SELECT i.* FROM issues_fts JOIN issues i ON i.id = issues_fts.rowid WHERE issues_fts MATCH ? ORDER BY bm25(issues_fts) LIMIT ?").all(q, limit) as Row[]).map(toIssue);
  }

  /** Feeds the morning briefing in place of Linear. */
  briefSource(): { open(): Promise<BriefIssue[]> } {
    return { open: async () => this.list({ status: "open" }).map((i) => ({ id: i.key, title: i.title, state: i.status, priority: i.priority || null })) };
  }
}
