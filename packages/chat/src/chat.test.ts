import { describe, expect, it, vi } from "vitest";
import { ChatBot, TelegramClient, type BotActions, type Update } from "./index.js";

const TOKEN = "123456789:" + "A".repeat(35); // fake bot token, built at runtime
const OWNER = 42;

function setup(overrides: Partial<BotActions> = {}) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3]));
    const method = u.split("/").pop()!;
    calls.push({ method, body: JSON.parse((init?.body as string) ?? "{}") });
    const result = method === "getFile" ? { file_path: "voice/1.ogg" } : { message_id: 1 };
    return new Response(JSON.stringify({ ok: true, result }));
  });
  const actions: BotActions = {
    brief: async () => "- 10:00 Acme call",
    tasks: () => "2 open tasks",
    status: () => "All systems up",
    approve: (id) => `Approved ${id}`,
    reject: (id) => `Rejected ${id}`,
    undo: (id) => `Undone ${id}`,
    kill: (a) => `Stopped ${a}`,
    message: async (t) => `CoS: ${t}`,
    ...overrides,
  };
  const bot = new ChatBot(new TelegramClient(TOKEN, f as unknown as typeof fetch), [OWNER], actions);
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text);
  return { bot, calls, sent };
}
const msg = (text: string, from = OWNER): Update => ({ update_id: 1, message: { message_id: 1, chat: { id: from }, from: { id: from }, text } });

describe("chat bot", () => {
  it("serves the owner's commands", async () => {
    const { bot, sent } = setup();
    for (const t of ["/brief", "/approve ab12", "/kill gtm", "/kill", "draft a reply to Dana", "/nope", "/apply"]) await bot.handle(msg(t));
    expect(sent()).toEqual(["- 10:00 Acme call", "Approved ab12", "Stopped gtm", "Stopped all", "CoS: draft a reply to Dana", expect.stringMatching(/^Unknown command/), "Which one? /apply <id>"]);
  });

  it("ignores everyone who is not the owner, including button presses", async () => {
    const approve = vi.fn(() => "x");
    const { bot, calls } = setup({ approve });
    await bot.handle(msg("/approve ab12", 999));
    await bot.handle({ update_id: 2, callback_query: { id: "q", from: { id: 999 }, data: "approve:ab12" } });
    expect(calls).toHaveLength(0);
    expect(approve).not.toHaveBeenCalled();
  });

  it("approval cards have buttons that resolve and update the card", async () => {
    const { bot, calls } = setup();
    await bot.notifyApproval(OWNER, { id: "ab12", agent: "GTM", summary: "Send email to dana@acme.com", detail: "Hi Dana" });
    expect(calls[0]!.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Approve", callback_data: "approve:ab12" }, { text: "Reject", callback_data: "reject:ab12" }]] });
    await bot.handle({ update_id: 3, callback_query: { id: "q", from: { id: OWNER }, message: { chat: { id: OWNER }, message_id: 7 }, data: "reject:ab12" } });
    expect(calls.map((c) => c.method)).toEqual(["sendMessage", "answerCallbackQuery", "editMessageText"]);
    expect(calls[2]!.body.text).toBe("Rejected ab12");
  });

  it("turns a voice note into a message", async () => {
    const { bot, sent } = setup({ transcribe: async () => "remind me to call Dana" });
    await bot.handle({ update_id: 4, message: { message_id: 1, chat: { id: OWNER }, from: { id: OWNER }, voice: { file_id: "f", duration: 3 } } });
    expect(sent()).toEqual(["Heard: remind me to call Dana", "CoS: remind me to call Dana"]);
  });

  it("refuses a bad token and requires an owner", () => {
    expect(() => new TelegramClient("nope")).toThrow(/bot token/);
    expect(() => new ChatBot(new TelegramClient(TOKEN), [], {} as BotActions)).toThrow(/owner/);
  });
});
