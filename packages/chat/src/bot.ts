import type { TelegramClient, Update } from "./telegram.js";

/** What the bot can ask the rest of the app to do. */
export interface BotActions {
  brief(): Promise<string>;
  tasks(): string;
  status(): string;
  approve(id: string): string;
  /** Stops an approved action during its undo window. */
  undo(id: string): string;
  reject(id: string): string;
  kill(agent: string): string;
  /** Free text goes to the Chief of Staff. */
  message(text: string): Promise<string>;
  /** Optional: confirm a settings change the crew proposed in chat. */
  apply?(id: string): Promise<string>;
  /** Optional: voice notes become text (local Whisper). */
  transcribe?(audio: Uint8Array): Promise<string>;
}

const HELP = ["/brief  morning briefing now", "/tasks  open tasks", "/status  crew and systems", "/approve <id>  /reject <id>", "/undo <id>  stop an approved action before it runs", "/kill <agent|all>  emergency stop"].join("\n");

/** Telegram front door. Only the owner's chat ids are served; everyone else is ignored. */
export class ChatBot {
  private offset = 0;
  private running = false;
  constructor(
    private tg: TelegramClient,
    private owners: number[],
    private actions: BotActions,
    private log: (msg: string) => void = () => {},
  ) {
    if (!owners.length) throw new Error("chat: at least one owner chat id is required");
  }

  /** Plain message to the owner (for example: an approved action finished). */
  notify(chatId: number, text: string) {
    return this.tg.sendMessage(chatId, text);
  }

  /** Approval card with buttons. */
  notifyApproval(chatId: number, a: { id: string; agent: string; summary: string; detail: string }) {
    return this.tg.sendMessage(chatId, `${a.agent} needs you\n${a.summary}\n\n${a.detail.slice(0, 1500)}\n\nid ${a.id}`, [
      [
        { text: "Approve", data: `approve:${a.id}` },
        { text: "Reject", data: `reject:${a.id}` },
      ],
    ]);
  }

  async handle(u: Update): Promise<void> {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!this.owners.includes(q.from.id)) return void this.log(`ignored button from ${q.from.id}`);
      const [verb, id] = (q.data ?? "").split(":");
      const reply = verb === "approve" && id ? this.actions.approve(id) : verb === "reject" && id ? this.actions.reject(id) : "Unknown button.";
      await this.tg.answerCallback(q.id, reply.slice(0, 190));
      if (q.message) await this.tg.editMessage(q.message.chat.id, q.message.message_id, reply);
      return;
    }
    const m = u.message;
    if (!m) return;
    const sender = m.from?.id ?? m.chat.id;
    if (!this.owners.includes(sender)) return void this.log(`ignored message from ${sender}`);
    const chat = m.chat.id;
    let text = m.text?.trim() ?? "";
    if (!text && m.voice && this.actions.transcribe) {
      try {
        text = (await this.actions.transcribe(await this.tg.downloadFile(m.voice.file_id))).trim();
        if (text) await this.tg.sendMessage(chat, `Heard: ${text}`);
      } catch {
        await this.tg.sendMessage(chat, "Could not transcribe that voice note. Try again or type it.");
        return;
      }
    }
    if (!text) return;
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    let reply: string;
    switch (cmd?.toLowerCase().replace(/@\w+$/, "")) {
      case "/start":
      case "/help":
        reply = HELP;
        break;
      case "/brief":
        reply = await this.actions.brief();
        break;
      case "/tasks":
        reply = this.actions.tasks();
        break;
      case "/status":
        reply = this.actions.status();
        break;
      case "/approve":
        reply = arg ? this.actions.approve(arg) : "Which one? /approve <id>";
        break;
      case "/reject":
        reply = arg ? this.actions.reject(arg) : "Which one? /reject <id>";
        break;
      case "/apply":
        reply = arg && this.actions.apply ? await this.actions.apply(arg) : "Which one? /apply <id>";
        break;
      case "/undo":
        reply = arg ? this.actions.undo(arg) : "Which one? /undo <id>";
        break;
      case "/kill":
        reply = this.actions.kill(arg || "all");
        break;
      default:
        reply = cmd?.startsWith("/") ? `Unknown command.\n${HELP}` : await this.actions.message(text);
    }
    await this.tg.sendMessage(chat, reply);
  }

  /** Long-poll loop. One failed update never stops the bot. */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      let updates: Update[] = [];
      try {
        updates = await this.tg.getUpdates(this.offset);
      } catch (err) {
        this.log(`poll failed: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const u of updates) {
        this.offset = u.update_id + 1;
        try {
          await this.handle(u);
        } catch (err) {
          this.log(`update ${u.update_id} failed: ${(err as Error).message}`);
        }
      }
    }
  }

  stop() {
    this.running = false;
  }
}
