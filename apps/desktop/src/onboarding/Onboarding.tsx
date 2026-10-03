import { useState } from "react";
import type { Provider } from "@deck/settings";
import { engineCall, inTauri, saveKey, saveSettings } from "../bridge";
import { PROVIDER_LABEL, loadModelList } from "../ModelRoles";

type Step = "llm" | "pack" | "about" | "preset" | "done";
const STEPS: Step[] = ["llm", "pack", "about", "preset", "done"];
type PackInfo = { id: string; name: string; description: string; preset: "cautious" | "balanced" | "autonomous"; skills: string[]; issues: number; rules: number; interview: Record<string, string> };
const FIELDS: { id: string; label: string; hint: string; area?: boolean }[] = [
  { id: "name", label: "What should the crew call you?", hint: "Alex" },
  { id: "role", label: "What do you do?", hint: "Founder of a security startup" },
  { id: "priorities", label: "Top priorities right now", hint: "Sign 3 design partners; ship the beta", area: true },
  { id: "people", label: "Key people the crew should know", hint: "Sam: co-founder, runs sales", area: true },
  { id: "hours", label: "Working hours and time zone", hint: "9 to 7, Pacific" },
  { id: "style", label: "How should answers sound?", hint: "Short and direct" },
];

/** First-run setup, run by the Chief of Staff once the core is lit. Every step can be skipped. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("llm");
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [llm, setLlm] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [about, setAbout] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<"cautious" | "balanced" | "autonomous">("balanced");
  const [note, setNote] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const loadPacks = () => engineCall<PackInfo[]>("packs.list").then((p) => setPacks(p ?? [])).catch(() => setPacks([]));
  const choosePack = async (p: PackInfo) => {
    setBusy(true);
    const r = await engineCall<string>("packs.apply", { id: p.id }).catch((e) => String(e));
    setBusy(false);
    setNote(r ?? `Preview mode: ${p.name} would be applied in the desktop app.`);
    setHints(p.interview);
    setPreset(p.preset);
    setStep("about");
  };
  const idx = STEPS.indexOf(step);
  const next = () => {
    const n = STEPS[idx + 1]!;
    if (n === "pack" && !packs) void loadPacks();
    setStep(n);
  };

  const connect = async () => {
    setBusy(true);
    setLlm(null);
    const err = await saveKey(provider, key);
    setKey("");
    if (err) {
      setBusy(false);
      return setLlm({ ok: false, text: err });
    }
    if (provider !== "anthropic") {
      // Other providers: pick a model the key can use, and use it for both jobs.
      const r = await loadModelList(provider);
      setModels(r.models);
      setBusy(false);
      return setLlm(r.error ? { ok: false, text: r.error } : { ok: true, text: `Key saved. Pick a model below (${r.models.length} available).` });
    }
    await new Promise((r) => setTimeout(r, 1200)); // let the engine reload with the new key
    const res = await engineCall<{ ok: boolean; message: string }>("models.test").catch((e) => ({ ok: false, message: String(e) }));
    setBusy(false);
    setLlm(res ? { ok: res.ok, text: res.message } : { ok: true, text: "Saved. (Preview mode cannot test the key.)" });
  };

  const saveAbout = async () => {
    setBusy(true);
    const r = await engineCall<{ saved: number }>("profile.save", about).catch(() => null);
    setBusy(false);
    setNote(r ? `Saved ${r.saved} facts about you. You can change them any time.` : inTauri ? "Could not save; you can do this later." : "Preview mode: answers are not saved.");
    setStep("preset");
  };

  const finish = async () => {
    await saveSettings({ preset, onboarding: { done: true } });
    onDone();
  };

  return (
    <main className="onboard" aria-live="polite">
      <ol className="steps" aria-label="Setup steps">
        {["Connect an LLM", "Starting setup", "About you", "How much to ask", "Ready"].map((t, i) => (
          <li key={t} className={i === idx ? "current" : i < idx ? "past" : ""}>
            {t}
          </li>
        ))}
      </ol>

      {step === "llm" && (
        <section className="card">
          <h3>Connect an LLM</h3>
          <p className="muted">Choose a provider and paste its API key. It goes straight into your system keychain. You can add the others later and switch any time in Settings.</p>
          <select aria-label="Provider" value={provider} onChange={(e) => (setProvider(e.target.value as Provider), setModels([]), setLlm(null))}>
            {(["anthropic", "openai", "gemini", "openrouter"] as Provider[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
          <input className="keyinput" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" aria-label="API key" autoComplete="off" spellCheck={false} />
          {models.length > 0 && (
            <div className="row">
              <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Pick a model</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                type="button"
                disabled={!model}
                onClick={async () => {
                  await saveSettings({ models: { heavy: { provider, model }, cheap: { provider, model } } });
                  await new Promise((r) => setTimeout(r, 1200));
                  const res = await engineCall<{ ok: boolean; message: string }>("models.test").catch((e) => ({ ok: false, message: String(e) }));
                  setLlm(res ? { ok: res.ok, text: res.message } : { ok: true, text: "Saved." });
                }}
              >
                Use this model
              </button>
            </div>
          )}
          {llm && <p className={llm.ok ? "ok" : "error"}>{llm.text}</p>}
          <div className="row">
            <button className="primary" type="button" disabled={!key.trim() || busy} onClick={connect}>
              {busy ? "Connecting" : "Connect"}
            </button>
            <button className="btn" type="button" onClick={next}>
              {llm?.ok ? "Next" : "Skip for now"}
            </button>
          </div>
        </section>
      )}

      {step === "pack" && (
        <section className="card">
          <h3>Pick a starting setup</h3>
          <p className="muted">A starting setup gives the crew rules, skills and a few first issues for your kind of work. It can only make the crew more careful, and you can change everything later in Settings &gt; Crew.</p>
          {packs === null && <p className="muted">Loading setups…</p>}
          {packs?.length === 0 && <p className="muted">{inTauri ? "No setups found." : "Setups load inside the desktop app."}</p>}
          <div className="packs">
            {packs?.map((p) => (
              <button key={p.id} type="button" className="pack" disabled={busy} onClick={() => choosePack(p)}>
                <b>{p.name}</b>
                <span>{p.description}</span>
                {p.id !== "blank" && <span className="muted">{p.rules} rules · {p.skills.length} skills · {p.issues} first issues · {p.preset}</span>}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn" type="button" onClick={next}>
              Skip
            </button>
          </div>
        </section>
      )}

      {step === "about" && (
        <section className="card">
          <h3>About you</h3>
          {note && <p className="ok">{note}</p>}
          <p className="muted">A few answers so the crew starts with context. Saved as facts you stated, in your encrypted memory. Leave any blank.</p>
          {FIELDS.map((f) => (
            <label className="field" key={f.id}>
              {f.label}
              {f.area ? (
                <textarea rows={2} value={about[f.id] ?? ""} placeholder={hints[f.id] ?? f.hint} onChange={(e) => setAbout({ ...about, [f.id]: e.target.value })} />
              ) : (
                <input value={about[f.id] ?? ""} placeholder={hints[f.id] ?? f.hint} onChange={(e) => setAbout({ ...about, [f.id]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="row">
            <button className="primary" type="button" disabled={busy} onClick={saveAbout}>
              Save and continue
            </button>
            <button className="btn" type="button" onClick={next}>
              Skip
            </button>
          </div>
        </section>
      )}

      {step === "preset" && (
        <section className="card">
          <h3>How much should the crew ask first?</h3>
          {note && <p className="ok">{note}</p>}
          {(
            [
              ["cautious", "Cautious", "Asks before anything beyond reading. Best for the first week."],
              ["balanced", "Balanced", "Drafts and organizes on its own; asks before anything leaves your machine."],
              ["autonomous", "Autonomous", "Acts on routine work with an undo window; still asks for sends, merges and payments."],
            ] as const
          ).map(([id, name, desc]) => (
            <label className="check option" key={id}>
              <input type="radio" name="preset" checked={preset === id} onChange={() => setPreset(id)} />
              <span>
                <b>{name}</b>
                <span className="muted"> {desc}</span>
              </span>
            </label>
          ))}
          <div className="row">
            <button className="primary" type="button" onClick={next}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="card">
          <h3>Crew to stations</h3>
          <p className="muted">You are set. Turn on Telegram, VaultProof, or the OpenAI memory model any time in Settings. Nothing was sent or posted during setup.</p>
          <p className="muted">One thing to do now: save your recovery key in a password manager (Settings &gt; Recovery key). It is the only way to open your memory on a new computer.</p>
          <div className="row">
            <button className="primary" type="button" onClick={finish}>
              Open the command deck
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
