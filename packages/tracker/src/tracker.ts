import type { Issue as BriefIssue } from "@deck/connectors";
import type { TrackerStore } from "./store.js";
import type { Issue, IssueEvent, IssueStatus, Priority } from "./types.js";

const OPEN: IssueStatus[] = ["todo", "doing", "blocked"];
const PRIORITY_NAME = ["none", "urgent", "high", "medium", "low"];
const cleanLabels = (ls: string[]) => [...new Set(ls.map((l) => l.trim().toLowerCase()).filter(Boolean))];

/** Built-in issue tracker (replaces Linear). Logic only; storage comes from a TrackerStore adapter. */
export class Tracker {
  constructor(
    private store: TrackerStore,
    private prefix = "DECK",
    private clock: () => Date = () => new Date(),
  ) {
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(prefix)) throw new Error("tracker: prefix must be 2 to 10 capital letters or digits");
  }

  private now() {
    return this.clock().toISOString();
  }
  private async must(key: string): Promise<Issue> {
    const i = await this.store.get(key.toUpperCase());
    if (!i) throw new Error(`tracker: no issue ${key}`);
    return i;
  }

  async create(i: { title: string; body?: string; priority?: Priority; labels?: string[]; assignee?: string; due?: string; by: string }): Promise<Issue> {
    const title = i.title.trim();
    if (!title) throw new Error("tracker: an issue needs a title");
    if (i.due && !/^\d{4}-\d{2}-\d{2}$/.test(i.due)) throw new Error("tracker: due date must be YYYY-MM-DD");
    const now = this.now();
    return this.store.create(
      this.prefix,
      { title, body: i.body ?? "", status: "todo", priority: i.priority ?? 0, labels: cleanLabels(i.labels ?? []), assignee: i.assignee ?? null, due: i.due ?? null, createdBy: i.by, createdAt: now, updatedAt: now },
      { ts: now, actor: i.by, detail: title },
    );
  }

  async update(key: string, by: string, patch: { status?: IssueStatus; priority?: Priority; assignee?: string | null; title?: string; body?: string; labels?: string[]; due?: string | null }): Promise<Issue> {
    const cur = await this.must(key);
    const ts = this.now();
    const fields: Partial<Issue> = {};
    const events: IssueEvent[] = [];
    const ev = (kind: IssueEvent["kind"], detail: string) => events.push({ ts, actor: by, kind, detail });
    if (patch.status && patch.status !== cur.status) (fields.status = patch.status), ev("status", `${cur.status} -> ${patch.status}`);
    if (patch.assignee !== undefined && patch.assignee !== cur.assignee) (fields.assignee = patch.assignee), ev("assigned", patch.assignee ?? "unassigned");
    if (patch.priority !== undefined && patch.priority !== cur.priority) (fields.priority = patch.priority), ev("edited", `priority ${PRIORITY_NAME[patch.priority]}`);
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== cur.title) (fields.title = patch.title.trim()), ev("edited", "title");
    if (patch.body !== undefined && patch.body !== cur.body) (fields.body = patch.body), ev("edited", "description");
    if (patch.labels) fields.labels = cleanLabels(patch.labels);
    if (patch.due !== undefined) {
      if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new Error("tracker: due date must be YYYY-MM-DD");
      fields.due = patch.due;
    }
    if (!Object.keys(fields).length) return cur;
    fields.updatedAt = ts;
    return this.store.update(cur.key, fields, events);
  }

  async comment(key: string, by: string, text: string): Promise<void> {
    if (!text.trim()) throw new Error("tracker: comment is empty");
    const cur = await this.must(key);
    const ts = this.now();
    await this.store.addEvent(cur.key, { ts, actor: by, kind: "comment", detail: text.trim() }, ts);
  }

  async get(key: string): Promise<{ issue: Issue; history: IssueEvent[] }> {
    const issue = await this.must(key);
    return { issue, history: await this.store.events(issue.key) };
  }

  /** Open issues first by priority (urgent first, none last), then most recently updated. */
  async list(f: { status?: IssueStatus | "open" | "all"; assignee?: string; label?: string } = { status: "open" }): Promise<Issue[]> {
    const statuses: IssueStatus[] = f.status === "all" ? [...OPEN, "done", "cancelled"] : f.status === "open" || !f.status ? OPEN : [f.status];
    const rows = await this.store.list(statuses, f.assignee);
    return rows.filter((i) => !f.label || i.labels.includes(f.label.toLowerCase()));
  }

  search(text: string, limit = 20): Promise<Issue[]> {
    return this.store.search(text, limit);
  }

  /** Feeds the morning briefing in place of Linear. */
  briefSource(): { open(): Promise<BriefIssue[]> } {
    return { open: async () => (await this.list({ status: "open" })).map((i) => ({ id: i.key, title: i.title, state: i.status, priority: i.priority || null })) };
  }
}
