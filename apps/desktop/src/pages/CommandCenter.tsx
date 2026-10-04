import { useEffect, useState } from "react";
import { engineCall } from "../bridge";
import { Bars, LineChart, fmt } from "./charts";
import { Skeleton, Sparkline } from "../ui/states";
import { HealthCard } from "./Health";
import { EvalsCard } from "./Evals";

type A = {
  dates: string[];
  tokens: number[];
  cost: (number | null)[];
  byModel: { k: string; tokens: number; cost: number | null; calls: number }[];
  byAgent: { k: string; tokens: number; cost: number | null; calls: number }[];
  crew: { agent: string; done: number; failed: number; checked: number }[];
  tasksDone: number[];
  tasksFailed: number[];
  approvals: { approved: number; rejected: number };
  facts: number[];
  docs: number[];
  issuesOpened: number[];
  issuesClosed: number[];
  issuesOpen: number;
  today: { tokens: number; cap: number; waiting: number };
};
const NAME: Record<string, string> = { "chief-of-staff": "Chief of Staff", gtm: "GTM", ops: "Operations", code: "Engineering", research: "Research", verifier: "Verifier", reflection: "Learning", nightly: "Nightly learning" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Analytics: spend, crew performance, the brain's growth and work throughput. */
export function CommandCenter({ go = () => {} }: { go?: (target: string) => void }) {
  const [days, setDays] = useState(30);
  const [a, setA] = useState<A | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => engineCall<A>("analytics.get", { days }).then((x) => (setA(x), setErr(x ? null : "The command center works inside the desktop app."))).catch((e) => setErr(String(e)));
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [days]);
  if (!a)
    return (
      <section className="page" aria-busy={!err}>
        {err ? <p className="muted">{err}</p> : (
          <>
            <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton w={70} h={26} /><Skeleton w="80%" h={12} /><Skeleton h={28} /></div>)}</div>
            <div className="panels">
<div className="card span2"><Skeleton w={140} h={14} /><div style={{ height: 12 }} /><Skeleton h={180} r={8} /></div></div>
          </>
        )}
      </section>
    );
  // Trend: the latest half of the period against the half before it.
  const half = (xs: number[]) => {
    const h = Math.floor(xs.length / 2);
    const prev = sum(xs.slice(0, h)), cur = sum(xs.slice(h));
    return prev ? Math.round(((cur - prev) / prev) * 100) : null;
  };
  const Delta = ({ v, good = "up" }: { v: number | null; good?: "up" | "down" }) =>
    v === null || v === 0 ? null : <span className={`delta ${(v > 0) === (good === "up") ? "up" : "down"}`}>{v > 0 ? "+" : ""}{v}% vs earlier</span>;
  const done = sum(a.crew.map((c) => c.done)), failed = sum(a.crew.map((c) => c.failed)), checked = sum(a.crew.map((c) => c.checked));
  const spend = a.cost.reduce<number>((x, y) => x + (y ?? 0), 0);
  const decided = a.approvals.approved + a.approvals.rejected;
  return (
    <section className="page" aria-label="Command center">
      <div className="page-head">
        <p className="muted">Spend, crew performance, the second brain and work, over time.</p>
        <div className="seg" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
      </div>
      <HealthCard go={go} />
      <div className="kpis">
        <div className="kpi"><b>{fmt(a.today.tokens)}</b><span>tokens today of {fmt(a.today.cap)}</span><span className="meter"><i style={{ width: `${Math.min(100, (a.today.tokens / Math.max(1, a.today.cap)) * 100)}%` }} /></span><Sparkline values={a.tokens.slice(-14)} /></div>
        <div className="kpi"><b>{done}</b><span>tasks finished, {failed} not finished</span><Delta v={half(a.tasksDone)} /><Sparkline values={a.tasksDone.slice(-14)} color="var(--ok)" /></div>
        <div className="kpi"><b>{done + failed ? Math.round((checked / (done + failed)) * 100) : 0}%</b><span>of tasks independently checked</span></div>
        <div className="kpi"><b>{a.today.waiting}</b><span>waiting for you; {decided ? Math.round((a.approvals.approved / decided) * 100) : 0}% of {decided} approved</span></div>
      </div>
      <div className="panels">
        <EvalsCard />
        <section className="card span2">
          <h3>Tokens per day{spend > 0 ? ` · $${spend.toFixed(2)} in this period` : ""}</h3>
          <LineChart label="Tokens per day" dates={a.dates} series={[{ name: "Tokens", color: "#6fd6ff", values: a.tokens }]} />
        </section>
        <section className="card">
          <h3>By model</h3>
          <Bars items={a.byModel.map((m) => ({ label: m.k, value: m.tokens, note: `${m.calls} calls` }))} />
        </section>
        <section className="card">
          <h3>By agent</h3>
          <Bars items={a.byAgent.map((m) => ({ label: NAME[m.k] ?? m.k, value: m.tokens, color: "#c59bff", note: `${m.calls} calls` }))} />
        </section>
        <section className="card span2">
          <h3>Crew work per day</h3>
          <LineChart label="Tasks per day" dates={a.dates} series={[{ name: "Finished", color: "#7cf5b0", values: a.tasksDone }, { name: "Not finished", color: "#ff8a80", values: a.tasksFailed }]} />
        </section>
        <section className="card span2">
          <h3>Crew performance</h3>
          {a.crew.length === 0 ? <p className="muted">No finished tasks in this period.</p> : (
            <table className="table">
              <thead><tr><th>Agent</th><th>Finished</th><th>Not finished</th><th>Checked</th><th>Success</th></tr></thead>
              <tbody>
                {a.crew.map((c) => (
                  <tr key={c.agent}><td>{NAME[c.agent] ?? c.agent}</td><td>{c.done}</td><td>{c.failed}</td><td>{c.checked}</td><td>{c.done + c.failed ? Math.round((c.done / (c.done + c.failed)) * 100) : 0}%</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card span2">
          <h3>Second brain: {a.facts.at(-1) ?? 0} facts, {a.docs.at(-1) ?? 0} documents</h3>
          <LineChart label="Brain growth" dates={a.dates} series={[{ name: "Facts", color: "#c59bff", values: a.facts }, { name: "Documents", color: "#ffd27a", values: a.docs }]} />
        </section>
        <section className="card span2">
          <h3>Issues: {a.issuesOpen} open; {sum(a.issuesOpened)} opened and {sum(a.issuesClosed)} closed in this period</h3>
          <LineChart label="Issues per day" dates={a.dates} series={[{ name: "Opened", color: "#ff9a3d", values: a.issuesOpened }, { name: "Closed", color: "#7cf5b0", values: a.issuesClosed }]} />
        </section>
      </div>
    </section>
  );
}
