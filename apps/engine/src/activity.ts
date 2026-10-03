import type { DB } from "@deck/memory";

export interface CrewMessage {
  id: number;
  ts: string;
  /** "activity" for the live feed of work, or "discussion:<id>" for a crew discussion. */
  channel: string;
  sender: string;
  recipient: string;
  /** handoff, report, tool, check, approval, decision, discussion, note */
  kind: string;
  text: string;
  taskId?: string;
}

/** History for the command center and the crew channel, kept in the encrypted workspace. */
export class Activity {
  constructor(private db: DB, private clock: () => Date = () => new Date()) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, agent TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, tokens INTEGER NOT NULL, cost REAL);
      CREATE TABLE IF NOT EXISTS task_log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, task_id TEXT NOT NULL, agent TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, note TEXT);
      CREATE TABLE IF NOT EXISTS crew_messages (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, channel TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, task_id TEXT);
      CREATE TABLE IF NOT EXISTS discussions (id TEXT PRIMARY KEY, topic TEXT NOT NULL, agents TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS crew_messages_by_channel ON crew_messages(channel, id);
      CREATE INDEX IF NOT EXISTS usage_by_ts ON usage_log(ts);`);
    // Practice cases for prompt tuning need each task's goal context.
    for (const col of ["why TEXT", "done_when TEXT"]) {
      try {
        db.exec(`ALTER TABLE task_log ADD COLUMN ${col}`);
      } catch {
        /* already there */
      }
    }
  }
  private now() {
    return this.clock().toISOString();
  }

  logUsage(u: { agent: string; model: string; inputTokens: number; outputTokens: number; tokens: number; costUsd: number | null }) {
    this.db.prepare("INSERT INTO usage_log (ts, agent, model, input, output, tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?)").run(this.now(), u.agent, u.model, u.inputTokens, u.outputTokens, u.tokens, u.costUsd);
  }

  logTask(t: { id: string; agent: string; title: string; status: string; checked?: boolean; note?: string; why?: string; doneWhen?: string[] }) {
    this.db.prepare("INSERT INTO task_log (ts, task_id, agent, title, status, checked, note, why, done_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(this.now(), t.id, t.agent, t.title.slice(0, 300), t.status, t.checked ? 1 : 0, t.note?.slice(0, 500) ?? null, t.why?.slice(0, 500) ?? null, t.doneWhen ? JSON.stringify(t.doneWhen.slice(0, 8)) : null);
  }

  /** Recent finished tasks for an agent, as practice cases (newest first, one per goal). */
  practiceCases(agent: string, n: number): { goal: string; why: string; doneWhen: string[]; status: string; checked: boolean; note: string | null }[] {
    const rows = this.db.prepare("SELECT title, why, done_when, status, checked, note FROM task_log WHERE agent = ? AND done_when IS NOT NULL AND status IN ('done','failed') ORDER BY id DESC LIMIT 60").all(agent) as { title: string; why: string | null; done_when: string; status: string; checked: number; note: string | null }[];
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.title) && (seen.add(r.title), true)).slice(0, n).map((r) => ({ goal: r.title, why: r.why ?? "", doneWhen: JSON.parse(r.done_when) as string[], status: r.status, checked: r.checked === 1, note: r.note }));
  }

  post(m: Omit<CrewMessage, "id" | "ts">): CrewMessage {
    const ts = this.now();
    const text = m.text.slice(0, 4000);
    const id = Number(this.db.prepare("INSERT INTO crew_messages (ts, channel, sender, recipient, kind, text, task_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(ts, m.channel, m.sender, m.recipient, m.kind, text, m.taskId ?? null).lastInsertRowid);
    return { ...m, text, id, ts };
  }

  messages(channel: string, limit = 200, before?: number): CrewMessage[] {
    const rows = this.db.prepare(`SELECT id, ts, channel, sender, recipient, kind, text, task_id AS taskId FROM crew_messages WHERE channel = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`).all(...(before ? [channel, before, limit] : [channel, limit])) as (CrewMessage & { taskId: string | null })[];
    return rows.reverse().map(({ taskId, ...r }) => ({ ...r, ...(taskId ? { taskId } : {}) }));
  }

  createDiscussion(id: string, topic: string, agents: string[]) {
    this.db.prepare("INSERT INTO discussions (id, topic, agents, created_at, status) VALUES (?, ?, ?, ?, 'running')").run(id, topic.slice(0, 300), JSON.stringify(agents), this.now());
  }
  setDiscussionStatus(id: string, status: string) {
    this.db.prepare("UPDATE discussions SET status = ? WHERE id = ?").run(status, id);
  }
  discussions() {
    return (this.db.prepare("SELECT id, topic, agents, created_at, status FROM discussions ORDER BY created_at DESC LIMIT 100").all() as { id: string; topic: string; agents: string; created_at: string; status: string }[]).map((d) => ({ id: d.id, topic: d.topic, agents: JSON.parse(d.agents) as string[], createdAt: d.created_at, status: d.status }));
  }

  /** Numbers for the command center over the last `days` days (UTC dates). */
  analytics(days: number, extra: { facts: { ts: string }[]; docs: { ts: string }[]; issues: { created: string; closed: string | null }[] }) {
    const since = new Date(this.clock().getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const dates = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${since}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
    const q = <T>(sql: string, ...a: unknown[]) => this.db.prepare(sql).all(...a) as T[];
    const byDay = q<{ d: string; tokens: number; cost: number | null }>("SELECT substr(ts,1,10) AS d, SUM(tokens) AS tokens, SUM(cost) AS cost FROM usage_log WHERE ts >= ? GROUP BY d", since);
    const byModel = q<{ k: string; tokens: number; cost: number | null; calls: number }>("SELECT model AS k, SUM(tokens) AS tokens, SUM(cost) AS cost, COUNT(*) AS calls FROM usage_log WHERE ts >= ? GROUP BY model ORDER BY tokens DESC", since);
    const byAgent = q<{ k: string; tokens: number; cost: number | null; calls: number }>("SELECT agent AS k, SUM(tokens) AS tokens, SUM(cost) AS cost, COUNT(*) AS calls FROM usage_log WHERE ts >= ? GROUP BY agent ORDER BY tokens DESC", since);
    const tasks = q<{ agent: string; status: string; checked: number; n: number }>("SELECT agent, status, checked, COUNT(*) AS n FROM task_log WHERE ts >= ? AND status IN ('done','failed') GROUP BY agent, status, checked", since);
    const tasksByDay = q<{ d: string; status: string; n: number }>("SELECT substr(ts,1,10) AS d, status, COUNT(*) AS n FROM task_log WHERE ts >= ? AND status IN ('done','failed') GROUP BY d, status", since);
    const decisions = q<{ kind: string; text: string }>("SELECT kind, text FROM crew_messages WHERE ts >= ? AND kind = 'decision'", since);
    const count = (xs: string[]) => dates.map((d) => xs.filter((x) => x.slice(0, 10) === d).length);
    const cumulative = (xs: string[]) => dates.map((d) => xs.filter((x) => x.slice(0, 10) <= d).length);
    const crew = [...new Set(tasks.map((t) => t.agent))].map((agent) => {
      const mine = tasks.filter((t) => t.agent === agent);
      const sum = (f: (t: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((a, t) => a + t.n, 0);
      return { agent, done: sum((t) => t.status === "done"), failed: sum((t) => t.status === "failed"), checked: sum((t) => t.checked === 1) };
    });
    return {
      dates,
      tokens: dates.map((d) => byDay.find((r) => r.d === d)?.tokens ?? 0),
      cost: dates.map((d) => byDay.find((r) => r.d === d)?.cost ?? 0),
      byModel,
      byAgent,
      crew,
      tasksDone: dates.map((d) => tasksByDay.find((r) => r.d === d && r.status === "done")?.n ?? 0),
      tasksFailed: dates.map((d) => tasksByDay.find((r) => r.d === d && r.status === "failed")?.n ?? 0),
      approvals: { approved: decisions.filter((x) => x.text.startsWith("Approved")).length, rejected: decisions.filter((x) => x.text.startsWith("Rejected")).length },
      facts: cumulative(extra.facts.map((f) => f.ts)),
      docs: cumulative(extra.docs.map((f) => f.ts)),
      issuesOpened: count(extra.issues.map((i) => i.created)),
      issuesClosed: count(extra.issues.flatMap((i) => (i.closed ? [i.closed] : []))),
      issuesOpen: extra.issues.filter((i) => !i.closed).length,
    };
  }
}
