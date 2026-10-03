type Fetch = typeof fetch;

export interface Button {
  text: string;
  data: string;
}

export interface Update {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string; voice?: { file_id: string; duration: number } };
  callback_query?: { id: string; from: { id: number }; message?: { chat: { id: number }; message_id: number }; data?: string };
}

/** Minimal Telegram Bot API client. The bot token lives in the OS keychain, never in config files. */
export class TelegramClient {
  private base: string;
  constructor(
    token: string,
    private f: Fetch = fetch,
  ) {
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("telegram: that does not look like a bot token");
    this.base = `https://api.telegram.org/bot${token}`;
  }

  private async api<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.f(`${this.base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram: ${method} failed: ${j.description ?? res.status}`);
    return j.result;
  }

  getUpdates(offset: number, timeoutSec = 25) {
    return this.api<Update[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] });
  }

  sendMessage(chatId: number, text: string, buttons?: Button[][]) {
    return this.api<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
    });
  }

  editMessage(chatId: number, messageId: number, text: string) {
    return this.api("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4096) });
  }

  answerCallback(id: string, text?: string) {
    return this.api("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const file = await this.api<{ file_path: string }>("getFile", { file_id: fileId });
    const res = await this.f(`${this.base.replace("/bot", "/file/bot")}/${file.file_path}`);
    if (!res.ok) throw new Error(`telegram: file download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
