import { useEffect, useState } from "react";
import { engineCall, inTauri } from "./bridge";

type Mode = "allowed" | "ask" | "off";
type Member = { id: string; name: string; defaultInstructions: string; instructions: string | null; rules: string[]; learned: string | null; tools: { scope: string; label: string; mode: Mode }[]; locked: string[] };
type Change = { ts: string; agent: string; summary: string; source: string };

/** Settings > Crew: each agent's instructions, your rules, and tool permissions. Locked safety rules are shown, not editable. */
export function CrewCard() {
  const [crew, setCrew] = useState<Member[]>([]);
  const [sel, setSel] = useState("chief-of-staff");
  const [draft, setDraft] = useState<{ instructions: string; custom: boolean; rules: string[]; tools: Record<string, Mode> } | null>(null);
  const [newRule, setNewRule] = useState("");
  const [history, setHistory] = useState<Change[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [c, h] = await Promise.all([engineCall<Member[]>("crew.info").catch(() => null), engineCall<Change[]>("crew.history").catch(() => null)]);
    setCrew(c ?? []);
    setHistory(h ?? []);
  };
  useEffect(() => void load(), []);
  const m = crew.find((x) => x.id === sel);
  useEffect(() => {
    if (m) setDraft({ instructions: m.instructions ?? m.defaultInstructions, custom: m.instructions !== null, rules: m.rules, tools: Object.fromEntries(m.tools.map((t) => [t.scope, t.mode])) });
  }, [sel, crew]);

  if (!inTauri) {
    return (
      <div className="card">
        <h3>Crew</h3>
        <p className="muted">Edit each agent's instructions, add your own rules, and set every tool to Allowed, Ask me, or Off. Available inside the desktop app.</p>
      </div>
    );
  }
  if (!m || !draft) return null;

  const save = async () => {
    setMsg(null);
    // Only send what differs from "allowed"; built-in ask-first tools stay ask-first regardless.
    const tools = Object.fromEntries(Object.entries(draft.tools).filter(([, mode]) => mode !== "allowed"));
    try {
      const summary = await engineCall<string>("crew.update", { agent: sel, override: { ...(draft.custom ? { instructions: draft.instructions } : {}), rules: draft.rules, tools } });
      setMsg({ ok: true, text: `Saved. ${summary ?? ""}` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };
  const undo = async () => {
    setMsg({ ok: true, text: (await engineCall<string>("crew.undo").catch((e) => String(e))) ?? "" });
    await load();
  };

  return (
    <div className="card">
      <h3>Crew</h3>
      <p className="muted">What each agent may do. Your changes can make an agent more careful, never less: tools can be limited but not added, and the locked rules always apply. Changes take effect on the agent's next task.</p>
      <div className="row" role="tablist" aria-label="Agents">
        {crew.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === sel} className={c.id === sel ? "primary" : "btn"} type="button" onClick={() => (setSel(c.id), setMsg(null))}>
            {c.name}
          </button>
        ))}
      </div>

      <label className="field">
        Instructions {draft.custom ? "(your version)" : "(default)"}
        <textarea rows={10} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value, custom: true })} spellCheck />
      </label>
      {draft.custom && (
        <div className="row">
          <button className="btn" type="button" onClick={() => setDraft({ ...draft, instructions: m.defaultInstructions, custom: false })}>
            Reset to default
          </button>
        </div>
      )}

      <div className="field">
        Your rules for {m.name}
        {draft.rules.length ? (
          <ul className="rules">
            {draft.rules.map((r, i) => (
              <li key={i}>
                {r}
                <button className="btn" type="button" aria-label={`Remove rule: ${r}`} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">None yet.</span>
        )}
        <div className="row">
          <input className="keyinput" value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="For example: Never mention pricing in first emails" aria-label="New rule" />
          <button className="btn" type="button" disabled={!newRule.trim()} onClick={() => (setDraft({ ...draft, rules: [...draft.rules, newRule.trim()] }), setNewRule(""))}>
            Add rule
          </button>
        </div>
      </div>

      <div className="field">
        Tools
        <table className="tools">
          <tbody>
            {m.tools.map((t) => (
              <tr key={t.scope}>
                <td>{t.label}</td>
                <td>
                  <select aria-label={`${t.label} permission`} value={draft.tools[t.scope]} onChange={(e) => setDraft({ ...draft, tools: { ...draft.tools, [t.scope]: e.target.value as Mode } })}>
                    <option value="allowed">Allowed</option>
                    <option value="ask">Ask me first</option>
                    <option value="off">Off</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {m.learned && (
        <div className="field">
          Learned guidance (tested on practice tasks, approved by you)
          <pre className="learned">{m.learned}</pre>
          <button className="btn" type="button" onClick={async () => { await engineCall("crew.update", { agent: m.id, override: { instructions: m.instructions ?? undefined, rules: m.rules, tools: Object.fromEntries(m.tools.map((t) => [t.scope, t.mode])), learned: "" } }).catch(() => {}); void load(); }}>
            Remove learned guidance
          </button>
        </div>
      )}

      <div className="field">
        Always on (cannot be changed)
        <ul className="locked">
          {m.locked.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="row">
        <button className="primary" type="button" onClick={save}>
          Save {m.name}
        </button>
        <button className="btn" type="button" disabled={!history.length} onClick={undo}>
          Undo last change
        </button>
      </div>
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
      {history.length > 0 && (
        <div className="field">
          Recent changes
          <ul className="history">
            {history.slice(0, 5).map((h, i) => (
              <li key={i}>
                <span className="muted">{h.ts.slice(0, 16).replace("T", " ")} · {h.source === "chat" ? "from chat" : "in Settings"}</span> {h.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
