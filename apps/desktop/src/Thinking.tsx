import { SettingsError, type Settings } from "@deck/settings";
import { saveSettings } from "./bridge";
import { toast } from "./ui/toast";

/** How agents think: observe the situation, plan, reason on hard work, and rethink when a step fails. */
export function ThinkingCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const t = s.thinking ?? { mode: "auto", reasoning: "medium" };
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
      <p className="muted">Built-in reasoning works on Claude, Gemini 2.5 and OpenAI reasoning models (o-series, GPT-5). Other models still plan, without it.</p>
    </div>
  );
}
