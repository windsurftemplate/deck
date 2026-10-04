import { useEffect, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { engineCall } from "./bridge";
import { toast } from "./ui/toast";

type Custom = { id: string; name: string; role: string; scopes: string[] };
const TOOLS: [string, string, string][] = [
  ["memory.read", "Search memory", "Read facts, past events and the second brain"],
  ["memory.write", "Save facts", "Remember things, through the memory filter"],
  ["issues.read", "Read issues", "See the tracker"],
  ["issues.write", "Change issues", "Create and update issues"],
  ["drafts.write", "Write drafts", "Save drafts for you to review (never sends)"],
  ["web.search", "Web research", "Search the web with sources (counts toward 25 a day)"],
  ["skills.read", "Use skills", "Load approved skills"],
];

/** Settings: crew members you define. Same rules as the built-in crew: they cannot delegate or send anything. */
export function CustomCrewCard({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<Custom[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; role: string; scopes: string[] } | null>(null);
  const load = () => void engineCall<Custom[]>("crew.custom.list").then((l) => setList(l ?? [])).catch(() => {});
  useEffect(load, []);
  const save = async () => {
    if (!edit) return;
    try {
      await engineCall("crew.custom.save", edit);
      toast(edit.id ? "Crew member updated" : "Crew member added", `${edit.name} can now take tasks from the Chief of Staff, automations and workflows.`);
      setEdit(null);
      load();
      onChanged?.();
    } catch (e) {
      toast("Not saved", String(e).replace(/^Error: /, ""), "error");
    }
  };
  return (
    <div className="card">
      <h3><UserPlus size={15} aria-hidden="true" /> Your crew members</h3>
      <p className="muted">Add up to 8 crew members of your own: a name, what they do, and which tools they may use. They follow the same rules as the built-in crew: they cannot hand work to others, cannot send anything, and their work is checked. The Chief of Staff can delegate to them; so can automations and workflows. They appear in Crew chat and the list view (the 3D deck shows the built-in stations only).</p>
      {list.map((c) => (
        <div key={c.id} className="custom-member">
          <div>
            <b>{c.name}</b> <span className="muted mono">{c.id}</span>
            <p className="muted">{c.role.slice(0, 160)}{c.role.length > 160 ? "…" : ""}</p>
            <p className="muted">Tools: {c.scopes.map((x) => TOOLS.find(([s]) => s === x)?.[1] ?? x).join(", ")}</p>
          </div>
          <div className="row">
            <button className="btn" type="button" onClick={() => setEdit({ id: c.id, name: c.name, role: c.role, scopes: c.scopes })}>Edit</button>
            <button className="icon-btn" type="button" aria-label={`Remove ${c.name}`} onClick={async () => { if (confirm(`Remove ${c.name}? Its automations are removed too.`)) { await engineCall("crew.custom.delete", { id: c.id }); load(); onChanged?.(); } }}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      {!edit && list.length < 8 && (
        <button className="btn" type="button" onClick={() => setEdit({ name: "", role: "", scopes: ["memory.read", "drafts.write"] })}><Plus size={14} aria-hidden="true" /> Add a crew member</button>
      )}
      {edit && (
        <div className="custom-form">
          <label className="field">
            Name
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Investor Relations" disabled={!!edit.id} />
          </label>
          <label className="field">
            What they do (their role)
            <textarea rows={5} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} placeholder="Prepares the weekly investor update from closed issues and goal progress. Writes in plain, factual language and never states a number that is not in memory or the tracker." />
          </label>
          <fieldset className="tool-picks">
            <legend>Tools</legend>
            {TOOLS.map(([scope, label, help]) => (
              <label key={scope} className="check">
                <input type="checkbox" checked={edit.scopes.includes(scope)} onChange={(e) => setEdit({ ...edit, scopes: e.target.checked ? [...edit.scopes, scope] : edit.scopes.filter((x) => x !== scope) })} />
                <span><b>{label}</b> <span className="muted">{help}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="row">
            <button className="primary" type="button" onClick={save}>{edit.id ? "Save changes" : "Add crew member"}</button>
            <button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Recent = { id: string; name: string; role: string; scopes: string[]; creator: string; task: string; passed: boolean; at: string };

/** Settings: helper agents the crew creates for a task, and keeping one as a crew member. */
export function HelpersCard({ s, onSaved }: { s: import("@deck/settings").Settings; onSaved: (s: import("@deck/settings").Settings) => void }) {
  const h = s.helpers ?? { enabled: true, max: 10, tokenBudget: 300_000 };
  const [recent, setRecent] = useState<Recent[]>([]);
  const load = () => void engineCall<Recent[]>("helpers.recent").then((r) => setRecent(r ?? [])).catch(() => {});
  useEffect(load, []);
  const save = async (patch: Partial<typeof h>) => {
    const { saveSettings } = await import("./bridge");
    try {
      onSaved(await saveSettings({ helpers: patch }));
    } catch (e) {
      toast("Not saved", String(e).replace(/^Error: /, ""), "error");
    }
  };
  return (
    <div className="card">
      <h3>Helper agents</h3>
      <p className="muted">The Chief of Staff and every crew member can create temporary helpers for parts of a task that can run in parallel. Helpers get only tools their creator has (from a safe list: nothing that leaves your machine), cannot create helpers of their own, share a token budget per task, have their work checked, and disappear after reporting. Everything they do shows in Crew chat. On Cautious, creating helpers asks you first.</p>
      <label className="check">
        <input type="checkbox" checked={h.enabled !== false} onChange={(e) => save({ enabled: e.target.checked })} />
        Allow helper agents
      </label>
      <div className="row">
        <label className="field">
          Most helpers per task
          <select value={h.max} onChange={(e) => save({ max: Number(e.target.value) })} disabled={h.enabled === false}>
            {[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="field">
          Token budget per task
          <select value={h.tokenBudget} onChange={(e) => save({ tokenBudget: Number(e.target.value) })} disabled={h.enabled === false}>
            {[100_000, 300_000, 600_000, 1_000_000].map((n) => <option key={n} value={n}>{n.toLocaleString("en-US")}</option>)}
          </select>
        </label>
      </div>
      <h3>Recent helpers</h3>
      {recent.length === 0 ? (
        <p className="muted">None yet. When an agent creates helpers, the last 30 appear here, and you can keep any as a crew member.</p>
      ) : (
        <ul className="recent-helpers">
          {recent.map((r) => (
            <li key={r.id}>
              <div>
                <b>{r.name}</b> <span className="muted">for {r.creator === "chief-of-staff" ? "Chief of Staff" : r.creator}, {r.at.slice(0, 10)}{r.passed ? ", checked" : ", not finished"}</span>
                <p className="muted">{r.task}</p>
              </div>
              <button className="btn" type="button" onClick={async () => { try { await engineCall("helpers.keep", { id: r.id }); toast("Kept as a crew member", r.name); load(); } catch (e) { toast("Not kept", String(e).replace(/^Error: /, ""), "error"); } }}>Keep as crew member</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
