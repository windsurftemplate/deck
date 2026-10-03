import { randomUUID } from "node:crypto";
import type { DB } from "@deck/memory";

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface ThreadMessage {
  role: "owner" | "agent";
  text: string;
  ts: string;
}

/** Saved chats (like a chat sidebar), in the encrypted workspace file. */
export class Threads {
  constructor(private db: DB, private clock: () => Date = () => new Date()) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_messages (id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, role TEXT NOT NULL, text TEXT NOT NULL, ts TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_messages_by_thread ON thread_messages(thread_id, id);`);
  }
  private now() {
    return this.clock().toISOString();
  }
  create(title = "New chat"): Thread {
    const t = { id: randomUUID(), title, createdAt: this.now(), updatedAt: this.now() };
    this.db.prepare("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(t.id, t.title, t.createdAt, t.updatedAt);
    return t;
  }
  list(): Thread[] {
    return (this.db.prepare("SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT 200").all() as { id: string; title: string; created_at: string; updated_at: string }[]).map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  exists(id: string) {
    return !!this.db.prepare("SELECT 1 FROM threads WHERE id = ?").get(id);
  }
  messages(id: string, limit = 200): ThreadMessage[] {
    return (this.db.prepare("SELECT role, text, ts FROM (SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(id, limit) as ThreadMessage[]);
  }
  /** Adds the owner's message and the reply; the first message names the chat. */
  add(id: string, owner: string, agent: string) {
    const ts = this.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO thread_messages (thread_id, role, text, ts) VALUES (?, 'owner', ?, ?), (?, 'agent', ?, ?)").run(id, owner, ts, id, agent, ts);
      const t = this.db.prepare("SELECT title FROM threads WHERE id = ?").get(id) as { title: string };
      const title = t.title === "New chat" ? owner.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60) || "New chat" : t.title;
      this.db.prepare("UPDATE threads SET updated_at = ?, title = ? WHERE id = ?").run(ts, title, id);
    })();
  }
  rename(id: string, title: string) {
    const t = title.trim().slice(0, 80);
    if (!t) throw new Error("A chat needs a name.");
    this.db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(t, id);
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM thread_messages WHERE thread_id = ?").run(id);
    this.db.prepare("DELETE FROM threads WHERE id = ?").run(id);
  }
}
