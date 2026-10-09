import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import Database from "better-sqlite3-multiple-ciphers";
import { afterAll, describe, expect, it } from "vitest";
import { openCodexStore, parseChatGPTConversations, parseCodexRollout, readChatGPTExport, scanChatGPT, scanCodex } from "./index.js";

const made: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), "openai-"));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const msg = (role: string, parts: unknown[], extra: Record<string, unknown> = {}) => ({ author: { role }, content: { content_type: "text", parts }, ...extra });
/** A conversation with a system note, an edited question (two branches), an image part and a code answer. */
const CONVERSATIONS = [
  {
    id: "c1",
    title: "Pricing for the Pro plan",
    create_time: 1759800000,
    update_time: 1759900000,
    current_node: "a2",
    mapping: {
      root: { parent: null, message: null },
      s: { parent: "root", message: { ...msg("system", ["You are ChatGPT"]), metadata: { is_visually_hidden_from_conversation: true } } },
      u1: { parent: "s", message: msg("user", ["What should Pro cost?"]) },
      old: { parent: "u1", message: msg("assistant", ["An answer from a branch you left"]) },
      a1: { parent: "u1", message: msg("assistant", ["About $20 a month.", { content_type: "image_asset_pointer" }]) },
      u2: { parent: "a1", message: msg("user", ["Show the formula"]) },
      t: { parent: "u2", message: { author: { role: "tool" }, content: { content_type: "text", parts: ["tool noise"] } } },
      a2: { parent: "t", message: { author: { role: "assistant" }, content: { content_type: "code", language: "python", text: "price = cost * 1.4" } } },
    },
  },
  { id: "c2", title: "", create_time: 1759000000, update_time: 1759000100, current_node: "x", mapping: { x: { parent: null, message: msg("user", ["Draft a launch email for deck"]) } } },
  { id: "empty", title: "Nothing", current_node: "n", mapping: { n: { parent: null, message: msg("system", ["hidden"]) } } },
];

describe("ChatGPT export", () => {
  it("keeps the branch you ended on, your messages and ChatGPT's answers, and leaves out system, tool and image parts", () => {
    const [a, b] = parseChatGPTConversations(CONVERSATIONS);
    expect(a).toMatchObject({ title: "ChatGPT: Pricing for the Pro plan", source: "chatgpt:c1", messages: 4, truncated: false, createdAt: "2025-10-07T01:20:00.000Z" });
    expect(a!.text).toContain("**You:** What should Pro cost?\n\n**ChatGPT:** About $20 a month.\n\n**You:** Show the formula\n\n**ChatGPT:** ```python\nprice = cost * 1.4\n```");
    expect(a!.text).not.toMatch(/branch you left|tool noise|You are ChatGPT/);
    expect(b).toMatchObject({ title: "ChatGPT: Draft a launch email for deck", messages: 1 }); // untitled: from the first question
    expect(parseChatGPTConversations(CONVERSATIONS)).toHaveLength(2); // nothing visible: skipped
  });

  it("reads the export zip (only conversations.json is unpacked) or the json itself, from a path", () => {
    const zip = zipSync({ "conversations.json": strToU8(JSON.stringify(CONVERSATIONS)), "file-abc.png": new Uint8Array(1000) });
    expect(readChatGPTExport(zip, "export.zip")).toHaveLength(2);
    expect(() => readChatGPTExport(zipSync({ "chat.html": strToU8("<html>") }), "x.zip")).toThrow(/no conversations.json/);
    const d = dir();
    writeFileSync(join(d, "conversations.json"), JSON.stringify(CONVERSATIONS));
    expect(scanChatGPT(d)).toMatchObject({ kind: "chatgpt", items: [{ source: "chatgpt:c1" }, { source: "chatgpt:c2" }] });
    expect(() => scanChatGPT(join(d, "nope.zip"))).toThrow(/No file/);
  });

  it("cuts very long conversations and says so", () => {
    const long = [{ id: "l", title: "Long", current_node: "m", mapping: { m: { parent: null, message: msg("user", ["x".repeat(200_000)]) } } }];
    const [c] = parseChatGPTConversations(long);
    expect(c!.truncated).toBe(true);
    expect(c!.text).toMatch(/\[\.\.\. cut: the conversation continues\]$/);
  });
});

