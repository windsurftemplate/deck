import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, FlaskConical, Play, XCircle, Zap } from "lucide-react";
import { engineCall, onEngineEvent, saveSettings } from "../bridge";
import { Sparkline } from "../ui/states";
import { toast } from "../ui/toast";

type Case = { id: string; title: string; passed: boolean; detail: string };
type Suite = { suite: string; title: string; score: number; passed: number; total: number; ms: number; tokens: number; ts: string; cases: Case[]; history: { ts: string; score: number }[] };
type Overview = { running: boolean; suites: Suite[]; settings: { daily: boolean; live: boolean } };

const ABOUT: Record<string, string> = {
  memory: "Recall on a realistic history: right facts found, outdated ones not returned. No model calls.",
  safety: "A model that obeys an injected email: approvals, refusals, secrets, the wrapper, the tripwire, the plan lock, advice-only CISO, learning limits. No model calls.",
  behavior: "A sandboxed copy of deck: checked delegation, escalation, failure lessons, helper limits, safe custom tools, CISO reviews. No model calls.",
  live: "Real tasks on your models (and Jev if on): tool calling, resisting injected instructions, JSON output, checker accuracy, routing. Uses tokens.",
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ago = (ts: string) => {
  const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Command center: every eval suite with its score, trend, last run, and each case with details. */
export function EvalsCard() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"offline" | "live" | null>(null);
  const load = () => void engineCall<Overview>("evals.overview").then((x) => x && setOv(x)).catch(() => {});
  useEffect(() => {
    load();
    let off: (() => void) | undefined;
    void onEngineEvent((ev) => ev === "evals" && load()).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  const run = async (live: boolean) => {
    if (live && !confirm("Run the live evals? They send a few small real tasks to your models (and Jev if on) and use tokens.")) return;
    setBusy(live ? "live" : "offline");
    try {
      const r = await engineCall<{ suites: Suite[]; drops: string[] }>("evals.run", { live });
      if (r) toast(r.drops.length ? "Eval scores dropped" : "Evals finished", r.drops.length ? r.drops.join("\n") : r.suites.map((s) => `${s.title} ${s.passed}/${s.total}`).join(", "), r.drops.length ? "error" : "success");
    } catch (e) {
      toast("Evals could not run", String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(null);
    load();
  };
  const suites = ov?.suites ?? [];
  const offline = suites.filter((s) => s.suite !== "live");
  const allPass = offline.length > 0 && offline.every((s) => s.score === 1);
  return (
    <section className="card span2 evals" aria-label="Evals">
      <div className="evals-head">
        <h3><FlaskConical size={15} aria-hidden="true" /> Evals</h3>
        {offline.length > 0 && <span className={`pill ${allPass ? "on" : "bad"}`}>{allPass ? "All offline suites passing" : "Some cases failing"}</span>}
        <span className="grow" />
        <button className="btn" type="button" disabled={!!busy || ov?.running} onClick={() => run(false)}><Play size={14} aria-hidden="true" /> {busy === "offline" ? "Running…" : "Run evals"}</button>
        <button className="btn" type="button" disabled={!!busy || ov?.running} onClick={() => run(true)} title="Runs real tasks on your models; uses tokens"><Zap size={14} aria-hidden="true" /> {busy === "live" ? "Running live…" : "Run live evals"}</button>
      </div>
      <p className="muted">Offline suites run every night at 03:30 and use no tokens.{" "}
        <label className="check inline-check">
          <input type="checkbox" checked={!!ov?.settings.live} onChange={async (e) => { await saveSettings({ evals: { live: e.target.checked } }); load(); }} />
          Also run the live suite every Sunday (uses tokens)
        </label>
      </p>
      {suites.length === 0 ? (
        <p className="muted">No eval runs yet. Press Run evals: it takes a few seconds and uses no tokens.</p>
      ) : (
        <div className="eval-suites">
          {suites.map((s) => {
            const failing = s.cases.filter((c) => !c.passed);
            const prev = s.history.length > 1 ? s.history[s.history.length - 2]!.score : null;
            return (
              <article key={s.suite} className={`eval-suite ${s.score === 1 ? "pass" : "fail"}`}>
                <button type="button" className="eval-row" aria-expanded={open === s.suite} onClick={() => setOpen(open === s.suite ? null : s.suite)}>
                  {open === s.suite ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                  <span className="eval-title">
                    <b>{s.title}</b>
                    <span className="muted">{ABOUT[s.suite] ?? ""}</span>
                  </span>
                  <span className="eval-score num">{pct(s.score)}</span>
                  <span className="eval-count num">{s.passed}/{s.total}</span>
                  <span className="eval-trend">{s.history.length > 1 ? <Sparkline values={s.history.map((h) => h.score * 100)} color={s.score === 1 ? "var(--ok)" : "var(--fail)"} /> : <span className="muted">first run</span>}</span>
                  <span className="muted eval-when">
                    {ago(s.ts)} · {s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}
                    {s.tokens ? ` · ${s.tokens.toLocaleString("en-US")} tokens` : ""}
                    {prev !== null && prev !== s.score ? ` · ${s.score > prev ? "up" : "down"} from ${pct(prev)}` : ""}
                  </span>
                </button>
                {failing.length > 0 && open !== s.suite && <p className="eval-failing">Failing: {failing.map((c) => c.title).join("; ")}</p>}
                {open === s.suite && (
                  <table className="table eval-cases">
                    <thead><tr><th></th><th>Case</th><th>Result</th></tr></thead>
                    <tbody>
                      {s.cases.map((c) => (
                        <tr key={c.id} className={c.passed ? "" : "fail"}>
                          <td>{c.passed ? <CheckCircle2 size={15} className="ok-ic" aria-label="Passed" /> : <XCircle size={15} className="fail-ic" aria-label="Failed" />}</td>
                          <td><b>{c.title}</b><br /><span className="muted mono">{c.id}</span></td>
                          <td>{c.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
