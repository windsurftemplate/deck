import { useEffect, useState } from "react";
import { engineCall, inTauri } from "./bridge";

type Skill = { name: string; version: number; description: string; status: "draft" | "active" | "retired"; successes: number; failures: number };

/** Settings card: what the crew has learned, and a button to run the nightly pass now. */
export function LearningCard() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => engineCall<Skill[]>("skills.list").then((s) => setSkills(s ?? [])).catch(() => {});
  useEffect(() => void load(), []);
  const run = async () => {
    setBusy(true);
    try {
      setReport((await engineCall<string>("learn.now")) ?? "Preview mode: learning runs inside the desktop app.");
    } catch (e) {
      setReport(String(e));
    }
    setBusy(false);
    void load();
  };
  const label = { draft: "Waiting for your approval", active: "In use", retired: "Retired" };
  return (
    <div className="card">
      <h3>Learning</h3>
      <p className="muted">Every night at 02:00 the crew reads recent work, saves lasting facts (conflicts come to you), reviews what you approved and rejected, and retires skills that keep failing. New skills are proposed after checked work and are used only after you approve them.</p>
      {skills.length ? (
        <ul className="skills">
          {skills.map((k) => (
            <li key={k.name}>
              <b>{k.name}</b> <span className="muted">v{k.version} · {label[k.status]} · worked {k.successes}, failed {k.failures}</span>
              <div className="muted">{k.description}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{inTauri ? "No skills yet." : "Skills show here inside the desktop app."}</p>
      )}
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={run}>
          {busy ? "Learning" : "Run learning now"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const out: string[] = [];
            for (const a of ["gtm", "ops", "code", "research"]) out.push((await engineCall<string>("learn.tune", { agent: a }).catch((e) => String(e))) ?? "Tuning runs inside the desktop app.");
            setReport(out.join("\n"));
            setBusy(false);
          }}
        >
          Tune prompts now
        </button>
      </div>
      <p className="muted">Learning also turns the files and notes you add into facts. Tuning tests new playbook lessons (from real work and from each agent's misses) on practice tasks (nothing is changed or sent), and asks you before adding them. Existing lessons are never rewritten. It runs on its own every Sunday night.</p>
      {report && <p className="ok" style={{ whiteSpace: "pre-wrap" }}>{report}</p>}
      <h3>Skills (open SKILL.md format)</h3>
      <p className="muted">Skills use the open Agent Skills format, so you can bring in skills written for other agents and share deck's. Imported skills are scanned and wait for your approval; only their instructions are used, never scripts.</p>
      <div className="row">
        <label className="btn file-btn">
          Import SKILL.md files
          <input
            type="file"
            accept=".md"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (!files.length) return;
              const r = await engineCall<{ added: string[]; errors: string[] }>("skills.import", { files: await Promise.all(files.map(async (f) => ({ name: f.webkitRelativePath || f.name, content: await f.text() }))) }).catch((err) => ({ added: [], errors: [String(err)] }));
              setReport([r?.added.length ? `Waiting for your approval: ${r.added.join(", ")}` : "", ...(r?.errors ?? [])].filter(Boolean).join("\n") || "Nothing imported.");
            }}
          />
        </label>
        <button className="btn" type="button" onClick={async () => { const r = await engineCall<{ path: string; count: number }>("skills.export").catch(() => null); setReport(r ? `Exported ${r.count} skill${r.count === 1 ? "" : "s"} to ${r.path}` : "Export works inside the desktop app."); }}>
          Export skills
        </button>
      </div>
    </div>
  );
}
