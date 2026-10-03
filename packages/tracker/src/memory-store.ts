import { issueOrder, type TrackerDump, type TrackerStore } from "./store.js";
import type { Issue, IssueEvent, IssueStatus } from "./types.js";

const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);

/** Pure TypeScript adapter, nothing on disk. For tests and as proof the tracker is database-independent. */
export class InMemoryTrackerStore implements TrackerStore {
  readonly engine = "memory";
  private issues: (Issue & { events: IssueEvent[] })[] = [];
  private find(key: string) {
    const i = this.issues.find((x) => x.key === key);
    if (!i) throw new Error(`tracker: no issue ${key}`);
    return i;
  }
  private plain = ({ events: _e, ...i }: Issue & { events: IssueEvent[] }): Issue => structuredClone(i);
  async create(prefix: string, i: Omit<Issue, "key">, created: Omit<IssueEvent, "kind">) {
    const n = this.issues.reduce((m, x) => Math.max(m, Number(x.key.split("-").pop())), 0) + 1;
    const issue = { key: `${prefix}-${n}`, ...structuredClone(i), events: [{ ...created, kind: "created" as const }] };
    this.issues.push(issue);
    return this.plain(issue);
  }
  async get(key: string) {
    const i = this.issues.find((x) => x.key === key);
    return i && this.plain(i);
  }
  async update(key: string, fields: Partial<Issue>, events: IssueEvent[]) {
    const i = this.find(key);
    Object.assign(i, structuredClone(fields));
    i.events.push(...events);
    return this.plain(i);
  }
  async addEvent(key: string, e: IssueEvent, ts: string) {
    const i = this.find(key);
    i.events.push(e);
    i.updatedAt = ts;
  }
  async events(key: string) {
    return structuredClone(this.find(key).events);
  }
  async list(statuses: IssueStatus[], assignee?: string) {
    return this.issues.filter((i) => statuses.includes(i.status) && (!assignee || i.assignee === assignee)).map(this.plain).sort(issueOrder);
  }
  async search(text: string, limit: number) {
    const q = words(text);
    return this.issues
      .map((i) => ({ i, s: [...words(`${i.title} ${i.body}`)].filter((w) => q.has(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => this.plain(x.i));
  }
  async exportAll(): Promise<TrackerDump> {
    return { format: "deck-tracker", version: 1, issues: structuredClone(this.issues) };
  }
  async importAll(d: TrackerDump) {
    if (d.format !== "deck-tracker" || d.version !== 1) throw new Error("tracker: unknown dump format");
    if (this.issues.length) throw new Error("tracker: import needs an empty store");
    this.issues = structuredClone(d.issues);
  }
}
