import { useEffect, useState } from "react";
import { Check, Flag, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { engineCall, onEngineEvent } from "../bridge";
import { toast } from "../ui/toast";
import { Empty } from "../ui/states";

type Milestone = { key: string; title: string; status: string; due: string | null };
type Goal = { id: string; title: string; why: string; target: string; status: "active" | "done" | "dropped"; updates: { ts: string; text: string }[]; milestones: Milestone[]; progress: { done: number; total: number } };

/** Goals: the Chief of Staff turns each into milestones, tracks progress, and checks in every Monday. */
export function Goals() {
  const [list, setList] = useState<Goal[]>([]);
  const [form, setForm] = useState({ title: "", why: "", target: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => void engineCall<Goal[]>("goals.list").then((l) => setList(l ?? [])).catch(() => {});
  useEffect(() => {
    load();
    let off: (() => void) | undefined;
    void onEngineEvent((ev) => ev === "goals" && load()).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  const act = async (id: string, label: string, f: () => Promise<unknown>) => {
    setBusy(id);
    try {
      const r = await f();
      if (typeof r === "string") toast(label, r);
    } catch (e) {
      toast(`${label} failed`, String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(null);
    load();
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="page" aria-label="Goals">
      <div className="card new-goal">
        <h3>New goal</h3>
        <div className="goal-form">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Sign 3 design partners" aria-label="Goal" />
          <input value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="Why it matters (optional)" aria-label="Why" />
          <input type="date" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} aria-label="Target date" />
          <button className="primary" type="button" disabled={!form.title.trim()} onClick={() => void act("new", "Goal added", async () => { await engineCall("goals.create", form); setForm({ title: "", why: "", target: "" }); return "Press Plan it to have the Chief of Staff break it into milestones."; })}>
            Add goal
          </button>
        </div>
      </div>
      {list.length === 0 && <Empty icon={Flag} title="No goals yet" hint="Add one above. The Chief of Staff breaks it into milestones, tracks them as issues, and checks progress every Monday." />}
      <div className="goals">
        {list.map((g) => {
          const pct = g.progress.total ? Math.round((g.progress.done / g.progress.total) * 100) : 0;
          return (
            <article key={g.id} className={`card goal ${g.status}`}>
              <header>
                <div>
                  <h3>{g.title}</h3>
                  <p className="muted">{[g.why, g.target && `target ${g.target}`, g.status !== "active" && g.status].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="goal-pct num">{pct}%</span>
              </header>
              <span className="meter" aria-label={`${g.progress.done} of ${g.progress.total} milestones done`}><i style={{ width: `${pct}%` }} /></span>
              {g.milestones.length > 0 && (
                <ul className="milestones">
                  {g.milestones.map((m) => (
                    <li key={m.key} className={m.status === "done" ? "done" : m.due && m.due < today ? "late" : ""}>
                      <label className="check">
                        <input type="checkbox" checked={m.status === "done"} onChange={(e) => void act(g.id, "Milestone", () => engineCall("issues.setStatus", { key: m.key, status: e.target.checked ? "done" : "todo" }))} />
                        <span>{m.title}</span>
                      </label>
                      <span className="muted mono">{m.key}{m.due ? ` · ${m.due}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
              {g.updates.length > 0 && <p className="goal-note"><b>{g.updates.at(-1)!.ts.slice(0, 10)}</b> {g.updates.at(-1)!.text}</p>}
              <div className="row">
                {g.milestones.length === 0 && <button className="primary" type="button" disabled={busy === g.id} onClick={() => void act(g.id, "Planned", () => engineCall("goals.plan", { id: g.id }))}><Sparkles size={14} aria-hidden="true" /> {busy === g.id ? "Planning…" : "Plan it"}</button>}
                {g.milestones.length > 0 && <button className="btn" type="button" disabled={busy === g.id} onClick={() => void act(g.id, "Progress check", () => engineCall("goals.check", { id: g.id }))}><RefreshCw size={14} aria-hidden="true" /> Check progress</button>}
                {g.milestones.length > 0 && <button className="btn" type="button" disabled={busy === g.id} onClick={() => void act(g.id, "Planned", () => engineCall("goals.plan", { id: g.id }))}><ListChecks size={14} aria-hidden="true" /> Add milestones</button>}
                {g.status === "active" ? (
                  <>
                    <button className="btn" type="button" onClick={() => void act(g.id, "Goal", () => engineCall("goals.update", { id: g.id, patch: { status: "done" } }))}><Check size={14} aria-hidden="true" /> Done</button>
                    <button className="btn" type="button" onClick={() => confirm(`Drop "${g.title}"?`) && void act(g.id, "Goal", () => engineCall("goals.update", { id: g.id, patch: { status: "dropped" } }))}>Drop</button>
                  </>
                ) : (
                  <button className="btn" type="button" onClick={() => void act(g.id, "Goal", () => engineCall("goals.update", { id: g.id, patch: { status: "active" } }))}>Reopen</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
