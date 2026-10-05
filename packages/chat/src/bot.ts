import type { TelegramClient, Update } from "./telegram.js";

import { approvalButtons, approvalText, runButton, runCommand, type BotActions, type Channel, type ChannelButton } from "./commands.js";

export type { BotActions };

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

  /** Plain message to the owner, optionally with buttons (approve, reject, undo). */
  notify(chatId: number, text: string, buttons?: ChannelButton[]) {
    return this.tg.sendMessage(chatId, text.slice(0, 4000), buttons?.length ? [buttons.map((b) => ({ text: b.label, data: `${b.verb}:${b.id}` }))] : undefined);
  }

  /** Approval card with buttons. */
  notifyApproval(chatId: number, a: { id: string; agent: string; summary: string; detail: string }) {
    return this.notify(chatId, approvalText(a), approvalButtons(a.id));
  }

  async handle(u: Update): Promise<void> {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!this.owners.includes(q.from.id)) return void this.log(`ignored button from ${q.from.id}`);
      const [verb, id] = (q.data ?? "").split(":");
      const reply = runButton(verb ?? "", id ?? "", this.actions);
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
    const reply = await runCommand(text, this.actions, "telegram", "/");
    await this.tg.sendMessage(chat, reply.slice(0, 4000));
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

/** Telegram as a channel: every owner chat gets the message. */
export class TelegramChannel implements Channel {
  readonly name = "telegram";
  constructor(
    readonly bot: ChatBot,
    private owners: number[],
  ) {}
  start() {
    void this.bot.start();
  }
  stop() {
    this.bot.stop();
  }
  async notify(text: string, buttons?: ChannelButton[]) {
    for (const id of this.owners) await this.bot.notify(id, text, buttons).catch(() => {});
  }
}
