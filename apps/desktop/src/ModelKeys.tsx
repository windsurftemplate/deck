import { useEffect, useState } from "react";
import type { ProviderId } from "@deck/models";
import { inTauri, keyHint, removeKey, saveKey } from "./bridge";

const PROVIDERS: { id: ProviderId; name: string; hint: string }[] = [
  { id: "anthropic", name: "Anthropic (Claude)", hint: "sk-ant-…" },
  { id: "openai", name: "OpenAI", hint: "sk-…" },
  { id: "gemini", name: "Google Gemini", hint: "AIza…" },
  { id: "openrouter", name: "OpenRouter", hint: "sk-or-…" },
];

function KeyRow({ id, name, hint }: (typeof PROVIDERS)[number]) {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    keyHint(id).then(setSaved);
  }, [id]);

  const save = async () => {
    const err = await saveKey(id, value);
    if (err) {
      setValue(""); // do not leave a rejected key sitting in the field
      return setMsg({ ok: false, text: err });
    }
    setValue(""); // never keep the key in the UI longer than needed
    setSaved(await keyHint(id));
    setMsg({ ok: true, text: "Saved to the keychain." });
  };
  const remove = async () => {
    await removeKey(id);
    setSaved(null);
    setMsg({ ok: true, text: "Removed." });
  };

  return (
    <div className="keyrow">
      <div className="keyhead">
        <b>{name}</b>
        <span className={saved ? "ok" : "muted"}>{saved ? `Saved, ends in ${saved}` : "Not set"}</span>
      </div>
      <div className="row">
        <input
          className="keyinput"
          type="password"
          value={value}
          onChange={(e) => (setValue(e.target.value), setMsg(null))}
          placeholder={saved ? "Paste a new key to replace it" : `Paste key (${hint})`}
          aria-label={`${name} API key`}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn" type="button" onClick={save} disabled={!value.trim()}>
          Save
        </button>
        {saved && (
          <button className="btn" type="button" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? undefined : "alert"}>{msg.text}</p>}
    </div>
  );
}

export function ModelKeys() {
  return (
    <div className="card">
      <h3>Models: API keys</h3>
      <p className="muted">
        Temporary until VaultProof is live. Keys go straight into your system keychain, never into files, memory, logs or prompts. Only the last 4 characters are ever shown. Remove them once VaultProof brokers credentials.
      </p>
      {!inTauri && <p className="warn">Browser preview: keys are kept in memory only and cleared on reload.</p>}
      {PROVIDERS.map((p) => (
        <KeyRow key={p.id} {...p} />
      ))}
    </div>
  );
}
