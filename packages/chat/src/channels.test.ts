import { describe, expect, it } from "vitest";
import { DiscordChannel, SlackChannel, chunks, type BotActions } from "./index.js";

const actions = (log: string[]): BotActions => ({
  brief: async () => "Brief: 2 meetings",
  tasks: () => "1 open task",
  status: () => "ok",
  approve: (id) => (log.push(`approve ${id}`), `Approved ${id}`),
  reject: (id) => (log.push(`reject ${id}`), `Rejected ${id}`),
  undo: (id) => (log.push(`undo ${id}`), `Undone ${id}`),
  kill: (a) => `Stopped ${a}`,
  message: async (t, ch) => `CoS (${ch}): ${t}`,
});

class FakeWS {
  static last: FakeWS | null = null;
  sent: string[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
  emit(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("Slack channel", () => {
  it("serves only the owner's direct messages, runs commands and buttons, and acknowledges every envelope", async () => {
    const calls: { method: string; body: Record<string, unknown>; auth: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const method = url.split("/api/")[1]!;
      calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")), auth: (init?.headers as Record<string, string>).authorization! });
      const r = method === "apps.connections.open" ? { ok: true, url: "wss://wss.slack.test/link" } : method === "conversations.open" ? { ok: true, channel: { id: "D1" } } : { ok: true };
      return new Response(JSON.stringify(r));
    }) as unknown as typeof fetch;
    const log: string[] = [];
    const s = new SlackChannel({ botToken: "xoxb-bot", appToken: "xapp-1-app", owners: ["U_OWNER"], actions: actions(log), fetch: f, WebSocket: FakeWS as never });
    await s.start();
    expect(calls[0]).toMatchObject({ method: "apps.connections.open", auth: "Bearer xapp-1-app" });
    const ws = FakeWS.last!;
    ws.emit({ envelope_id: "e1", type: "events_api", payload: { event: { type: "message", channel_type: "im", user: "U_OWNER", text: "draft a follow-up to Dana", channel: "D1" } } });
    ws.emit({ envelope_id: "e2", type: "events_api", payload: { event: { type: "message", channel_type: "im", user: "U_STRANGER", text: "!kill all", channel: "D9" } } });
    ws.emit({ envelope_id: "e3", type: "events_api", payload: { event: { type: "message", channel_type: "channel", user: "U_OWNER", text: "in a channel", channel: "C1" } } });
    ws.emit({ envelope_id: "e4", type: "events_api", payload: { event: { type: "message", channel_type: "im", user: "U_OWNER", text: "!brief", channel: "D1" } } });
    await tick();
    expect(ws.sent.map((x) => JSON.parse(x).envelope_id)).toEqual(["e1", "e2", "e3", "e4"]);
    const posts = calls.filter((c) => c.method === "chat.postMessage").map((c) => c.body.text);
    expect(posts).toEqual(["CoS (slack): draft a follow-up to Dana", "Brief: 2 meetings"]);
    expect(calls.filter((c) => c.method === "chat.postMessage").every((c) => c.auth === "Bearer xoxb-bot")).toBe(true);
    await s.notify("gtm needs you\nSend email", [{ label: "Approve", verb: "approve", id: "a1" }, { label: "Reject", verb: "reject", id: "a1" }]);
    const card = calls.filter((c) => c.method === "chat.postMessage").at(-1)!.body as { channel: string; blocks: { type: string; elements?: { action_id: string }[] }[] };
    expect(card.channel).toBe("D1");
    expect(card.blocks[1]!.elements!.map((e) => e.action_id)).toEqual(["approve:a1", "reject:a1"]);
    ws.emit({ envelope_id: "e5", type: "interactive", payload: { type: "block_actions", user: { id: "U_STRANGER" }, actions: [{ action_id: "approve:a1" }], channel: { id: "D1" }, message: { ts: "1.1" } } });
    ws.emit({ envelope_id: "e6", type: "interactive", payload: { type: "block_actions", user: { id: "U_OWNER" }, actions: [{ action_id: "approve:a1" }], channel: { id: "D1" }, message: { ts: "1.1" } } });
    await tick();
    expect(log).toEqual(["approve a1"]);
    expect(calls.find((c) => c.method === "chat.update")!.body).toMatchObject({ channel: "D1", ts: "1.1", text: "Approved a1" });
    s.stop();
  });
});

describe("Discord channel", () => {
  it("identifies with direct-message intent only, serves the owner's DMs, ignores servers and bots, and handles buttons", async () => {
    const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const path = url.replace("https://discord.com/api/v10", "");
      calls.push({ method: init?.method ?? "GET", path, body: JSON.parse(String(init?.body ?? "{}")) });
      if (path === "/gateway/bot") return new Response(JSON.stringify({ url: "wss://gateway.discord.test" }));
      if (path === "/users/@me/channels") return new Response(JSON.stringify({ id: "DM1" }));
      return new Response(JSON.stringify({ id: "m1" }));
    }) as unknown as typeof fetch;
    const log: string[] = [];
    const d = new DiscordChannel({ token: "bot-token", owners: ["111"], actions: actions(log), fetch: f, WebSocket: FakeWS as never });
    await d.start();
    const ws = FakeWS.last!;
    expect(ws.url).toBe("wss://gateway.discord.test/?v=10&encoding=json");
    ws.emit({ op: 10, d: { heartbeat_interval: 60_000 } });
    const identify = JSON.parse(ws.sent[0]!);
    expect(identify).toMatchObject({ op: 2, d: { token: "bot-token", intents: 4096 } });
    ws.emit({ op: 0, s: 1, t: "MESSAGE_CREATE", d: { author: { id: "111" }, channel_id: "DM1", content: "what is on today?" } });
    ws.emit({ op: 0, s: 2, t: "MESSAGE_CREATE", d: { author: { id: "222" }, channel_id: "DM2", content: "!kill all" } });
    ws.emit({ op: 0, s: 3, t: "MESSAGE_CREATE", d: { author: { id: "111" }, guild_id: "G1", channel_id: "C1", content: "in a server" } });
    ws.emit({ op: 0, s: 4, t: "MESSAGE_CREATE", d: { author: { id: "333", bot: true }, channel_id: "DM1", content: "!approve a1" } });
    await tick();
    const posts = calls.filter((c) => c.path.endsWith("/messages")).map((c) => [c.path, c.body.content]);
    expect(posts).toEqual([["/channels/DM1/messages", "CoS (discord): what is on today?"]]);
    await d.notify("Approved: Send email. Runs in 60 s.", [{ label: "Undo", verb: "undo", id: "a1" }]);
    const card = calls.filter((c) => c.path.endsWith("/messages")).at(-1)!.body as { components: { components: { custom_id: string; style: number }[] }[] };
    expect(card.components[0]!.components[0]).toMatchObject({ custom_id: "undo:a1", style: 4 });
    ws.emit({ op: 0, s: 5, t: "INTERACTION_CREATE", d: { id: "i1", token: "tok", type: 3, user: { id: "999" }, data: { custom_id: "undo:a1" } } });
    ws.emit({ op: 0, s: 6, t: "INTERACTION_CREATE", d: { id: "i2", token: "tok", type: 3, user: { id: "111" }, data: { custom_id: "undo:a1" } } });
    await tick();
    expect(log).toEqual(["undo a1"]);
    const cbs = calls.filter((c) => c.path.includes("/callback"));
    expect(cbs[0]!.body).toMatchObject({ type: 4, data: { flags: 64 } }); // strangers get a private refusal
    expect(cbs[1]!.body).toMatchObject({ type: 7, data: { content: "Undone a1", components: [] } });
    d.stop();
  });
  it("splits long messages within platform limits", () => {
    const parts = chunks("line\n".repeat(1000), 1900);
    expect(parts.every((p) => p.length <= 1900)).toBe(true);
    expect(parts.join("\n").replace(/\n+/g, "\n").length).toBeGreaterThan(4000);
  });
});
