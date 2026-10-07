import { identifierWords } from "./chunk.js";
import type { CodeEdge } from "./chunk.js";
import type { ChunkToStore, CodeIndexStore, FixRecord, IndexedFile, StoredCodeChunk, StoredEdge } from "./store.js";

/** In-memory adapter, for tests and for running without a workspace file. Same behavior as the SQLite one. */
export class InMemoryCodeIndexStore implements CodeIndexStore {
  private fileRows = new Map<string, IndexedFile>();
  private chunks: (StoredCodeChunk & { project: string; words: string; vec: Float32Array | null })[] = [];
  private next = 1;
  private fixes: (FixRecord & { project: string })[] = [];
  private links: (StoredEdge & { project: string })[] = [];
  constructor(private vecDim: number | null = null) {}
  private key = (project: string, path: string) => `${project}\0${path}`;
  private out = ({ project: _p, words: _w, vec: _v, ...c }: (typeof this.chunks)[number]): StoredCodeChunk => c;

  async dim() {
    return this.vecDim;
  }
  async files(project: string) {
    return [...this.fileRows.entries()].filter(([k]) => k.startsWith(`${project}\0`)).map(([, f]) => ({ ...f })).sort((a, b) => a.path.localeCompare(b.path));
  }
  async putFile(project: string, file: IndexedFile, chunks: ChunkToStore[], edges: CodeEdge[] = []) {
    for (const c of chunks) if (c.vec && this.vecDim !== null && c.vec.length !== this.vecDim) throw new Error(`code index: vector has ${c.vec.length} dimensions, expected ${this.vecDim}`);
    this.chunks = this.chunks.filter((c) => !(c.project === project && c.path === file.path));
    this.links = [...this.links.filter((e) => !(e.project === project && e.path === file.path)), ...edges.map((e) => ({ ...e, project, path: file.path }))];
    this.fileRows.set(this.key(project, file.path), { ...file });
    for (const c of chunks) this.chunks.push({ ...c, project, id: this.next++, hash: file.hash, commit: file.commit, vec: this.vecDim === null ? null : c.vec });
  }
  async touchFile(project: string, path: string, size: number, mtimeMs: number) {
    const f = this.fileRows.get(this.key(project, path));
    if (f) Object.assign(f, { size, mtimeMs });
  }
  async edges(project: string, q: { kind?: CodeEdge["kind"]; name?: string; path?: string }) {
    return this.links.filter((e) => e.project === project && (!q.kind || e.kind === q.kind) && (!q.name || e.name === q.name) && (!q.path || e.path === q.path)).map(({ project: _p, ...e }) => e).sort((a, b) => a.path.localeCompare(b.path) || a.from.localeCompare(b.from));
  }
  async removeFile(project: string, path: string) {
    this.chunks = this.chunks.filter((c) => !(c.project === project && c.path === path));
    this.links = this.links.filter((e) => !(e.project === project && e.path === path));
    this.fileRows.delete(this.key(project, path));
  }
  async byName(project: string, name: string, limit: number) {
    const n = name.trim().toLowerCase();
    if (!n) return [];
    const mine = this.chunks.filter((c) => c.project === project);
    const exact = mine.filter((c) => c.name.toLowerCase() === n || c.qualified.toLowerCase() === n).sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file") || a.path.localeCompare(b.path) || a.startLine - b.startLine);
    const partial = mine.filter((c) => c.kind !== "file" && !exact.includes(c) && (c.name.toLowerCase().includes(n) || c.qualified.toLowerCase().includes(n))).sort((a, b) => a.name.length - b.name.length || a.path.localeCompare(b.path));
    return [...exact, ...partial].slice(0, limit).map(this.out);
  }
  async byKeyword(project: string, query: string, limit: number) {
    const words = [...new Set(`${identifierWords(query)} ${query.toLowerCase()}`.match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
    if (!words.length) return [];
    const score = (c: (typeof this.chunks)[number]) => {
      const fields: [string, number][] = [[c.name.toLowerCase(), 8], [c.words, 4], [c.signature.toLowerCase(), 2], [c.text.toLowerCase(), 1]];
      return words.reduce((s, w) => s + fields.reduce((t, [f, wt]) => t + (new RegExp(`\\b${w}\\b`).test(f) ? wt : 0), 0), 0);
    };
    return this.chunks.filter((c) => c.project === project).map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => this.out(x.c));
  }
  async byVector(project: string, vec: Float32Array, limit: number) {
    if (this.vecDim === null) return [];
    const dist = (a: Float32Array) => a.reduce((s, x, i) => s + (x - vec[i]!) ** 2, 0);
    return this.chunks.filter((c) => c.project === project && c.vec).sort((a, b) => dist(a.vec!) - dist(b.vec!)).slice(0, limit).map(this.out);
  }
  async addFix(project: string, f: Omit<FixRecord, "id">) {
    const id = this.fixes.length + 1;
    this.fixes.push({ ...structuredClone(f), id, project });
    return id;
  }
  async listFixes(project: string, limit: number) {
    return this.fixes.filter((f) => f.project === project).reverse().slice(0, limit).map(({ project: _p, ...f }) => structuredClone(f));
  }
  async clear(project: string) {
    for (const f of await this.files(project)) await this.removeFile(project, f.path);
    this.fixes = this.fixes.filter((f) => f.project !== project);
  }
}
