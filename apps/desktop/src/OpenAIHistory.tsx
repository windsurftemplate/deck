import { useState } from "react";
import { History } from "lucide-react";
import { engineCall } from "./bridge";
import { toast } from "./ui/toast";

type Scan = { kind: "chatgpt" | "codex"; from: string; conversations: number; messages: number; skipped: number; truncated: number; first: string | null; last: string | null; projects: { path: string; conversations: number }[]; titles: string[] };
const err = (e: unknown) => String(e).replace(/^Error: /, "");
const day = (d: string | null) => (d ? d.slice(0, 10) : "?");

/** One source: a path, Scan to preview, then Import with an optional start date and project choice. */
function Source({ kind, label, placeholder, help }: { kind: "chatgpt" | "codex"; label: string; placeholder: string; help: string }) {
  const [path, setPath] = useState(kind === "codex" ? "~/.codex" : "");
  const [scan, setScan] = useState<Scan | null>(null);
  const [since, setSince] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const doScan = async () => {
    setBusy(true);
    try {
      const r = await engineCall<Scan>("openai.scan", { kind, path });
      setScan(r);
      setProjects((r?.projects ?? []).map((p) => p.path));
    } catch (e) {
      toast("Nothing to import", err(e), "error");
    }
    setBusy(false);
  };
  const doImport = async () => {
    setBusy(true);
    try {
      const r = await engineCall<{ added: number; skipped: number; errors: string[]; considered: number }>("openai.import", { kind, path, ...(since ? { since } : {}), ...(kind === "codex" && scan && projects.length < scan.projects.length ? { projects } : {}) });
      toast(`${label} imported`, `${r?.added ?? 0} added, ${r?.skipped ?? 0} already there${r?.errors.length ? `, ${r.errors.length} failed` : ""}. Facts are learned from them tonight.`);
      setScan(null);
    } catch (e) {
      toast("Import failed", err(e), "error");
    }
    setBusy(false);
  };
  return (
    <div className="stack">
      <p><b>{label}</b></p>
      <p className="muted">{help}</p>
      <div className="row">
        <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} placeholder={placeholder} aria-label={`${label} location`} />
        <button className="btn" type="button" disabled={busy || !path.trim()} onClick={doScan}>{busy && !scan ? "Reading…" : "Scan"}</button>
      </div>
      {scan && (
        <div className="oc-scan">
          <p className="muted">
            {scan.conversations} conversation{scan.conversations === 1 ? "" : "s"} ({scan.messages} messages) from {day(scan.first)} to {day(scan.last)}, read from {scan.from}.
            {scan.skipped ? ` ${scan.skipped} sub-agent and review threads left out.` : ""}
            {scan.truncated ? ` ${scan.truncated} very long ones will be cut.` : ""}
          </p>
          {scan.titles.length > 0 && <p className="muted">Latest: {scan.titles.slice(0, 5).join("; ")}</p>}
          {kind === "codex" && scan.projects.length > 1 && (
            <ul className="hub-list">
              {scan.projects.map((p) => (
                <li key={p.path}>
                  <label className="check"><input type="checkbox" checked={projects.includes(p.path)} onChange={(e) => setProjects(e.target.checked ? [...projects, p.path] : projects.filter((x) => x !== p.path))} /> {p.path} ({p.conversations})</label>
                </li>
              ))}
            </ul>
          )}
          <label className="field">
            Only conversations active since (optional)
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
          <button className="primary" type="button" disabled={busy || (kind === "codex" && scan.projects.length > 1 && !projects.length)} onClick={doImport}>{busy ? "Importing…" : "Import"}</button>
        </div>
      )}
    </div>
  );
}

/** Settings: bring ChatGPT conversations and Codex sessions into the second brain. */
export function OpenAIHistoryCard() {
  return (
    <div className="card">
      <h3><History size={15} aria-hidden="true" /> Import OpenAI history</h3>
      <p className="muted">Your ChatGPT conversations and Codex sessions become notes in your second brain, one per conversation, so the crew can recall past decisions and fixes. Each note is scanned, keys and tokens are removed, and it is treated as outside content. Codex command output, file diffs and reasoning are left out, and its sign-in file is never opened. Nothing leaves this computer, except that with OpenAI memory search the notes are embedded by OpenAI.</p>
      <Source kind="chatgpt" label="ChatGPT" placeholder="~/Downloads/chatgpt-export.zip" help="In ChatGPT: Settings > Data controls > Export data. Point to the .zip you get by email (or the conversations.json inside it)." />
      <Source kind="codex" label="Codex" placeholder="~/.codex" help="Sessions from the Codex app and the Codex CLI on this computer." />
    </div>
  );
}
