import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import type { CodexStore } from "./openai.js";

/** The newest file matching name_<n>.sqlite (Codex numbers them when its storage format changes). */
function newest(dir: string, base: string): string | null {
  const found = readdirSync(dir)
    .map((f) => f.match(new RegExp(`^${base}_(\\d+)\\.sqlite$`)))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return found[0] ? join(dir, found[0][0]) : null;
}

const columns = (db: Database.Database, table: string) => new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name));

/**
 * The Codex app's thread history, opened read-only. This is Codex's own storage, not a published format: the
 * tables and columns are checked first, and anything unexpected returns null so the session files are used instead.
 */
export function openCodexStore(dir: string): CodexStore | null {
  if (!existsSync(dir)) return null;
  const statePath = newest(dir, "state");
  const historyPath = newest(dir, "thread_history");
  if (!statePath || !historyPath) return null;
  let state: Database.Database | null = null;
  let history: Database.Database | null = null;
  try {
    state = new Database(statePath, { readonly: true, fileMustExist: true });
    history = new Database(historyPath, { readonly: true, fileMustExist: true });
    const t = columns(state, "threads");
    const i = columns(history, "thread_items");
    if (!["id", "title", "cwd"].every((c) => t.has(c)) || !["thread_id", "item_type", "item_json"].every((c) => i.has(c))) throw new Error("unknown layout");
    const has = (c: string) => (t.has(c) ? c : "NULL");
    const order = i.has("rollout_ordinal") ? "rollout_ordinal" : "rowid";
    const rows = state.prepare(`SELECT id, title, cwd, ${has("git_branch")} AS branch, ${has("git_sha")} AS sha, ${has("created_at_ms")} AS created_ms, ${has("created_at")} AS created, ${has("updated_at_ms")} AS updated_ms, ${has("updated_at")} AS updated, ${has("source")} AS source, ${has("thread_source")} AS thread_source, ${has("archived")} AS archived FROM threads`).all() as Record<string, unknown>[];
    const itemsOf = history.prepare(`SELECT item_type AS type, item_json AS json FROM thread_items WHERE thread_id = ? ORDER BY ${order}`);
    const when = (ms: unknown, s: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);
    const threads = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      cwd: typeof r.cwd === "string" ? r.cwd : null,
      branch: typeof r.branch === "string" ? r.branch : null,
      commit: typeof r.sha === "string" ? r.sha : null,
      createdAt: when(r.created_ms, r.created),
      updatedAt: when(r.updated_ms, r.updated),
      // Sub-agents and automatic reviews: Codex talking to itself, not you.
      agent: String(r.source ?? "").startsWith("{") || ["subagent", "guardian_review", "agent_created_thread"].includes(String(r.thread_source ?? "")),
      archived: Number(r.archived ?? 0) === 1,
    }));
    const s = state;
    const h = history;
    return {
      threads: () => threads,
      items: (id) =>
        (itemsOf.all(id) as { type: string; json: string }[]).flatMap((x) => {
          try {
            return [{ type: x.type, item: JSON.parse(x.json) as Record<string, unknown> }];
          } catch {
            return [];
          }
        }),
      close: () => (s.close(), h.close()),
    };
  } catch {
    state?.close();
    history?.close();
    return null;
  }
}
