import { useState } from "react";
import { engineCall, inTauri, saveKey, saveSettings } from "../bridge";

type Step = "llm" | "about" | "preset" | "done";
const STEPS: Step[] = ["llm", "about", "preset", "done"];
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
  const [llm, setLlm] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [about, setAbout] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<"cautious" | "balanced" | "autonomous">("balanced");
  const [note, setNote] = useState<string | null>(null);
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[idx + 1]!);

  const connect = async () => {
    setBusy(true);
    setLlm(null);
    const err = await saveKey("anthropic", key);
    setKey("");
    if (err) {
      setBusy(false);
      return setLlm({ ok: false, text: err });
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
    next();
  };

  const finish = async () => {
    await saveSettings({ preset, onboarding: { done: true } });
    onDone();
  };

  return (
    <main className="onboard" aria-live="polite">
      <ol className="steps" aria-label="Setup steps">
        {["Connect an LLM", "About you", "How much to ask", "Ready"].map((t, i) => (
          <li key={t} className={i === idx ? "current" : i < idx ? "past" : ""}>
            {t}
          </li>
        ))}
      </ol>

      {step === "llm" && (
        <section className="card">
          <h3>Connect an LLM</h3>
          <p className="muted">Paste an Anthropic API key. It goes straight into your system keychain and is used only to call Claude. Until VaultProof is live, this is how the crew reaches a model.</p>
          <input className="keyinput" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Anthropic API key" autoComplete="off" spellCheck={false} />
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

      {step === "about" && (
        <section className="card">
          <h3>About you</h3>
          <p className="muted">A few answers so the crew starts with context. Saved as facts you stated, in your encrypted memory. Leave any blank.</p>
          {FIELDS.map((f) => (
            <label className="field" key={f.id}>
              {f.label}
              {f.area ? (
                <textarea rows={2} value={about[f.id] ?? ""} placeholder={f.hint} onChange={(e) => setAbout({ ...about, [f.id]: e.target.value })} />
              ) : (
                <input value={about[f.id] ?? ""} placeholder={f.hint} onChange={(e) => setAbout({ ...about, [f.id]: e.target.value })} />
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
