import { useEffect, useRef, useState } from "react";
import { engineCall, inTauri } from "../bridge";
import { BrainScene, type BrainLink, type BrainNode } from "./scene";

type Doc = { id: number; title: string; kind: string; source: string; chars: number; updatedAt: string };
type Graph = { nodes: BrainNode[]; links: BrainLink[]; facts: Record<string, string[]> };
const KIND: Record<string, string> = { file: "File", text: "Pasted text", page: "Web page", note: "Note", obsidian: "Obsidian", notion: "Notion", "apple-notes": "Apple Notes" };

const toBase64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The second brain: a 3D map of what the crew knows, and every way to add to it. */
export function BrainView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const scene = useRef<BrainScene | null>(null);
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [], facts: {} });
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<"add" | "notes" | "library">("add");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ title: string; text: string; id?: number } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState({ title: "", text: "" });
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<{ id: number | null; title: string; text: string }>({ id: null, title: "", text: "" });
  const [drag, setDrag] = useState(false);

  const refresh = async () => {
    const [g, d] = await Promise.all([engineCall<Graph>("brain.graph").catch(() => null), engineCall<Doc[]>("brain.documents").catch(() => null)]);
    setGraph(g ?? { nodes: [], links: [], facts: {} });
    setDocs(d ?? []);
  };
  useEffect(() => {
    if (!canvas.current || !overlay.current) return;
    const s = new BrainScene(canvas.current, overlay.current, setSelected);
    scene.current = s;
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(canvas.current);
    void refresh();
    return () => (ro.disconnect(), s.dispose());
  }, []);
  useEffect(() => scene.current?.setData(graph.nodes, graph.links), [graph]);
  useEffect(() => {
    scene.current?.focus(selected);
    if (!selected) return setDetail(null);
    const n = graph.nodes.find((x) => x.id === selected);
    if (!n) return;
    if (n.type === "doc") void engineCall<{ title: string; text: string; id: number }>("brain.document", { id: Number(n.id.slice(2)) }).then((d) => d && setDetail({ title: d.title, text: d.text.slice(0, 3000), id: d.id }));
    else setDetail({ title: n.label, text: (graph.facts[n.id] ?? ["Mentioned in your documents."]).map((f) => `• ${f}`).join("\n") });
  }, [selected]);

  const run = async (label: string, f: () => Promise<unknown>) => {
    setBusy(true);
    setStatus({ ok: true, text: `${label}…` });
    try {
      const r = (await f()) as { added?: number; skipped?: number; errors?: string[]; title?: string } | null;
      if (!inTauri) setStatus({ ok: true, text: "Preview mode: adding works inside the desktop app." });
      else if (r && typeof r.added === "number") setStatus({ ok: !r.errors?.length, text: `Added ${r.added}${r.skipped ? `, ${r.skipped} already there` : ""}${r.errors?.length ? `. Could not add ${r.errors.length}: ${r.errors.slice(0, 2).join("; ")}` : "."}` });
      else setStatus({ ok: true, text: `Added "${r?.title ?? "it"}". The crew can use it now.` });
      await refresh();
    } catch (e) {
      setStatus({ ok: false, text: String(e).replace(/^Error: /, "") });
    }
    setBusy(false);
  };

  const addFiles = (files: FileList | File[]) =>
    run(`Adding ${files.length} file${files.length > 1 ? "s" : ""}`, async () => {
      let last: unknown = null;
      const errors: string[] = [];
      let added = 0;
      for (const f of Array.from(files)) {
        try {
          last = await engineCall("brain.addFile", { name: f.name, data: toBase64(await f.arrayBuffer()) });
          added++;
        } catch (e) {
          errors.push(String(e).replace(/^Error: /, ""));
        }
      }
      return files.length === 1 && !errors.length ? last : { added, errors };
    });

  const importFolder = (files: FileList) =>
    run("Importing notes", async () => {
      const md = Array.from(files).filter((f) => /\.(md|markdown)$/i.test(f.name));
      let added = 0, skipped = 0;
      const errors: string[] = [];
      for (let i = 0; i < md.length; i += 100) {
        const batch = await Promise.all(md.slice(i, i + 100).map(async (f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, content: await f.text() })));
        const r = await engineCall<{ added: number; skipped: number; errors: string[] }>("brain.importMarkdown", { files: batch });
        if (r) (added += r.added), (skipped += r.skipped), errors.push(...r.errors);
      }
      return { added, skipped, errors };
    });

  const notes = docs.filter((d) => d.kind === "note");
  return (
    <div className="brain">
      <div
        className={`brain-stage ${drag ? "drag" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), e.dataTransfer.files.length && void addFiles(e.dataTransfer.files))}
      >
        <canvas ref={canvas} className="brain-canvas" aria-label="3D map of your second brain. Drag to turn, scroll to zoom, click a point to open it." />
        <div ref={overlay} className="brain-overlay" aria-hidden="true" />
        <div className="brain-search">
          <input value={query} onChange={(e) => (setQuery(e.target.value), scene.current?.search(e.target.value))} placeholder="Find in your brain" aria-label="Find in your brain" />
          <span className="muted">
            {graph.nodes.length} points, {graph.links.length} links
          </span>
        </div>
        <div className="brain-legend" aria-hidden="true">
          <span><i style={{ background: "#ff9a3d" }} />You</span>
          <span><i style={{ background: "#c59bff" }} />People and things</span>
          <span><i style={{ background: "#6fd6ff" }} />Files</span>
          <span><i style={{ background: "#7cf5b0" }} />Notes</span>
          <span><i style={{ background: "#ff9dd2" }} />Web pages</span>
          <span><i style={{ background: "#ffd27a" }} />Imported</span>
        </div>
        {graph.nodes.length === 0 && <p className="brain-empty">Your second brain is empty. Drop files here, or add text, links or notes on the right.</p>}
        {drag && <p className="brain-empty">Drop to add to your brain</p>}
      </div>

      <aside className="brain-side">
        {detail ? (
          <section className="card">
            <div className="deck-panel-head">
              <h3>{detail.title}</h3>
              <button className="btn" type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <pre className="brain-text">{detail.text}</pre>
            {detail.id !== undefined && (
              <button className="danger" type="button" onClick={() => confirm(`Remove "${detail.title}" from your brain?`) && void run("Removing", () => engineCall("brain.delete", { id: detail.id }).then(() => (setSelected(null), { title: detail.title })))}>
                Remove from brain
              </button>
            )}
          </section>
        ) : null}
        <nav className="tabs" aria-label="Second brain">
          {(["add", "notes", "library"] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? "on" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "add" ? "Add" : t === "notes" ? "Notes" : `Library (${docs.length})`}
            </button>
          ))}
        </nav>
        {status && <p className={status.ok ? "ok" : "error"} role="status">{status.text}</p>}

        {tab === "add" && (
          <div className="stack">
            <label className="drop">
              <b>Drop files on the map, or choose them</b>
              <span className="muted">PDF, Word, Markdown, text, CSV, HTML. 25 MB each.</span>
              <input type="file" multiple accept=".pdf,.docx,.md,.markdown,.txt,.csv,.json,.html,.htm" disabled={busy} onChange={(e) => e.target.files?.length && void addFiles(e.target.files).finally(() => (e.target.value = ""))} />
            </label>
            <div className="card">
              <h3>Paste text</h3>
              <input value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} placeholder="Title (optional)" />
              <textarea rows={4} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Meeting notes, an email, anything worth remembering" />
              <button className="primary" type="button" disabled={busy || !paste.text.trim()} onClick={() => void run("Adding text", () => engineCall("brain.addText", paste)).then(() => setPaste({ title: "", text: "" }))}>
                Add text
              </button>
            </div>
            <div className="card">
              <h3>Add a web page</h3>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
              <button className="primary" type="button" disabled={busy || !url.trim()} onClick={() => void run("Reading the page", () => engineCall("brain.addLink", { url })).then(() => setUrl(""))}>
                Add page
              </button>
            </div>
            <div className="card">
              <h3>Import notes</h3>
              <label className="btn file-btn">
                Obsidian vault or Markdown folder
                <input type="file" hidden disabled={busy} {...({ webkitdirectory: "", directory: "" } as object)} onChange={(e) => e.target.files?.length && void importFolder(e.target.files).finally(() => (e.target.value = ""))} />
              </label>
              <label className="btn file-btn">
                Notion export (.zip, Markdown and CSV)
                <input type="file" hidden accept=".zip" disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await run("Importing Notion", async () => engineCall("brain.importNotion", { data: toBase64(await f.arrayBuffer()) })); }} />
              </label>
              <button className="btn" type="button" disabled={busy} onClick={() => void run("Reading Apple Notes", () => engineCall("brain.importAppleNotes"))}>
                Apple Notes (Mac)
              </button>
              <p className="muted">Imports again skip notes already added. Links between notes become links on the map.</p>
            </div>
          </div>
        )}

        {tab === "notes" && (
          <div className="stack">
            <div className="card">
              <input value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} placeholder="Note title" aria-label="Note title" />
              <textarea rows={10} value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} placeholder="Write in Markdown. Link other notes with [[Note title]]." aria-label="Note" />
              <div className="row">
                <button className="primary" type="button" disabled={busy || !(note.title.trim() || note.text.trim())} onClick={() => void run("Saving note", async () => { const r = await engineCall<{ id: number; title: string }>("brain.saveNote", note); if (r) setNote((n) => ({ ...n, id: r.id })); return r; })}>
                  Save note
                </button>
                <button className="btn" type="button" onClick={() => setNote({ id: null, title: "", text: "" })}>
                  New note
                </button>
              </div>
            </div>
            <ul className="doclist">
              {notes.length === 0 && <li className="muted">No notes yet.</li>}
              {notes.map((d) => (
                <li key={d.id}>
                  <button type="button" className="thread" onClick={async () => { const full = await engineCall<{ id: number; title: string; text: string }>("brain.document", { id: d.id }); if (full) setNote({ id: full.id, title: full.title, text: full.text }); }}>
                    {d.title}
                    <span className="muted">{d.updatedAt.slice(0, 10)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "library" && (
          <ul className="doclist">
            {docs.length === 0 && <li className="muted">Nothing added yet.</li>}
            {docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="thread" onClick={() => setSelected(`d:${d.id}`)}>
                  {d.title}
                  <span className="muted">{KIND[d.kind] ?? d.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
