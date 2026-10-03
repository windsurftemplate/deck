export interface CalendarEvent {
  start: string;
  end: string;
  title: string;
  attendees: string[];
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface Issue {
  id: string;
  title: string;
  state: string;
  priority: number | null;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  checks: "passing" | "failing" | "pending" | "unknown";
}

/** Read-only sources the morning briefing draws on. Each is optional and may fail on its own. */
export interface BriefSources {
  calendar?: { today(): Promise<CalendarEvent[]> };
  email?: { needsReply(): Promise<EmailSummary[]> };
  issues?: { open(): Promise<Issue[]> };
  code?: { awaitingReview(): Promise<PullRequest[]> };
}

/** Calls a tool on a connected MCP server. The app's MCP client implements this. */
export type ToolCaller = (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
