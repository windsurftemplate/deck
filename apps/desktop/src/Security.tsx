import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { Settings } from "@deck/settings";
import { engineCall, saveSettings } from "./bridge";
import { toast } from "./ui/toast";

/** Settings: the CISO. Advice only: it reviews approvals and reports on deck's security; it never decides or blocks. */
export function SecurityCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h3><ShieldCheck size={15} aria-hidden="true" /> CISO</h3>
      <p className="muted">The CISO watches deck's own security: tripwire alerts, scanner flags, refused actions, plugins, imports, Labs features, federation, Google and GitHub access, and setup health. It advises only: it cannot approve, reject, block or change anything. A full review runs every Monday at 09:30 and opens an issue for each high-risk finding.</p>
      <label className="check">
        <input type="checkbox" checked={s.ciso?.reviews !== false} onChange={async (e) => onSaved(await saveSettings({ ciso: { reviews: e.target.checked } }))} />
        Give a security opinion on every approval card (low, medium or high risk) before I decide. Uses the cheap model.
      </label>
      <label className="field">
        Undo window for approved actions that leave your machine
        <select value={s.undo?.seconds ?? 60} onChange={async (e) => onSaved(await saveSettings({ undo: { seconds: Number(e.target.value) } }))}>
          {[0, 15, 30, 60, 120, 300].map((n) => <option key={n} value={n}>{n === 0 ? "Off: run right after approval" : `${n} seconds`}</option>)}
        </select>
      </label>
      <p className="muted">After you approve a send, a draft, a pull request or a plugin call, it waits this long with an Undo button (and /undo in Telegram) before it runs. Stop all agents undoes anything still waiting. The same action with the same details is never run twice.</p>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={async () => setOut((await engineCall<string>("security.status").catch((e) => String(e))) ?? "")}>Show security status</button>
        <button className="primary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await engineCall<string>("security.review"); setOut(r ?? ""); toast("Security review finished", "Details are below and in Crew chat."); } catch (e) { toast("Review failed", String(e).replace(/^Error: /, ""), "error"); } setBusy(false); }}>{busy ? "Reviewing…" : "Run security review now"}</button>
      </div>
      {out && <pre className="security-out">{out}</pre>}
    </div>
  );
}
