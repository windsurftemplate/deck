import { useEffect, useState } from "react";
import { engineCall, onEngineEvent } from "../bridge";

type Auto = { id: string; name: string; agent: string; instruction: string; at: string; days: number[]; enabled: boolean; schedule: string; lastRun?: string; lastResult?: string };
const WHO: [string, string][] = [["chief-of-staff", "Chief of Staff"], ["gtm", "GTM"], ["ops", "Operations"], ["code", "Engineering"], ["research", "Research"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const blank = { name: "", agent: "chief-of-staff", instruction: "", at: "09:00", days: [1] as number[] };

/** Recurring jobs: who does what, and when. */
export function Automations() {
  const [list, setList] = useState<Auto[]>([]);
  const [form, setForm] = useState<typeof blank & { id?: string }>(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const load = () => void engineCall<Auto[]>("automations.list").then((l) => setList(l ?? [])).catch(() => {});
  useEffect(() => {
    load();
    let off: (() => void) | undefined;
    void onEngineEvent((event) => (event === "automations" || event === "automation") && load()).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);

  const save = async () => {
    setMsg(null);
    try {
      const { id, ...a } = form;
      if (id) await engineCall("automations.update", { id, patch: a });
      else await engineCall("automations.create", a);
      setMsg({ ok: true, text: id ? "Saved." : "Scheduled." });
      setForm(blank);
      load();
    } catch (e) {
      setMsg({ ok: false, text: String(e).replace(/^Error: /, "") });
    }
  };
  const run = async (a: Auto) => {
    setRunning(a.id);
    await engineCall("automations.run", { id: a.id }).catch(() => {});
    setRunning(null);
    load();
  };

  return (
    <section className="page" aria-label="Automations">
      <div className="page-head">
        <h2>Automations</h2>
      </div>
      <p className="muted">Jobs the crew does on a schedule while the app is open. You can also ask in chat: "every Monday at 9, have GTM review the pipeline." Results land in chat, Crew chat, a notification and Telegram if it is on.</p>
      <div className="panels">
        <section className="card">
          <h3>{form.id ? "Edit job" : "New job"}</h3>
          <div className="stack">
            <label className="field">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Weekly pipeline review" />
            </label>
            <label className="field">
              Who does it
              <select value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
                {WHO.map(([id, n]) => (
                  <option key={id} value={id}>{n}</option>
                ))}
              </select>
            </label>
            <label className="field">
              What to do
              <textarea rows={4} value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="Review open deals, flag anything with no reply in 7 days, and draft follow-ups." />
            </label>
            <label className="field">
              Time
              <input type="time" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
            </label>
            <fieldset className="days">
              <legend className="muted">Days (none means every day)</legend>
              {DAYS.map((d, i) => (
                <label key={d} className="check">
                  <input type="checkbox" checked={form.days.includes(i)} onChange={(e) => setForm({ ...form, days: e.target.checked ? [...form.days, i].sort() : form.days.filter((x) => x !== i) })} />
                  {d}
                </label>
              ))}
            </fieldset>
            <div className="row">
              <button className="primary" type="button" onClick={save} disabled={!form.name.trim() || !form.instruction.trim()}>
                {form.id ? "Save job" : "Schedule job"}
              </button>
              {form.id && <button className="btn" type="button" onClick={() => setForm(blank)}>Cancel</button>}
            </div>
            {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
          </div>
        </section>
        <section className="card">
          <h3>Scheduled</h3>
          {list.length === 0 && <p className="muted">Nothing scheduled yet.</p>}
          <ul className="autos">
            {list.map((a) => (
              <li key={a.id} className={a.enabled ? "" : "off"}>
                <div className="auto-head">
                  <b>{a.name}</b>
                  <span className="muted">{WHO.find(([id]) => id === a.agent)?.[1]}, {a.schedule}</span>
                </div>
                <p>{a.instruction}</p>
                {a.lastRun && (
                  <details>
                    <summary className="muted">Last run {a.lastRun.slice(0, 16).replace("T", " ")}</summary>
                    <p className="result">{a.lastResult}</p>
                  </details>
                )}
                <div className="row">
                  <button className="btn" type="button" disabled={running === a.id} onClick={() => run(a)}>{running === a.id ? "Running…" : "Run now"}</button>
                  <button className="btn" type="button" onClick={() => setForm({ id: a.id, name: a.name, agent: a.agent, instruction: a.instruction, at: a.at, days: a.days })}>Edit</button>
                  <button className="btn" type="button" onClick={() => void engineCall("automations.update", { id: a.id, patch: { enabled: !a.enabled } }).then(load)}>{a.enabled ? "Pause" : "Resume"}</button>
                  <button className="btn" type="button" onClick={() => confirm(`Delete "${a.name}"?`) && void engineCall("automations.delete", { id: a.id }).then(load)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
