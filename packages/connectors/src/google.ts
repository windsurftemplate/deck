import type { CalendarEvent, EmailSummary, ToolCaller } from "./types.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Gmail through its MCP server. Read only: drafting and sending go through the approval gate. */
export class GmailSource {
  constructor(
    private call: ToolCaller,
    private server = "gmail",
    private query = "in:inbox is:unread newer_than:2d -category:promotions -category:social",
  ) {}

  async needsReply(): Promise<EmailSummary[]> {
    const res = obj(await this.call(this.server, "search_threads", { query: this.query, pageSize: 20 }));
    return arr(res.threads).flatMap((t) => {
      const msgs = arr(obj(t).messages);
      const last = obj(msgs[msgs.length - 1]);
      if (!last.id) return [];
      return [{ id: str(last.id), from: str(last.sender), subject: str(last.subject), snippet: str(last.snippet).slice(0, 300), receivedAt: str(last.date) }];
    });
  }
}

/** Google Calendar through its MCP server. */
export class CalendarSource {
  constructor(
    private call: ToolCaller,
    private clock: () => Date = () => new Date(),
    private server = "google_calendar",
  ) {}

  async today(): Promise<CalendarEvent[]> {
    const now = this.clock();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const res = obj(await this.call(this.server, "list_events", { startTime: start.toISOString(), endTime: end.toISOString(), orderBy: "startTime", pageSize: 50 }));
    return arr(res.events ?? res.items).map((e) => {
      const ev = obj(e);
      const t = (x: unknown) => str(obj(x).dateTime) || str(obj(x).date) || str(x);
      return { start: t(ev.start), end: t(ev.end), title: str(ev.summary) || "(no title)", attendees: arr(ev.attendees).map((a) => str(obj(a).email)).filter(Boolean) };
    });
  }
}
