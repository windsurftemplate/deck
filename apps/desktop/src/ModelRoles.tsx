import { useState } from "react";
import { PROVIDERS, SettingsError, type ModelChoice, type Provider, type Settings } from "@deck/settings";
import { engineCall, inTauri, saveSettings } from "./bridge";

export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", gemini: "Google Gemini", openrouter: "OpenRouter" };

/** Loads model ids from the provider with the saved key. Returns an error message instead of throwing. */
export async function loadModelList(provider: Provider): Promise<{ models: string[]; error?: string }> {
  if (!inTauri) return { models: [], error: "Model lists load inside the desktop app. Type the model id instead." };
  try {
    return { models: (await engineCall<string[]>("models.list", { provider })) ?? [] };
  } catch (e) {
    return { models: [], error: String(e) };
  }
}

function RolePicker({ label, help, value, onChange, optional }: { label: string; help: string; value: ModelChoice | null; onChange: (v: ModelChoice | null) => void; optional?: boolean }) {
  const [list, setList] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const id = `models-${label.replace(/\W/g, "")}`;
  const load = async (p: Provider) => {
    setErr(null);
    const r = await loadModelList(p);
    setList(r.models);
    if (r.error) setErr(r.error);
  };
  return (
    <div className="keyrow">
      <div className="keyhead">
        <b>{label}</b>
        <span className="muted">{help}</span>
      </div>
      <div className="row">
        <select
          aria-label={`${label} provider`}
          value={value?.provider ?? ""}
          onChange={(e) => {
            const p = e.target.value as Provider | "";
            setList([]);
            onChange(p ? { provider: p, model: "" } : null);
          }}
        >
          {optional && <option value="">None</option>}
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        {value && (
          <>
            <input className="keyinput" list={id} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} placeholder="Model id" aria-label={`${label} model`} spellCheck={false} />
            <datalist id={id}>
              {list.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button className="btn" type="button" onClick={() => load(value.provider)}>
              Load models
            </button>
          </>
        )}
      </div>
      {list.length > 0 && <p className="muted">{list.length} models available with your key. Start typing to pick one.</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

export function ModelRoles({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [heavy, setHeavy] = useState<ModelChoice | null>(s.models.heavy);
  const [cheap, setCheap] = useState<ModelChoice | null>(s.models.cheap);
  const [fallback, setFallback] = useState<ModelChoice | null>(s.models.fallback);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try {
      const next = await saveSettings({ models: { heavy: heavy!, cheap: cheap!, fallback } });
      onSaved(next);
      setMsg({ ok: true, text: "Saved. The crew switches models right away." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SettingsError ? e.message : "Could not save." });
    }
  };
  return (
    <div className="card">
      <h3>Models: who does what</h3>
      <p className="muted">Pick a provider and model for each job. Each provider uses its own key from above. If the main model fails, the backup takes over.</p>
      <RolePicker label="Heavy work" help="Planning, writing, code" value={heavy} onChange={setHeavy} />
      <RolePicker label="Quick tasks" help="Triage, summaries, checks" value={cheap} onChange={setCheap} />
      <RolePicker label="Backup" help="Used when the main model is down" value={fallback} onChange={setFallback} optional />
      <div className="row">
        <button className="primary" type="button" onClick={save}>
          Save models
        </button>
        {msg && <span className={msg.ok ? "ok" : "error"}>{msg.text}</span>}
      </div>
    </div>
  );
}
