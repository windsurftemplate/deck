import { chunks, runButton, runCommand, type BotActions, type Channel, type ChannelButton } from "./commands.js";

type WS = { send(data: string): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: ((e: unknown) => void) | null; onopen: (() => void) | null };
export type WebSocketCtor = new (url: string) => WS;

/**
 * Slack in Socket Mode: deck opens an outbound WebSocket to Slack, so nothing listens on your machine.
 * Only direct messages from the owner's user ids are served; everything else is ignored.
 * Needs a bot token (xoxb-) with chat:write, im:history, im:read, im:write, and an app token (xapp-) with connections:write.
 */
export class SlackChannel implements Channel {
  readonly name = "slack";
  private ws: WS | null = null;
  private running = false;
  private dm = new Map<string, string>();
  private backoff = 1000;
  constructor(
    private o: { botToken: string; appToken: string; owners: string[]; actions: BotActions; fetch?: typeof fetch; WebSocket?: WebSocketCtor; log?: (m: string) => void },
  ) {
    if (!o.owners.length) throw new Error("slack: at least one owner user id is required");
  }
  private log(m: string) {
    this.o.log?.(m);
  }
  private async api<T>(method: string, body: Record<string, unknown>, token = this.o.botToken): Promise<T> {
    const res = await (this.o.fetch ?? fetch)(`https://slack.com/api/${method}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    const j = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!j.ok) throw new Error(`Slack ${method}: ${j.error ?? res.status}`);
    return j;
  }
  private blocks(text: string, buttons?: ChannelButton[]) {
    const section = { type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } };
    if (!buttons?.length) return [section];
    return [section, { type: "actions", elements: buttons.map((b) => ({ type: "button", text: { type: "plain_text", text: b.label }, action_id: `${b.verb}:${b.id}`, value: b.id, ...(b.verb === "approve" ? { style: "primary" } : b.verb === "reject" || b.verb === "undo" ? { style: "danger" } : {}) })) }];
  }
  private async send(channel: string, text: string, buttons?: ChannelButton[]) {
    const parts = chunks(text, 2900);
    for (let k = 0; k < parts.length; k++) await this.api("chat.postMessage", { channel, text: parts[k], blocks: this.blocks(parts[k]!, k === parts.length - 1 ? buttons : undefined) });
  }
  async notify(text: string, buttons?: ChannelButton[]) {
    for (const user of this.o.owners) {
      try {
        let ch = this.dm.get(user);
        if (!ch) {
          ch = (await this.api<{ channel: { id: string } }>("conversations.open", { users: user })).channel.id;
          this.dm.set(user, ch);
        }
        await this.send(ch, text, buttons);
      } catch (e) {
        this.log(`notify failed: ${(e as Error).message}`);
      }
    }
  }
  /** Handles one Socket Mode envelope. Exposed for tests. */
  async handle(env: { envelope_id?: string; type: string; payload?: Record<string, unknown> }, ack: (id: string) => void): Promise<void> {
    if (env.envelope_id) ack(env.envelope_id); // Slack retries anything not acknowledged within 3 seconds
    if (env.type === "disconnect") return this.reconnect();
    const p = env.payload ?? {};
    if (env.type === "events_api") {
      const ev = (p.event ?? {}) as { type?: string; channel_type?: string; user?: string; text?: string; bot_id?: string; subtype?: string; channel?: string };
      if (ev.type !== "message" || ev.channel_type !== "im" || ev.bot_id || ev.subtype || !ev.user || !ev.channel) return;
      if (!this.o.owners.includes(ev.user)) return void this.log(`ignored message from ${ev.user}`);
      const reply = await runCommand(ev.text ?? "", this.o.actions, "slack", "!");
      await this.send(ev.channel, reply);
      return;
    }
    if (env.type === "interactive" && p.type === "block_actions") {
      const user = (p.user as { id?: string } | undefined)?.id ?? "";
      if (!this.o.owners.includes(user)) return void this.log(`ignored button from ${user}`);
      const act = ((p.actions as { action_id?: string }[] | undefined) ?? [])[0];
      const [verb, ...rest] = (act?.action_id ?? "").split(":");
      const reply = runButton(verb ?? "", rest.join(":"), this.o.actions);
      const ch = (p.channel as { id?: string } | undefined)?.id;
      const ts = (p.message as { ts?: string } | undefined)?.ts;
      if (ch && ts) await this.api("chat.update", { channel: ch, ts, text: reply, blocks: this.blocks(reply) }).catch((e) => this.log(`update failed: ${(e as Error).message}`));
    }
  }
  private async connect() {
    const { url } = await this.api<{ url: string }>("apps.connections.open", {}, this.o.appToken);
    const Ctor = this.o.WebSocket ?? (globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket;
    const ws = new Ctor(url);
    this.ws = ws;
    ws.onopen = () => (this.backoff = 1000);
    ws.onmessage = (e) => {
      let env: { envelope_id?: string; type: string; payload?: Record<string, unknown> };
      try {
        env = JSON.parse(String(e.data));
      } catch {
        return;
      }
      void this.handle(env, (id) => ws.send(JSON.stringify({ envelope_id: id }))).catch((err) => this.log(`event failed: ${(err as Error).message}`));
    };
    ws.onclose = () => {
      if (this.running && this.ws === ws) void this.reconnect();
    };
    ws.onerror = () => {};
  }
  private async reconnect() {
    if (!this.running) return;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    await new Promise((r) => setTimeout(r, this.backoff));
    this.backoff = Math.min(this.backoff * 2, 60_000);
    await this.connect().catch((e) => (this.log(`connect failed: ${(e as Error).message}`), void this.reconnect()));
  }
  async start() {
    this.running = true;
    await this.connect().catch((e) => (this.log(`connect failed: ${(e as Error).message}`), void this.reconnect()));
  }
  stop() {
    this.running = false;
    try {
      this.ws?.close();
    } catch {
      /* closed */
    }
    this.ws = null;
  }
}
