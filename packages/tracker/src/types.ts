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
