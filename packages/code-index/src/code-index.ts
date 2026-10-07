import { createHash } from "node:crypto";
import type { Embedder } from "@deck/memory";
import { chunkFile, identifierWords, isCode, type ChunkKind, type CodeChunk } from "./chunk.js";
import type { ChunkToStore, CodeIndexStore, IndexedFile, StoredCodeChunk } from "./store.js";

/** The project's files as the indexer sees them (a port: local folder today). Paths are relative to the root. */
export interface CodeFiles {
  /** Every file under the root, minus ignored folders. */
  list(): Promise<{ path: string; size: number; mtimeMs: number }[]>;
  read(path: string): Promise<string | null>;
  /** The commit checked out now, or null outside Git. */
  commit(): Promise<string | null>;
}

export interface RefreshReport {
  files: number;
  added: number;
  changed: number;
  removed: number;
  chunks: number;
  commit: string | null;
  /** More code files than the limit: the rest are not indexed. */
  truncated: boolean;
  /** Meaning search is off (no embedder) or failed for some chunks; keyword and name search still work. */
  meaning: "on" | "off" | "partial";
  ms: number;
}

export interface CodeHit {
  path: string;
  name: string;
  qualified: string;
  kind: ChunkKind;
  startLine: number;
  endLine: number;
  signature: string;
  /** Read fresh from the file at search time, not from the index. */
  snippet: string;
  hash: string;
  commit: string | null;
  /** Which searches found it. */
  via: ("name" | "keyword" | "meaning")[];
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** What the embedder reads for one chunk: its kind and name in words, its signature and the start of its code. */
export const embedText = (c: CodeChunk) => `${c.kind} ${c.qualified} (${identifierWords(c.name)}) in ${c.path}\n${c.signature}\n${c.text.slice(0, 1000)}`;

/**
 * The live code index for one project. Code is never memorized: the index points at code by file, lines, hash
 * and commit; every search first re-indexes changed files, and every hit is checked against the file as it is
 * now. A hit whose file changed since indexing is never served.
 */
export class CodeIndex {
  private running: Promise<RefreshReport> | null = null;
  private readonly maxFiles: number;
  private readonly maxBytes: number;

  constructor(
    private o: { store: CodeIndexStore; project: string; files: CodeFiles; embedder?: Embedder | null; maxFiles?: number; maxFileBytes?: number },
  ) {
    this.maxFiles = o.maxFiles ?? 5000;
    this.maxBytes = o.maxFileBytes ?? 300_000;
  }

  /** Brings the index up to date with the files: new and changed files are re-chunked, deleted ones dropped. */
  refresh(): Promise<RefreshReport> {
    // One refresh at a time; callers during a refresh share its result.
    this.running ??= this.doRefresh().finally(() => (this.running = null));
    return this.running;
  }

  private async doRefresh(): Promise<RefreshReport> {
    const t0 = Date.now();
    const { store, project, files } = this.o;
    const commit = await files.commit().catch(() => null);
    const all = (await files.list()).filter((f) => isCode(f.path) && f.size <= this.maxBytes).sort((a, b) => a.path.localeCompare(b.path));
    const listed = all.slice(0, this.maxFiles);
    const known = new Map((await store.files(project)).map((f) => [f.path, f]));
    const r: RefreshReport = { files: listed.length, added: 0, changed: 0, removed: 0, chunks: 0, commit, truncated: all.length > listed.length, meaning: this.o.embedder ? "on" : "off", ms: 0 };
    const here = new Set(listed.map((f) => f.path));
    for (const path of known.keys()) if (!here.has(path)) await store.removeFile(project, path), r.removed++;
    for (const f of listed) {
      const old = known.get(f.path);
      // Same size and modified time: unchanged without reading it. Anything else is hashed.
      if (old && old.size === f.size && old.mtimeMs === f.mtimeMs) continue;
      const text = await files.read(f.path);
      if (text === null) continue;
      const hash = sha256(text);
      if (old && old.hash === hash) {
        // Touched but not changed: keep the chunks (and their vectors), remember the new time.
        await store.touchFile(project, f.path, f.size, f.mtimeMs);
        continue;
      }
      await this.put({ path: f.path, hash, commit, size: f.size, mtimeMs: f.mtimeMs }, text, r);
      if (old) r.changed++;
      else r.added++;
    }
    r.ms = Date.now() - t0;
    return r;
  }

  /** Re-chunks and stores one file. */
  private async put(file: IndexedFile, text: string, r?: RefreshReport) {
    const chunks = await chunkFile(file.path, text).catch(() => [] as CodeChunk[]);
    let vecs: (Float32Array | null)[] = chunks.map(() => null);
    if (this.o.embedder && chunks.length) {
      try {
        vecs = [];
        for (let k = 0; k < chunks.length; k += 32) vecs.push(...(await this.o.embedder.embed(chunks.slice(k, k + 32).map(embedText))));
      } catch {
        vecs = chunks.map(() => null);
        if (r) r.meaning = "partial";
      }
    }
    const rows: ChunkToStore[] = chunks.map((c, k) => ({ ...c, words: identifierWords(`${c.qualified} ${c.signature}`), vec: vecs[k] ?? null }));
    await this.o.store.putFile(this.o.project, file, rows);
    if (r) r.chunks += rows.length;
  }

