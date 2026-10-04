import { useEffect, useState } from "react";
import { SettingsError, type Settings } from "@deck/settings";
import { engineCall, saveSettings } from "./bridge";
import { toast } from "./ui/toast";

/** How agents think: observe the situation, plan, reason on hard work, and rethink when a step fails. */
export function ThinkingCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const t = s.thinking ?? { mode: "auto", reasoning: "medium", idlePrep: true };
  const [notes, setNotes] = useState<{ at: string; owner: string; agents: Record<string, string>; anticipate: string[] } | null>(null);
  useEffect(() => void engineCall<typeof notes>("notes.get").then(setNotes).catch(() => {}), []);
  const save = async (patch: Partial<Settings["thinking"]>) => {
    try {
      onSaved(await saveSettings({ thinking: patch }));
    } catch (e) {
      toast("Not saved", e instanceof SettingsError ? e.message : String(e), "error");
    }
  };
  return (
    <div className="card">
      <h3>How agents think</h3>
      <p className="muted">Every agent looks at the situation first (time, approvals waiting, goals, its recent misses), then acts, and rethinks when a step fails. On complex work it writes a short plan first; on hard work (analysis, comparisons, decisions) it also uses the model's built-in reasoning. Summaries of its thinking appear in Crew chat.</p>
      <div className="seg" role="group" aria-label="When to think">
        {(
          [
            ["auto", "Complex work only"],
            ["always", "Always"],
            ["off", "Off"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" className={t.mode === v ? "on" : ""} aria-pressed={t.mode === v} onClick={() => save({ mode: v })}>
            {label}
          </button>
        ))}
      </div>
      <label className="field">
        Built-in reasoning effort (on hard work)
        <select value={t.reasoning} onChange={(e) => save({ reasoning: e.target.value as "low" | "medium" | "high" })} disabled={t.mode === "off"}>
          <option value="low">Low: about 1,000 thinking tokens</option>
          <option value="medium">Medium: about 4,000</option>
          <option value="high">High: about 12,000</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={t.idlePrep !== false} onChange={(e) => save({ idlePrep: e.target.checked })} />
        Prepare notes while idle: after 20 minutes without activity (at most every 3 hours), condense recent events into short notes the agents read next time. Uses the cheap model; reads your facts and the crew's own history only, never documents or web pages.
      </label>
      <div className="row">
        <button className="btn" type="button" onClick={async () => { try { toast("Notes", (await engineCall<string>("notes.prep")) ?? ""); setNotes(await engineCall("notes.get")); } catch (e) { toast("Notes failed", String(e).replace(/^Error: /, ""), "error"); } }}>Prepare notes now</button>
      </div>
      {notes && (
        <details>
          <summary className="muted">Prepared notes from {notes.at.slice(0, 16).replace("T", " ")}</summary>
          <p>{notes.owner}</p>
          {Object.entries(notes.agents).filter(([, v]) => v).map(([a, v]) => <p key={a}><b>{a}:</b> {v}</p>)}
          {notes.anticipate.length > 0 && <p className="muted">Likely next: {notes.anticipate.join(" | ")}</p>}
        </details>
      )}
      <p className="muted">Built-in reasoning works on Claude, Gemini 2.5 and OpenAI reasoning models (o-series, GPT-5). Other models still plan, without it.</p>
    </div>
  );
}
