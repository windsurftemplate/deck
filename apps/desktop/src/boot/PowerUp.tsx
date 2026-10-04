import { useEffect, useRef, useState } from "react";
import { Reactor3D } from "./Reactor3D";
import { arcPath, coreLit, LABELS, SEGMENTS, statusText, type CheckResult } from "./checks";
import { runChecks } from "../bridge";
import { RestoreKey } from "../Recovery";

export function PowerUp({ onDone, threeD = false }: { onDone: () => void; threeD?: boolean }) {
  const [run, setRun] = useState(0);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [finished, setFinished] = useState(false);
  const [preview, setPreview] = useState(false);
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === run) return;
    started.current = run;
    setResults([]);
    setFinished(false);
    runChecks((r) => setResults((prev) => [...prev.filter((x) => x.id !== r.id), r])).then((out) => {
      setPreview(out.preview);
      setFinished(true);
    });
  }, [run]);

  const byId = new Map(results.map((r) => [r.id, r]));
  const issues = results.filter((r) => r.status === "blocking" || r.status === "degraded");
  const lit = coreLit(results);
  const blocking = results.some((r) => r.status === "blocking");

  return (
    <main className="boot" aria-live="polite">
      {threeD ? <Reactor3D segments={SEGMENTS} status={Object.fromEntries(SEGMENTS.map((id) => [id, byId.get(id)?.status]))} lit={lit} /> : <svg className="ring" viewBox="0 0 360 360" role="img" aria-label="Power core with subsystem ring">
        {SEGMENTS.map((id, i) => (
          <path key={id} className={`seg ${byId.get(id)?.status ?? ""}`} d={arcPath(i, SEGMENTS.length)}>
            <title>{LABELS[id]}</title>
          </path>
        ))}
        <circle cx="180" cy="180" r="70" fill="#0b111c" stroke="#2a3954" strokeWidth="1.5" />
        <circle className="core" cx="180" cy="180" r="56" fill="#bff3ff" opacity={lit ? 0.9 : 0} />
        <text x="180" y="185" textAnchor="middle" fontSize="13" fill={lit ? "#0b2733" : "#8190a6"}>
          {lit ? "Core online" : "Models offline"}
        </text>
      </svg>}
      <section>
        <h1>{finished ? (blocking ? "Power-up stopped" : "Systems charged") : "Powering up"}</h1>
        <p className="sub">{preview ? "Preview mode: checks are simulated outside the app." : "Running diagnostics."}</p>
        <ul className="checks">
          {[...SEGMENTS, "models"].map((id) => {
            const r = byId.get(id);
            return (
              <li key={id} className={r?.status ?? ""}>
                {LABELS[id]}
                <span className="st">{r ? statusText(r.status) : "dark"}</span>
              </li>
            );
          })}
        </ul>
        {issues.map((r) => (
          <div className="issue" key={r.id}>
            <b>{r.name}: {r.status === "blocking" ? "blocking" : "degraded"}</b>
            <p>{r.message}</p>
            {r.fix && <p>Fix: {r.fix}</p>}
          </div>
        ))}
        {results.some((r) => r.id === "memory" && r.status === "blocking" && /key/i.test(r.message)) && <RestoreKey onRestored={() => setRun((n) => n + 1)} />}
        <div className="actions">
          <button className="primary" type="button" disabled={!finished || blocking} onClick={onDone}>
            Continue
          </button>
          {finished && !lit && !blocking && <span className="sub">The core lights when you connect an LLM.</span>}
        </div>
      </section>
    </main>
  );
}