  /**
   * Searches by exact name, by keyword and by meaning, merged by rank. Refreshes first; then checks each hit's
   * file against its indexed hash and re-indexes (instead of serving) any that changed.
   */
  async search(query: string, opts: { limit?: number; kind?: ChunkKind } = {}): Promise<{ hits: CodeHit[]; report: RefreshReport }> {
    const report = await this.refresh();
    const limit = Math.max(1, Math.min(opts.limit ?? 8, 25));
    let hits = await this.rank(query, limit, opts.kind);
    let fresh = await this.verify(hits);
    if (fresh.stale.length) {
      // Changed since indexing (and not caught by size and time): re-index those files, then search again.
      for (const s of fresh.stale) {
        const text = await this.o.files.read(s.path);
        if (text === null) await this.o.store.removeFile(this.o.project, s.path);
        // Time 0: the next refresh hashes it once more and, finding it unchanged, only records the time.
        else await this.put({ path: s.path, hash: sha256(text), commit: report.commit, size: Buffer.byteLength(text), mtimeMs: 0 }, text);
      }
      hits = await this.rank(query, limit, opts.kind);
      fresh = await this.verify(hits);
    }
    return { hits: fresh.ok, report };
  }

  private async rank(query: string, limit: number, kind?: ChunkKind) {
    const { store, project, embedder } = this.o;
    const want = limit * 3;
    const [byName, byKeyword, byMeaning] = await Promise.all([
      store.byName(project, query, want),
      store.byKeyword(project, query, want),
      embedder ? embedder.embed([query]).then(([v]) => (v ? store.byVector(project, v, want) : []), () => []) : Promise.resolve([] as StoredCodeChunk[]),
    ]);
    const score = new Map<number, { c: StoredCodeChunk; s: number; via: Set<CodeHit["via"][number]> }>();
    const add = (list: StoredCodeChunk[], via: CodeHit["via"][number], weight: number) =>
      list.forEach((c, rank) => {
        const e = score.get(c.id) ?? { c, s: 0, via: new Set() };
        e.s += weight / (20 + rank);
        e.via.add(via);
        score.set(c.id, e);
      });
    add(byName, "name", 3);
    add(byKeyword, "keyword", 1);
    add(byMeaning, "meaning", 1);
    const q = query.trim().toLowerCase();
    for (const e of score.values()) {
      // An exact name is what someone searching for a name wants; the file head is only a fallback.
      if (e.c.name.toLowerCase() === q || e.c.qualified.toLowerCase() === q) e.s += 1;
      if (e.c.kind === "file") e.s *= 0.5;
    }
    return [...score.values()].filter((e) => !kind || e.c.kind === kind).sort((a, b) => b.s - a.s).slice(0, limit);
  }

  /** Reads each hit's file now. Matching hash: served with a fresh snippet. Different: stale, never served. */
  private async verify(hits: { c: StoredCodeChunk; via: Set<CodeHit["via"][number]> }[]) {
    const now = new Map<string, string | null>();
    const ok: CodeHit[] = [];
    const stale: { path: string }[] = [];
    for (const { c, via } of hits) {
      if (!now.has(c.path)) now.set(c.path, await this.o.files.read(c.path));
      const text = now.get(c.path)!;
      if (text === null || sha256(text) !== c.hash) {
        if (!stale.some((s) => s.path === c.path)) stale.push({ path: c.path });
        continue;
      }
      const lines = text.split("\n");
      const end = Math.min(c.endLine, c.startLine + 24);
      const snippet = lines.slice(c.startLine - 1, end).join("\n") + (end < c.endLine ? `\n… (${c.endLine - end} more lines)` : "");
      ok.push({ path: c.path, name: c.name, qualified: c.qualified, kind: c.kind, startLine: c.startLine, endLine: c.endLine, signature: c.signature, snippet, hash: c.hash, commit: c.commit, via: [...via] });
    }
    return { ok, stale };
  }
}

/** Search results as text for an agent: where each hit is, which commit and hash it was checked against, and its code. */
export function formatHits(query: string, hits: CodeHit[], r: RefreshReport): string {
  const head = `Code index: ${r.files} files${r.truncated ? " (limit reached; some files not indexed)" : ""}, commit ${r.commit?.slice(0, 10) ?? "none"}; this search re-indexed ${r.added + r.changed} changed file(s) and dropped ${r.removed}. Meaning search ${r.meaning}.`;
  if (!hits.length) return `${head}\nNothing found for "${query}". Try another name or describe what the code does.`;
  return `${head}\n\n${hits.map((h, k) => `${k + 1}. ${h.kind} ${h.qualified} at ${h.path}:${h.startLine}-${h.endLine} (found by ${h.via.join(", ")}; file hash ${h.hash.slice(0, 12)}, checked just now)\n${h.snippet}`).join("\n\n")}`;
}
