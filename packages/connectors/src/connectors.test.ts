import { describe, expect, it } from "vitest";
import { CalendarSource, GmailSource, type ToolCaller } from "./index.js";

describe("Google sources", () => {
  it("normalizes Gmail threads to the latest message", async () => {
    const calls: unknown[] = [];
    const call: ToolCaller = async (server, tool, args) => {
      calls.push({ server, tool, args });
      return { threads: [{ messages: [{ id: "1", sender: "a@x.com", subject: "old" }, { id: "2", sender: "dana@acme.com", subject: "Re: pilot", snippet: "Q2 works", date: "2026-10-02" }] }, { messages: [] }] };
    };
    const got = await new GmailSource(call).needsReply();
    expect(got).toEqual([{ id: "2", from: "dana@acme.com", subject: "Re: pilot", snippet: "Q2 works", receivedAt: "2026-10-02" }]);
    expect(calls[0]).toMatchObject({ server: "gmail", tool: "search_threads" });
  });

  it("asks Calendar for today in local time and handles all-day events", async () => {
    let args: Record<string, unknown> = {};
    const call: ToolCaller = async (_s, _t, a) => {
      args = a;
      return { events: [{ summary: "Acme call", start: { dateTime: "2026-10-02T10:00:00-07:00" }, end: { dateTime: "2026-10-02T10:30:00-07:00" }, attendees: [{ email: "dana@acme.com" }] }, { start: { date: "2026-10-02" }, end: { date: "2026-10-03" } }] };
    };
    const got = await new CalendarSource(call, () => new Date(2026, 9, 2, 7, 30)).today();
    expect(new Date(args.startTime as string)).toEqual(new Date(2026, 9, 2, 0, 0));
    expect(got[0]).toEqual({ start: "2026-10-02T10:00:00-07:00", end: "2026-10-02T10:30:00-07:00", title: "Acme call", attendees: ["dana@acme.com"] });
    expect(got[1]!.title).toBe("(no title)");
  });

  it("survives odd responses without throwing", async () => {
    expect(await new GmailSource(async () => null).needsReply()).toEqual([]);
    expect(await new CalendarSource(async () => "nope").today()).toEqual([]);
  });
});
