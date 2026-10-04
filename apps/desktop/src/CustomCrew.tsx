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
