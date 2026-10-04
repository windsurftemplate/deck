import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { engineCall } from "../bridge";
import { Skeleton, Sparkline } from "../ui/states";

type H = { score: number; checks: { id: string; label: string; ok: boolean; weight: number; fix?: string; go?: string }[]; history: { date: string; score: number }[]; regressed: string[] };

/** Setup health: one score, what is missing, and a fix for each. */
export function HealthCard({ go }: { go: (target: string) => void }) {
  const [h, setH] = useState<H | null>(null);
  useEffect(() => void engineCall<H>("health.get").then((x) => x && Array.isArray(x.checks) && setH(x)).catch(() => {}), []);
  if (!h) return <section className="card health"><Skeleton w={120} h={14} /><Skeleton h={60} r={8} /></section>;
  const tone = h.score >= 80 ? "good" : h.score >= 60 ? "warn" : "bad";
  const failing = h.checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);
  const passing = h.checks.filter((c) => c.ok);
  return (
    <section className={`card health ${tone}`} aria-label="Setup health">
      <div className="health-score">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <b className="num">{h.score}</b>
          <span>/100 setup health</span>
        </div>
        {h.history.length > 1 && <Sparkline values={h.history.map((x) => x.score)} color={tone === "good" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--fail)"} />}
      </div>
      {h.regressed.length > 0 && (
        <p className="health-drop"><TriangleAlert size={14} aria-hidden="true" /> Since last time: {h.regressed.join("; ")}.</p>
      )}
      {failing.length === 0 ? (
        <p className="muted">Everything checks out.</p>
      ) : (
        <ul className="health-list">
          {failing.map((c) => (
            <li key={c.id}>
              <CircleAlert size={14} aria-hidden="true" />
              <div>
                <b>{c.label}</b>
                {c.fix && <p>{c.fix}</p>}
              </div>
              {c.go && <button className="btn" type="button" onClick={() => go(c.go!)}>Fix</button>}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="muted">{passing.length} check{passing.length === 1 ? "" : "s"} passing</summary>
        <ul className="health-list ok">
          {passing.map((c) => (
            <li key={c.id}><CheckCircle2 size={14} aria-hidden="true" /><div><span>{c.label}</span></div></li>
          ))}
        </ul>
      </details>
    </section>
  );
}