describe("Codex sessions", () => {
  const rollout = [
    { timestamp: "2026-09-01T10:00:00Z", type: "session_meta", payload: { id: "s-1", cwd: "/Users/me/app", git: { branch: "main", commit_hash: "abcdef1234567" } } },
    { timestamp: "2026-09-01T10:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
    { timestamp: "2026-09-01T10:00:02Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the failing login test" }] } },
    { timestamp: "2026-09-01T10:00:03Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }) } },
    { timestamp: "2026-09-01T10:00:04Z", type: "response_item", payload: { type: "function_call_output", output: "secret output" } },
    { timestamp: "2026-09-01T10:00:05Z", type: "event_msg", payload: { type: "agent_message", message: "duplicate of the item below" } },
    { timestamp: "2026-09-01T10:05:00Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "The token expiry was off by one; fixed." }] } },
  ];
  it("reads CLI session files, leaving out Codex's own context, command output and repeated events", () => {
    const r = parseCodexRollout(rollout.map((l) => JSON.stringify(l)).join("\n"), "file-id");
    expect(r.thread).toMatchObject({ id: "s-1", cwd: "/Users/me/app", branch: "main", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:05:00Z" });
    expect(r.events).toEqual([{ kind: "user", text: "<environment_context>cwd</environment_context>" }, { kind: "user", text: "Fix the failing login test" }, { kind: "command", command: "npm test", exitCode: null }, { kind: "agent", text: "The token expiry was off by one; fixed." }]);
    // The earlier layout: a bare first line, then items.
    const old = parseCodexRollout([{ id: "old-1", timestamp: "2025-05-01T09:00:00Z", instructions: "" }, { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }].map((l) => JSON.stringify(l)).join("\n"), "f");
    expect(old.thread.id).toBe("old-1");
    expect(old.events).toEqual([{ kind: "user", text: "Hello" }]);
  });

  it("reads the Codex app's history read-only, skips sub-agent threads, and also the session files it does not have", () => {
    const home = dir();
    const state = new Database(join(home, "state_5.sqlite"));
    state.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, git_branch TEXT, git_sha TEXT, created_at INTEGER, created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER, source TEXT, thread_source TEXT, archived INTEGER)");
    const add = state.prepare("INSERT INTO threads VALUES (?, ?, ?, 'main', 'abc123', 0, ?, 0, ?, ?, ?, 0)");
    add.run("t1", "Speed up the build", "/Users/me/app", Date.parse("2026-09-02T08:00:00Z"), Date.parse("2026-09-02T09:00:00Z"), "vscode", "user");
    add.run("t2", "review", "/Users/me/app", 1, 1, '{"subagent":{"other":"guardian"}}', "guardian_review");
    state.close();
    const hist = new Database(join(home, "thread_history_1.sqlite"));
    hist.exec("CREATE TABLE thread_items (thread_id TEXT, item_type TEXT, item_json TEXT, rollout_ordinal INTEGER)");
    const item = hist.prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?)");
    item.run("t1", "userMessage", JSON.stringify({ content: [{ type: "text", text: "Why is the build slow?" }] }), 1);
    item.run("t1", "reasoning", JSON.stringify({ summary: ["private thinking"] }), 2);
    item.run("t1", "commandExecution", JSON.stringify({ command: "pnpm build", exitCode: 0, aggregatedOutput: "lots of output" }), 3);
    item.run("t1", "fileChange", JSON.stringify({ changes: [{ path: "turbo.json", diff: "+cache" }] }), 4);
    item.run("t1", "agentMessage", JSON.stringify({ text: "Turned on the Turbo cache." }), 5);
    item.run("t2", "userMessage", JSON.stringify({ content: [{ text: "review this" }] }), 1);
    hist.close();
    mkdirSync(join(home, "sessions", "2026", "09", "01"), { recursive: true });
    writeFileSync(join(home, "sessions", "2026", "09", "01", "rollout-2026-09-01T10-00-00-0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"), rollout.map((l) => JSON.stringify(l)).join("\n"));
    writeFileSync(join(home, "auth.json"), '{"OPENAI_API_KEY": "never read"}');
    const scan = scanCodex({ dir: home, openStore: openCodexStore });
    expect(scan.skipped).toBe(1);
    expect(scan.items.map((x) => x.source)).toEqual(["codex:t1", "codex:s-1"]);
    const t1 = scan.items[0]!;
    expect(t1).toMatchObject({ title: "Codex: Speed up the build", project: "/Users/me/app", messages: 2 });
    expect(t1.text).toContain("Project: /Users/me/app (branch main, commit abc123)");
    expect(t1.text).toContain("**You:** Why is the build slow?\n\n- Ran `pnpm build` (exit 0)\n\n- Changed turbo.json\n\n**Codex:** Turned on the Turbo cache.");
    expect(t1.text).not.toMatch(/private thinking|lots of output|\+cache/);
    expect(scan.items[1]!.text).not.toMatch(/environment_context|secret output|duplicate/);
    expect(JSON.stringify(scan)).not.toContain("never read");
    expect(scanCodex({ dir: home, openStore: openCodexStore, includeAgents: true }).items).toHaveLength(3);
  });

  it("falls back to session files when the app's storage has an unknown layout", () => {
    const home = dir();
    new Database(join(home, "state_9.sqlite")).exec("CREATE TABLE something_else (x)");
    new Database(join(home, "thread_history_9.sqlite")).exec("CREATE TABLE thread_items (a)");
    expect(openCodexStore(home)).toBeNull();
    expect(scanCodex({ dir: home, openStore: openCodexStore })).toMatchObject({ items: [], skipped: 0 });
    expect(() => scanCodex({ dir: join(home, "missing") })).toThrow(/No Codex folder/);
  });
});
