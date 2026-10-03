import type { Issue, IssueEvent, IssueStatus } from "./types.js";

/**
 * Storage port for the tracker. Tracker logic (keys, validation, history) sits above this,
 * so issues can move to another database or a shared server later. Adapters must pass
 * `trackerStoreContract` (contract.ts).
 */
export interface TrackerStore {
  readonly engine: string;
  /** Inserts the issue and its "created" event atomically, assigning the next number. */
  create(prefix: string, i: Omit<Issue, "key">, created: Omit<IssueEvent, "kind">): Promise<Issue>;
  get(key: string): Promise<Issue | undefined>;
  /** Applies field changes and their history events atomically. */
  update(key: string, fields: Partial<Omit<Issue, "key" | "createdBy" | "createdAt">>, events: IssueEvent[]): Promise<Issue>;
  addEvent(key: string, e: IssueEvent, ts: string): Promise<void>;
  events(key: string): Promise<IssueEvent[]>;
  list(statuses: IssueStatus[], assignee?: string): Promise<Issue[]>;
  search(text: string, limit: number): Promise<Issue[]>;
  exportAll(): Promise<TrackerDump>;
  importAll(d: TrackerDump): Promise<void>;
}

export interface TrackerDump {
  format: "deck-tracker";
  version: 1;
  issues: (Issue & { events: IssueEvent[] })[];
}

/** Sort order shared by every adapter: urgent first, no priority last, then most recently updated. */
export const issueOrder = (a: Issue, b: Issue) => (a.priority || 9) - (b.priority || 9) || b.updatedAt.localeCompare(a.updatedAt);
