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
      </div>
      {report && <p className="ok" style={{ whiteSpace: "pre-wrap" }}>{report}</p>}
    </div>
  );
}
