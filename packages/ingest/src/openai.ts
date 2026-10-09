import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { Extracted } from "./index.js";

/**
 * OpenAI history for the second brain: ChatGPT conversations from the official data export, and Codex sessions
 * from the Codex folder on this computer. One note per conversation: what was asked, what was answered, and for
 * Codex what was run (with exit codes) and which files changed. Command output, diffs, reasoning and anything
 * that looks like credentials are left out; auth files are never opened.
 */

export interface HistoryItem extends Extracted {
  /** Stable key, so importing again skips what is already there. */
  source: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: number;
  /** Codex: the project folder the session worked in. */
  project?: string;
  /** Cut to MAX_ITEM_CHARS. */
  truncated: boolean;
}

export interface HistoryScan {
  kind: "chatgpt" | "codex";
  items: HistoryItem[];
  /** Codex: sub-agent and automatic review threads left out. */
  skipped: number;
  /** Where it was read from and in which format, for the preview. */
  from: string;
}

export const MAX_ITEM_CHARS = 120_000;
const iso = (secondsOrMs: unknown): string | null => {
  const n = Number(secondsOrMs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
};
const cutItem = (text: string) => (text.length > MAX_ITEM_CHARS ? { text: `${text.slice(0, MAX_ITEM_CHARS)}\n\n[... cut: the conversation continues]`, truncated: true } : { text, truncated: false });
const oneLine = (s: string, n = 80) => s.replace(/\s+/g, " ").trim().slice(0, n);

/* ---------- ChatGPT: the data export ---------- */

interface ChatNode {
  parent?: string | null;
  message?: { author?: { role?: string }; content?: { content_type?: string; parts?: unknown[]; text?: string; language?: string }; create_time?: number | null; metadata?: Record<string, unknown> } | null;
}
interface ChatConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatNode>;
}

/** The visible text of one message, or "" for tool calls, hidden system notes, images and other non-text parts. */
function messageText(m: NonNullable<ChatNode["message"]>): string {
  const c = m.content;
  if (!c || m.metadata?.is_visually_hidden_from_conversation) return "";
  if (c.content_type === "code" && c.text) return `\`\`\`${c.language && c.language !== "unknown" ? c.language : ""}\n${c.text}\n\`\`\``;
  if (c.content_type !== "text" && c.content_type !== "multimodal_text") return "";
  return (c.parts ?? []).filter((p): p is string => typeof p === "string").join("\n").trim();
}

