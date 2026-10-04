import { useState } from "react";
import { Trophy } from "lucide-react";
import { engineCall } from "../bridge";
import { toast } from "../ui/toast";
import { Empty } from "../ui/states";
import { useCrew } from "../ui/crew";

type R = { agent: string; results: { model: string; provider: string; score: number; tokens: number }[]; summary: string; proposalId?: string };

/** Model arena: which model does this agent's real work best, for the fewest tokens. */
export function ArenaCard() {
  const AGENTS = useCrew().filter(([id]) => id !== "chief-of-staff").concat([["chief-of-staff", "Chief of Staff"]]);
  const [agent, setAgent] = useState("gtm");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<R | null>(null);
  const run = async () => {
    setBusy(true);
    setR(null);
    try {
      setR(await engineCall<R>("arena.run", { agent }));
    } catch (e) {
      toast("Arena could not run", String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(false);
  };
  const apply = async () => {
    if (!r?.proposalId) return;
    await engineCall("settings.apply", { id: r.proposalId });
    toast("Model updated", r.summary);
    setR({ ...r, proposalId: undefined as never });
  };
  const max = Math.max(1, ...(r?.results.map((x) => x.tokens) ?? [1]));
  return (
    <article className="card tool">
      <header>
        <h3>Model arena</h3>
      </header>
      <p className="muted">Replays an agent's recent tasks as practice with each of your models (nothing is changed or sent), scores them with the same checker, and suggests the best one for that agent. Ties go to the model that used fewer tokens. Uses tokens.</p>
      <div className="row">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">
          {AGENTS.map(([id, n]) => (
            <option key={id} value={id}>{n}</option>
          ))}
        </select>
        <button className="primary" type="button" disabled={busy} onClick={run}>{busy ? "Running practice…" : "Run arena"}</button>
      </div>
      {r && r.results.length === 0 && <Empty icon={Trophy} title="No results" />}
      {r && r.results.length > 0 && (
        <>
          <table className="table">
            <thead><tr><th>Model</th><th>Score</th><th>Tokens</th></tr></thead>
            <tbody>
              {r.results.map((x) => (
                <tr key={x.provider + x.model}>
                  <td className="mono">{x.model}</td>
                  <td>{x.score.toFixed(2)}</td>
                  <td>
                    <span className="bar-track inline"><span className="bar-fill" style={{ width: `${(x.tokens / max) * 100}%` }} /></span> {x.tokens.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{r.summary}</p>
          {r.proposalId && <button className="primary" type="button" onClick={apply}>Use it for this agent</button>}
        </>
      )}
    </article>
  );
}
