import { useEffect, useState } from "react";
import { ArrowDown, Plus, Play, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { engineCall, onEngineEvent } from "../bridge";
import { toast } from "../ui/toast";
import { Empty } from "../ui/states";

type Step = { agent: string; instruction: string };
type W = { id: string; name: string; steps: Step[]; lastRun?: string; lastResult?: string };
const WHO: [string, string][] = [["research", "Research"], ["gtm", "GTM"], ["ops", "Operations"], ["code", "Engineering"], ["chief-of-staff", "Chief of Staff"]];
const name = (id: string) => WHO.find(([w]) => w === id)?.[1] ?? id;

/** Multi-step workflows: each step's result is handed to the next. */
export function WorkflowsPanel() {
  const [list, setList] = useState<W[]>([]);
  const [templates, setTemplates] = useState<{ name: string; steps: Step[] }[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; steps: Step[] } | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<{ id: string; step: number; total: number } | null>(null);
  const load = () => void engineCall<{ workflows: W[]; templates: typeof templates }>("workflows.list").then((r) => (setList(r?.workflows ?? []), setTemplates(r?.templates ?? []))).catch(() => {});
  useEffect(() => {
    load();
    let off: (() => void) | undefined;
    void onEngineEvent((ev, data) => {
      if (ev === "workflows") load();
      if (ev === "workflow") setRunning(data as { id: string; step: number; total: number });
    }).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  const save = async () => {
    if (!edit) return;
    try {
      await engineCall("workflows.save", edit);
      toast("Workflow saved");
      setEdit(null);
      load();
    } catch (e) {
      toast("Could not save", String(e).replace(/^Error: /, ""), "error");
    }
  };
  const run = async (w: W) => {
    setRunning({ id: w.id, step: 0, total: w.steps.length });
    try {
      await engineCall("workflows.run", { id: w.id, input: input[w.id] ?? "" });
      toast(`Workflow finished: ${w.name}`);
    } catch (e) {
      toast("Workflow failed", String(e).replace(/^Error: /, ""), "error");
    }
    setRunning(null);
    load();
  };

  if (edit)
    return (
      <section className="card wf-edit">
        <h3>{edit.id ? "Edit workflow" : "New workflow"}</h3>
        <label className="field">
          Name
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        </label>
        <ol className="wf-steps">
          {edit.steps.map((s, i) => (
            <li key={i}>
              <div className="row">
                <span className="wf-n num">{i + 1}</span>
                <select value={s.agent} aria-label={`Step ${i + 1} agent`} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, agent: e.target.value } : x)) })}>
                  {WHO.map(([id, n]) => (
                    <option key={id} value={id}>{n}</option>
                  ))}
                </select>
                <button className="icon-btn" type="button" aria-label={`Remove step ${i + 1}`} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}>
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea rows={2} value={s.instruction} aria-label={`Step ${i + 1} instruction`} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, instruction: e.target.value } : x)) })} placeholder="What to do. Use {input} for what you type when you run it." />
              {i < edit.steps.length - 1 && <ArrowDown size={14} className="wf-arrow" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <div className="row">
          <button className="btn" type="button" disabled={edit.steps.length >= 6} onClick={() => setEdit({ ...edit, steps: [...edit.steps, { agent: "gtm", instruction: "" }] })}><Plus size={14} aria-hidden="true" /> Add step</button>
          <button className="primary" type="button" onClick={save}>Save workflow</button>
          <button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button>
        </div>
      </section>
    );

  return (
    <div className="stack">
      <div className="row">
        <button className="primary" type="button" onClick={() => setEdit({ name: "", steps: [{ agent: "research", instruction: "" }, { agent: "gtm", instruction: "" }] })}><Plus size={14} aria-hidden="true" /> New workflow</button>
        {templates.map((t) => (
          <button key={t.name} className="btn" type="button" onClick={() => setEdit({ name: t.name, steps: t.steps })}>From template: {t.name}</button>
        ))}
      </div>
      {list.length === 0 && <Empty icon={WorkflowIcon} title="No workflows yet" hint="Chain crew members: research a company, then draft outreach, then sum it up. Start from a template above." />}
      {list.map((w) => (
        <article key={w.id} className="card wf">
          <header className="auto-head">
            <b>{w.name}</b>
            <span className="muted">{w.steps.map((s) => name(s.agent)).join(" → ")}</span>
          </header>
          <div className="row">
            {w.steps.some((s) => s.instruction.includes("{input}")) && <input value={input[w.id] ?? ""} onChange={(e) => setInput({ ...input, [w.id]: e.target.value })} placeholder="Input, like a company name" aria-label="Input" />}
            <button className="primary" type="button" disabled={!!running} onClick={() => run(w)}><Play size={14} aria-hidden="true" /> {running?.id === w.id ? `Step ${Math.min(running.step + 1, running.total)} of ${running.total}…` : "Run"}</button>
            <button className="btn" type="button" onClick={() => setEdit({ id: w.id, name: w.name, steps: w.steps })}>Edit</button>
            <button className="btn" type="button" onClick={() => confirm(`Delete "${w.name}"? Any schedule for it is removed too.`) && void engineCall("workflows.delete", { id: w.id }).then(load)}>Delete</button>
          </div>
          {w.lastRun && (
            <details>
              <summary className="muted">Last run {w.lastRun.slice(0, 16).replace("T", " ")}</summary>
              <p className="result">{w.lastResult}</p>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
