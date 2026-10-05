import { chunks, runButton, runCommand, type BotActions, type Channel, type ChannelButton } from "./commands.js";
import type { WebSocketCtor } from "./slack.js";

const API = "https://discord.com/api/v10";
const INTENT_DIRECT_MESSAGES = 1 << 12;

/**
 * Discord over the Gateway: deck opens an outbound WebSocket, so nothing listens on your machine.
 * Only direct messages from the owner's user ids are served; server channels are ignored.
 */
export class DiscordChannel implements Channel {
  readonly name = "discord";
  private socket: { send(d: string): void; close(): void } | null = null;
  private running = false;
  private seq: number | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private dm = new Map<string, string>();
  private backoff = 1000;
  constructor(
    private o: { token: string; owners: string[]; actions: BotActions; fetch?: typeof fetch; WebSocket?: WebSocketCtor; log?: (m: string) => void },
  ) {
    if (!o.owners.length) throw new Error("discord: at least one owner user id is required");
  }
  private log(m: string) {
    this.o.log?.(m);
  }
  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await (this.o.fetch ?? fetch)(`${API}${path}`, { method, headers: { authorization: `Bot ${this.o.token}`, "content-type": "application/json", "user-agent": "DiscordBot (https://github.com/windsurftemplate/deck, 0.1)" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401) throw new Error("Discord rejected the bot token.");
    if (!res.ok) throw new Error(`Discord ${method} ${path.split("/")[1]}: ${res.status}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }
  private components(buttons?: ChannelButton[]) {
    if (!buttons?.length) return [];
    return [{ type: 1, components: buttons.map((b) => ({ type: 2, style: b.verb === "approve" ? 3 : 4, label: b.label, custom_id: `${b.verb}:${b.id}`.slice(0, 100) })) }];
  }
  private async send(channel: string, text: string, buttons?: ChannelButton[]) {
    const parts = chunks(text, 1900);
    for (let k = 0; k < parts.length; k++) await this.api("POST", `/channels/${channel}/messages`, { content: parts[k], components: k === parts.length - 1 ? this.components(buttons) : [], allowed_mentions: { parse: [] } });
  }
  async notify(text: string, buttons?: ChannelButton[]) {
    for (const user of this.o.owners) {
      try {
        let ch = this.dm.get(user);
        if (!ch) {
          ch = (await this.api<{ id: string }>("POST", "/users/@me/channels", { recipient_id: user })).id;
          this.dm.set(user, ch);
        }
        await this.send(ch, text, buttons);
      } catch (e) {
        this.log(`notify failed: ${(e as Error).message}`);
      }
    }
  }
  /** Handles one Gateway dispatch. Exposed for tests. */
  async dispatch(t: string, d: Record<string, unknown>): Promise<void> {
    if (t === "MESSAGE_CREATE") {
      const author = d.author as { id?: string; bot?: boolean } | undefined;
      if (!author?.id || author.bot || d.guild_id) return; // direct messages only, never other bots
      if (!this.o.owners.includes(author.id)) return void this.log(`ignored message from ${author.id}`);
      const reply = await runCommand(String(d.content ?? ""), this.o.actions, "discord", "!");
      await this.send(String(d.channel_id), reply);
      return;
    }
    if (t === "INTERACTION_CREATE" && d.type === 3) {
      const user = (d.user as { id?: string } | undefined)?.id ?? ((d.member as { user?: { id?: string } } | undefined)?.user?.id ?? "");
      const ok = this.o.owners.includes(user);
      const [verb, ...rest] = String((d.data as { custom_id?: string } | undefined)?.custom_id ?? "").split(":");
      const reply = ok ? runButton(verb ?? "", rest.join(":"), this.o.actions) : "Only the owner can do that.";
      if (!ok) this.log(`ignored button from ${user}`);
      // Type 7 updates the message in place and removes its buttons; type 4 with ephemeral flag for strangers.
      await this.api("POST", `/interactions/${d.id}/${d.token}/callback`, ok ? { type: 7, data: { content: reply.slice(0, 1900), components: [] } } : { type: 4, data: { content: reply, flags: 64 } }).catch((e) => this.log(`interaction failed: ${(e as Error).message}`));
    }
  }
  private async connect() {
    const { url } = await this.api<{ url: string }>("GET", "/gateway/bot");
    const Ctor = this.o.WebSocket ?? (globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket;
    const ws = new Ctor(`${url}/?v=10&encoding=json`);
    this.socket = ws;
    const send = (op: number, d: unknown) => ws.send(JSON.stringify({ op, d }));
    ws.onmessage = (e) => {
      let m: { op: number; d: Record<string, unknown> & { heartbeat_interval?: number }; s?: number | null; t?: string };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (typeof m.s === "number") this.seq = m.s;
      if (m.op === 10) {
        if (this.beat) clearInterval(this.beat);
        this.beat = setInterval(() => send(1, this.seq), m.d.heartbeat_interval ?? 41_250);
        send(2, { token: this.o.token, intents: INTENT_DIRECT_MESSAGES, properties: { os: process.platform, browser: "deck", device: "deck" } });
      } else if (m.op === 1) send(1, this.seq);
      else if (m.op === 7 || m.op === 9) void this.reconnect();
      else if (m.op === 0 && m.t) {
        if (m.t === "READY") this.backoff = 1000;
        void this.dispatch(m.t, m.d).catch((err) => this.log(`event failed: ${(err as Error).message}`));
      }
    };
    ws.onclose = () => {
      if (this.running && this.socket === ws) void this.reconnect();
    };
    ws.onerror = () => {};
  }
  private async reconnect() {
    if (!this.running) return;
    if (this.beat) clearInterval(this.beat);
    try {
      this.socket?.close();
    } catch {
      /* closed */
    }
    this.socket = null;
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
    if (this.beat) clearInterval(this.beat);
    try {
      this.socket?.close();
    } catch {
      /* closed */
    }
    this.socket = null;
  }
}