/** Conversations from ChatGPT's conversations.json: the branch you ended on, your messages and ChatGPT's answers. */
export function parseChatGPTConversations(data: unknown): HistoryItem[] {
  const list = (Array.isArray(data) ? data : []) as ChatConversation[];
  const out: HistoryItem[] = [];
  for (const conv of list) {
    const map = conv.mapping ?? {};
    // Follow the branch from the last message back to the start: edits and regenerations leave other branches.
    const chain: NonNullable<ChatNode["message"]>[] = [];
    const seen = new Set<string>();
    for (let id = conv.current_node; id && map[id] && !seen.has(id); id = map[id]!.parent ?? undefined) {
      seen.add(id);
      if (map[id]!.message) chain.push(map[id]!.message!);
    }
    chain.reverse();
    const lines: string[] = [];
    let messages = 0;
    for (const m of chain) {
      const role = m.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = messageText(m);
      if (!text) continue;
      messages++;
      lines.push(`**${role === "user" ? "You" : "ChatGPT"}:** ${text}`);
    }
    if (!messages) continue;
    const id = String(conv.id ?? conv.conversation_id ?? `${conv.title}-${conv.create_time}`);
    const title = (conv.title ?? "").trim() || oneLine(lines[0]!.replace(/^\*\*You:\*\* /, ""), 60) || "ChatGPT conversation";
    const createdAt = iso(conv.create_time);
    const body = cutItem(`ChatGPT conversation: ${title}\n${createdAt ? `Started ${createdAt.slice(0, 10)}` : ""}\n\n${lines.join("\n\n")}`);
    out.push({ title: `ChatGPT: ${title}`, ...body, links: [], source: `chatgpt:${id}`, createdAt, updatedAt: iso(conv.update_time), messages });
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** A ChatGPT export: the .zip from Settings > Data controls > Export data, or the conversations.json inside it. */
export function readChatGPTExport(bytes: Uint8Array, name = "export.zip"): HistoryItem[] {
  let json: string;
  if (/\.json$/i.test(name)) json = new TextDecoder().decode(bytes);
  else {
    // Only conversations.json is unpacked: exports also hold images and audio that are not needed.
    const files = unzipSync(bytes, { filter: (f) => /(^|\/)conversations\.json$/.test(f.name) });
    const key = Object.keys(files)[0];
    if (!key) throw new Error("This zip has no conversations.json. Use the export from ChatGPT: Settings > Data controls > Export data.");
    json = strFromU8(files[key]!);
  }
  try {
    return parseChatGPTConversations(JSON.parse(json));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("conversations.json could not be read (it is not valid JSON).");
    throw e;
  }
}

/** Reads a ChatGPT export from a path on this computer. */
export function scanChatGPT(path: string): HistoryScan {
  const p = path.replace(/^~(?=$|\/)/, homedir());
  if (!existsSync(p)) throw new Error(`No file at ${path}.`);
  const file = statSync(p).isDirectory() ? join(p, "conversations.json") : p;
  if (!existsSync(file)) throw new Error(`No conversations.json in ${path}.`);
  if (statSync(file).size > 2_000_000_000) throw new Error("This export is larger than 2 GB.");
  return { kind: "chatgpt", items: readChatGPTExport(new Uint8Array(readFileSync(file)), file), skipped: 0, from: file };
}

/* ---------- Codex: sessions on this computer ---------- */

/** Text Codex adds to user turns itself (environment, instructions files): not something you said. */
const CODEX_INJECTED = /^\s*(<environment_context>|<user_instructions>|<permissions|<turn_aborted>|<user_shell_command>|# AGENTS\.md instructions|# Context from my IDE setup)/;

export interface CodexThread {
  id: string;
  title: string;
  cwd: string | null;
  branch: string | null;
  commit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One line per thing that happened in a Codex session, from its items (both storage formats map to these). */
export type CodexEvent = { kind: "user" | "agent"; text: string } | { kind: "command"; command: string; exitCode: number | null } | { kind: "files"; paths: string[] } | { kind: "search"; query: string } | { kind: "tool"; name: string };

/** A Codex session as a note. */
export function codexNote(t: CodexThread, events: CodexEvent[]): HistoryItem | null {
  const lines: string[] = [];
  let messages = 0;
  for (const e of events) {
    if (e.kind === "user" || e.kind === "agent") {
      if (!e.text.trim() || (e.kind === "user" && CODEX_INJECTED.test(e.text))) continue;
      messages++;
      lines.push(`**${e.kind === "user" ? "You" : "Codex"}:** ${e.text.trim()}`);
    } else if (e.kind === "command") lines.push(`- Ran \`${oneLine(e.command, 300)}\`${e.exitCode === null ? "" : ` (exit ${e.exitCode})`}`);
    else if (e.kind === "files" && e.paths.length) lines.push(`- Changed ${e.paths.slice(0, 20).join(", ")}${e.paths.length > 20 ? ` and ${e.paths.length - 20} more` : ""}`);
    else if (e.kind === "search") lines.push(`- Searched the web: ${oneLine(e.query, 200)}`);
    else if (e.kind === "tool") lines.push(`- Used ${e.name}`);
  }
  if (!messages) return null;
  const firstAsk = (events.find((e) => e.kind === "user" && !CODEX_INJECTED.test(e.text)) as { text: string } | undefined)?.text ?? "";
  const title = t.title.trim() || oneLine(firstAsk, 60) || "Codex session";
  const where = t.cwd ? `Project: ${t.cwd}${t.branch ? ` (branch ${t.branch}${t.commit ? `, commit ${t.commit.slice(0, 10)}` : ""})` : ""}\n` : "";
  const body = cutItem(`Codex session: ${title}\n${where}${t.createdAt ? `Started ${t.createdAt.slice(0, 10)}` : ""}${t.updatedAt ? `, last active ${t.updatedAt.slice(0, 10)}` : ""}\n\n${lines.join("\n\n")}`);
  return { title: `Codex: ${title}`, ...body, links: [], source: `codex:${t.id}`, createdAt: t.createdAt, updatedAt: t.updatedAt, messages, ...(t.cwd ? { project: t.cwd } : {}) };
}

/** Maps one stored Codex item (the app's thread history) to an event. Unknown kinds are skipped. */
export function codexItemEvent(type: string, item: Record<string, unknown>): CodexEvent | null {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (type) {
    case "userMessage":
      return { kind: "user", text: (Array.isArray(item.content) ? item.content : []).map((c) => s((c as { text?: unknown }).text)).join("\n") };
    case "agentMessage":
      return { kind: "agent", text: s(item.text) };
    case "commandExecution":
      return { kind: "command", command: s(item.command), exitCode: typeof item.exitCode === "number" ? item.exitCode : null };
    case "fileChange":
      return { kind: "files", paths: (Array.isArray(item.changes) ? item.changes : []).map((c) => s((c as { path?: unknown }).path)).filter(Boolean) };
    case "webSearch":
      return { kind: "search", query: s(item.query) };
    case "mcpToolCall":
      return { kind: "tool", name: `${s(item.server)}.${s(item.tool)}` };
    default:
      return null;
  }
}

/** One Codex session file (JSON Lines, from the Codex CLI's sessions folder), in the current or the earlier layout. */
export function parseCodexRollout(jsonl: string, fallbackId: string): { thread: CodexThread; events: CodexEvent[]; agent: boolean } {
  const thread: CodexThread = { id: fallbackId, title: "", cwd: null, branch: null, commit: null, createdAt: null, updatedAt: null };
  const events: CodexEvent[] = [];
  let agent = false;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof j.timestamp === "string" ? j.timestamp : null;
    if (ts) (thread.createdAt ??= ts), (thread.updatedAt = ts);
    const p = (j.payload && typeof j.payload === "object" ? j.payload : j) as Record<string, unknown>;
    if (j.type === "session_meta" || (!j.type && p.id && "instructions" in p)) {
      thread.id = String(p.id ?? thread.id);
      thread.cwd = typeof p.cwd === "string" ? p.cwd : thread.cwd;
      const git = (p.git ?? {}) as Record<string, unknown>;
      thread.branch = typeof git.branch === "string" ? git.branch : null;
      thread.commit = typeof git.commit_hash === "string" ? git.commit_hash : null;
      if (p.source && typeof p.source === "object") agent = true; // sub-agent sessions carry their parent here
      continue;
    }
    // Current layout: only response items (events and turn context repeat what they say). Earlier layout: items are bare.
    if ("payload" in j && j.type !== "response_item") continue;
    const t = p.type;
    const text = (Array.isArray(p.content) ? p.content : []).map((c) => String((c as { text?: unknown }).text ?? "")).join("\n");
    if (t === "message" && p.role === "user") events.push({ kind: "user", text });
    else if (t === "message" && p.role === "assistant") events.push({ kind: "agent", text });
    else if (t === "function_call" || t === "local_shell_call") {
      let cmd = "";
      try {
        const args = (typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.action ?? {}) as { command?: unknown };
        cmd = Array.isArray(args.command) ? args.command.map(String).join(" ").replace(/^(bash|zsh|sh) -lc /, "") : String(args.command ?? "");
      } catch {
        /* not a command */
      }
      if (cmd) events.push({ kind: "command", command: cmd, exitCode: null });
      else if (typeof p.name === "string") events.push({ kind: "tool", name: p.name });
    }
  }
  return { thread, events, agent };
}

export interface CodexStore {
  /** Threads with their details; agent threads (sub-agents, automatic reviews) are marked. */
  threads(): (CodexThread & { agent: boolean; archived: boolean })[];
  /** A thread's items in order: type and parsed JSON. */
  items(threadId: string): { type: string; item: Record<string, unknown> }[];
  close?(): void;
}

/** Codex sessions: from the app's thread history when present, otherwise from the CLI's session files. */
export function scanCodex(o: { dir?: string; openStore?: (dir: string) => CodexStore | null; includeAgents?: boolean } = {}): HistoryScan {
  const dir = (o.dir ?? "~/.codex").replace(/^~(?=$|\/)/, homedir());
  if (!existsSync(dir)) throw new Error(`No Codex folder at ${o.dir ?? "~/.codex"}.`);
  const items: HistoryItem[] = [];
  const skippedIds = new Set<string>();
  const seen = new Set<string>();
  const store = o.openStore?.(dir) ?? null;
  if (store)
    try {
      for (const t of store.threads()) {
        if (t.agent && !o.includeAgents) {
          skippedIds.add(t.id);
          continue;
        }
        const note = codexNote(t, store.items(t.id).map((x) => codexItemEvent(x.type, x.item)).filter((e): e is CodexEvent => !!e));
        if (note) items.push(note), seen.add(t.id);
      }
    } finally {
      store.close?.();
    }
  // Session files: older Codex versions, and the CLI. Threads already read from the app are not read twice.
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 5 || !existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
      else if (e.isFile() && /\.jsonl$/.test(e.name)) files.push(join(d, e.name));
    }
  };
  walk(join(dir, "sessions"), 0);
  for (const f of files.slice(0, 20_000)) {
    if (statSync(f).size > 200_000_000) continue;
    const id = f.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/)?.[1] ?? f;
    if (seen.has(id) || skippedIds.has(id)) continue;
    const r = parseCodexRollout(readFileSync(f, "utf8"), id);
    if (seen.has(r.thread.id) || skippedIds.has(r.thread.id)) continue;
    if (r.agent && !o.includeAgents) {
      skippedIds.add(r.thread.id);
      continue;
    }
    const note = codexNote(r.thread, r.events);
    if (note) items.push(note), seen.add(r.thread.id);
  }
  const from = store && files.length ? `${dir} (app history and session files)` : store ? `${dir} (app history)` : `${dir}/sessions`;
  return { kind: "codex", items: items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")), skipped: skippedIds.size, from };
}
