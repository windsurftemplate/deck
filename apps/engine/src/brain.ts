import { execFile } from "node:child_process";
import { extractFile, fetchPage, readAppleNotes, readNotionZip, parseMarkdown, type Extracted, type HistoryItem } from "@deck/ingest";
import { embedChunks, type Embedder, type MemoryStore } from "@deck/memory";
import { redactSecrets, scanInjection } from "@deck/gate";

export interface BrainDeps {
  store: MemoryStore;
  embedder: Embedder;
  clock: () => Date;
  log: (summary: string) => Promise<void>;
  fetch?: typeof fetch;
  osascript?: (script: string) => Promise<string>;
  /** Optional second opinion on injection (Jev): probability the text tries to instruct an AI, or null if unavailable. */
  checkInjection?: (text: string) => Promise<number | null>;
}

export interface GraphNode {
  id: string;
  label: string;
  type: "subject" | "doc" | "owner";
  /** doc kind, or how many facts a subject has */
  kind?: string;
  size: number;
}
export interface GraphLink {
  source: string;
  target: string;
  label: string;
}

const runJxa = (script: string) =>
  new Promise<string>((resolve, reject) =>
    execFile("osascript", ["-l", "JavaScript", "-e", script], { maxBuffer: 200_000_000, timeout: 120_000 }, (err, out) => (err ? reject(new Error(/not allowed|1743/i.test(String(err)) ? "macOS blocked access to Notes. Allow deck in System Settings > Privacy & Security > Automation." : `Could not read Apple Notes: ${err.message}`)) : resolve(out))),
  );

/** The second brain: documents, notes and imports, searchable by the crew and drawn as a 3D graph. */
export class Brain {
  constructor(private d: BrainDeps) {}
  private now() {
    return this.d.clock().toISOString();
  }

  private async save(x: Extracted, kind: string, source: string): Promise<{ id: number; title: string; chunks: number; warning?: string }> {
    if (!x.text.trim()) throw new Error(`${x.title || source}: no text to add.`);
    const scan = scanInjection(x.text);
    // Keys and tokens are removed before anything is stored, so the second brain never holds a live secret.
    const redacted = redactSecrets(scan.clean);
    const secrets = redacted.findings.reduce((a, f) => a + f.count, 0);
    x = { ...x, title: redactSecrets(x.title).clean, text: redacted.clean };
    if (scan.score < 0.5 && this.d.checkInjection) {
      const p = await this.d.checkInjection(x.text.slice(0, 6000)).catch(() => null);
      if (p !== null && p >= 0.75) {
        scan.score = 0.75;
        scan.signals.push(`Jev: likely tries to instruct an AI (${Math.round(p * 100)}%)`);
      }
    }
    const chunks = await embedChunks(this.d.embedder, x.title, x.text);
    const id = await this.d.store.addDocument({ title: x.title.slice(0, 200), kind, source: source.slice(0, 500), text: x.text }, chunks, this.now());
    for (const to of x.links.slice(0, 50)) await this.d.store.addEdge(x.title, "links to", to, this.now());
    if (scan.score >= 0.5) {
      const warning = `"${x.title}" contains text that tries to instruct the crew (${scan.signals.join("; ")}). It was added, and the crew will see a warning whenever it reads it.`;
      await this.d.log(`Scanner: ${warning}`);
      return { id, title: x.title, chunks: chunks.length, warning: secrets ? `${warning} ${secrets} key or token${secrets > 1 ? "s were" : " was"} removed.` : warning };
    }
    if (secrets) {
      const note = `"${x.title}": ${secrets} key or token${secrets > 1 ? "s were" : " was"} removed before saving.`;
      await this.d.log(`Scanner: ${note}`);
      return { id, title: x.title, chunks: chunks.length, warning: note };
    }
    return { id, title: x.title, chunks: chunks.length };
  }

  private async many(items: Extracted[], kind: string, source: (x: Extracted) => string) {
    const out = { added: 0, skipped: 0, errors: [] as string[] };
    const existing = new Set((await this.d.store.documents(kind)).map((d) => d.source));
    for (const x of items) {
      const src = source(x);
      if (existing.has(src)) (out.skipped++, void 0);
      else
        try {
          await this.save(x, kind, src);
          out.added++;
        } catch (e) {
          out.errors.push((e as Error).message);
        }
    }
    await this.d.log(`Imported ${out.added} ${kind} notes into the second brain${out.skipped ? ` (${out.skipped} already there)` : ""}.`);
    return out;
  }

  async addFile(name: string, base64: string) {
    const x = await extractFile(name, new Uint8Array(Buffer.from(base64, "base64")));
    const r = await this.save(x, "file", name);
    await this.d.log(`Added the file "${r.title}" to the second brain.`);
    return r;
  }

