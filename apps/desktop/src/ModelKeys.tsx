import { useEffect, useState } from "react";
import type { ProviderId } from "@deck/models";
import { invoke } from "@tauri-apps/api/core";
import { engineCall, inTauri, keyHint, removeKey, saveKey } from "./bridge";

type KeyTest = { key: string; ok: boolean; status: string; message: string; at: string };
const LABEL: Record<string, string> = { works: "Works", missing: "Not set", invalid: "Rejected", limited: "Out of credits or limited", unreachable: "Can't connect", "model-missing": "Works, model unavailable" };

/** Runs a key test and returns a message for the row. */
async function runTest(key: string, candidate?: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await engineCall<KeyTest>("keys.test", { key, ...(candidate?.trim() ? { candidate: candidate.trim() } : {}) });
    return r ? { ok: r.ok, text: `${LABEL[r.status] ?? r.status}. ${r.message}` } : { ok: false, text: "Testing works inside the desktop app." };
  } catch (e) {
    return { ok: false, text: String(e).replace(/^Error: /, "") };
  }
}

const PROVIDERS: { id: ProviderId; name: string; hint: string }[] = [
  { id: "openai", name: "OpenAI", hint: "sk-…" },
  { id: "anthropic", name: "Anthropic (Claude)", hint: "sk-ant-…" },
  { id: "gemini", name: "Google Gemini", hint: "AIza…" },
  { id: "openrouter", name: "OpenRouter", hint: "sk-or-…" },
];

function KeyRow({ id, name, hint }: (typeof PROVIDERS)[number]) {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

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
    setMsg({ ok: true, text: "Saved to the keychain. Testing…" });
    await new Promise((r) => setTimeout(r, 1200)); // let the engine pick up the new key
    setMsg(await runTest(id));
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
        <button
          className="btn"
          type="button"
          disabled={testing || (!value.trim() && !saved)}
          title={value.trim() ? "Test the key you pasted, before saving it" : "Test the saved key"}
          onClick={async () => {
            setTesting(true);
            setMsg(await runTest(id, value));
            setTesting(false);
          }}
        >
          {testing ? "Testing…" : "Test"}
        </button>
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

/** The Jev key lives with the other keys here too, so every key can be tested in one place. */
function JevRow() {
  const [saved, setSaved] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => void (inTauri ? invoke<string | null>("secret_hint", { name: "tool.jev" }).then(setSaved).catch(() => {}) : undefined), []);
  return (
    <div className="keyrow">
      <div className="keyhead">
        <b>Jev (TypeSafe AI)</b>
        <span className={saved ? "ok" : "muted"}>{saved ? `Saved, ends in ${saved}` : "Not set (add it on the Tools page)"}</span>
      </div>
      {saved && (
        <div className="row">
          <button className="btn" type="button" disabled={testing} onClick={async () => { setTesting(true); setMsg(await runTest("jev")); setTesting(false); }}>
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? undefined : "alert"}>{msg.text}</p>}
    </div>
  );
}

function TestAll() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<KeyTest[] | null>(null);
  return (
    <div className="test-all">
      <button className="primary" type="button" disabled={busy} onClick={async () => { setBusy(true); setResults((await engineCall<KeyTest[]>("keys.testAll").catch(() => null)) ?? []); setBusy(false); }}>
        {busy ? "Testing all keys…" : "Test all keys"}
      </button>
      <span className="muted">Model keys are checked by listing the models they can use, so no tokens are spent. Jev gets one tiny question.</span>
      {results && (
        <ul className="key-results">
          {results.length === 0 && <li className="muted">No keys saved yet.</li>}
          {results.map((r) => (
            <li key={r.key} className={r.ok ? "ok" : "error"}>
              <b>{r.key === "jev" ? "Jev" : r.key}</b>: {LABEL[r.status] ?? r.status}. {r.message}
            </li>
          ))}
        </ul>
      )}
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
      <TestAll />
      {PROVIDERS.map((p) => (
        <KeyRow key={p.id} {...p} />
      ))}
      <JevRow />
    </div>
  );
}