  async addText(title: string, text: string) {
    const r = await this.save({ title: title.trim() || text.trim().split("\n")[0]!.slice(0, 60) || "Pasted text", text, links: [] }, "text", "pasted");
    await this.d.log(`Added "${r.title}" to the second brain.`);
    return r;
  }

  async addLink(url: string) {
    const p = await fetchPage(url, this.d.fetch ?? fetch);
    const r = await this.save(p, "page", p.url);
    await this.d.log(`Added the web page "${r.title}" to the second brain.`);
    return r;
  }

  /** Obsidian or any Markdown folder: files picked in the app (path and text). */
  importMarkdown(files: { path: string; content: string }[]) {
    const notes = files.filter((f) => /\.(md|markdown)$/i.test(f.path) && !/(^|\/)\.(obsidian|trash)\//.test(f.path)).slice(0, 5000);
    return this.many(notes.map((f) => ({ ...parseMarkdown(f.path, f.content), path: f.path }) as Extracted & { path: string }), "obsidian", (x) => (x as Extracted & { path: string }).path);
  }

  importNotionZip(base64: string) {
    return this.many(readNotionZip(new Uint8Array(Buffer.from(base64, "base64"))), "notion", (x) => `notion:${x.title}`);
  }

  async importAppleNotes() {
    if (process.platform !== "darwin" && !this.d.osascript) throw new Error("Apple Notes import works on a Mac.");
    return this.many(await readAppleNotes(this.d.osascript ?? runJxa), "apple-notes", (x) => `apple-notes:${x.title}`);
  }

  /** ChatGPT or Codex conversations, one note each, scanned and with keys removed like every import. */
  importHistory(items: HistoryItem[], kind: "chatgpt" | "codex") {
    return this.many(items, kind, (x) => (x as HistoryItem).source);
  }

  /** Notes written in the app. */
  async saveNote(id: number | null, title: string, text: string) {
    const t = title.trim() || "Untitled note";
    if (id === null) return this.save({ title: t, text: text || " ", links: parseMarkdown(t, text).links }, "note", "written in deck");
    await this.d.store.updateDocument(id, { title: t, text }, await embedChunks(this.d.embedder, t, text), this.now());
    return { id, title: t, chunks: 0 };
  }

  documents(kind?: string) {
    return this.d.store.documents(kind);
  }
  document(id: number) {
    return this.d.store.document(id);
  }
  async remove(id: number) {
    const d = await this.d.store.document(id);
    await this.d.store.deleteDocument(id);
    if (d) await this.d.log(`Removed "${d.title}" from the second brain.`);
  }

  /**
   * The brain as a graph: subjects (from facts), documents, and the links between them
   * (relationships, note links, and documents that mention a subject by name).
   */
  async graph(limit = 600): Promise<{ nodes: GraphNode[]; links: GraphLink[]; facts: Record<string, string[]> }> {
    const { facts, edges } = await this.d.store.graph();
    const docs = await this.d.store.documents();
    const nodes = new Map<string, GraphNode>();
    const facts_: Record<string, string[]> = {};
    for (const f of facts) {
      const id = `s:${f.subject.toLowerCase()}`;
      (facts_[id] ??= []).push(f.claim);
      const isOwner = f.subject.toLowerCase() === "owner";
      const n = nodes.get(id) ?? { id, label: isOwner ? "You" : f.subject, type: isOwner ? "owner" : "subject", size: 0 };
      n.size++;
      nodes.set(id, n);
    }
    const links: GraphLink[] = [];
    const subj = (name: string) => {
      const id = `s:${name.toLowerCase()}`;
      const byTitle = docs.find((d) => d.title.toLowerCase() === name.toLowerCase());
      if (!nodes.has(id) && byTitle) return `d:${byTitle.id}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: name, type: "subject", size: 1 });
      return id;
    };
    for (const d of docs.slice(0, limit)) nodes.set(`d:${d.id}`, { id: `d:${d.id}`, label: d.title, type: "doc", kind: d.kind, size: Math.min(6, 1 + Math.log10(1 + d.chars / 500)) });
    for (const e of edges) links.push({ source: subj(e.from), target: subj(e.to), label: e.relation });
    // Documents that mention a subject by name.
    const names = [...nodes.values()].filter((n) => n.type !== "doc" && n.label.length >= 3);
    for (const d of docs.slice(0, 200)) {
      const full = (await this.d.store.document(d.id))!.text.toLowerCase().slice(0, 200_000);
      for (const n of names) if (full.includes(n.label.toLowerCase())) links.push({ source: `d:${d.id}`, target: n.id, label: "mentions" });
    }
    const seen = new Set<string>();
    return { nodes: [...nodes.values()].slice(0, limit * 2), links: links.filter((l) => l.source !== l.target && !seen.has(`${l.source}>${l.target}`) && (seen.add(`${l.source}>${l.target}`), true)), facts: facts_ };
  }
}
