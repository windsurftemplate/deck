import { useEffect, useState } from "react";
import { engineCall, inTauri, loadSettings, saveSettings } from "../bridge";
import { invoke } from "@tauri-apps/api/core";

type Tool = { id: string; name: string; what: string; status: string; ready: boolean; keyName?: string; setup: string };
type Member = { id: string; name: string; tools: { scope: string; label: string; mode: string }[] };

/** Every outside tool in one place, with keys kept in the OS keychain. */
export function Tools({ openSettings, openBrain }: { openSettings: () => void; openBrain: () => void }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [crew, setCrew] = useState<Member[]>([]);
  const [jevKey, setJevKey] = useState("");
  const [jevUrl, setJevUrl] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setTools((await engineCall<Tool[]>("tools.list").catch(() => null)) ?? []);
    setCrew((await engineCall<Member[]>("crew.info").catch(() => null)) ?? []);
    const s = await loadSettings();
    setJevUrl(s.tools?.jev?.baseUrl ?? "");
    if (inTauri) setHint(await invoke<string | null>("secret_hint", { name: "tool.jev" }).catch(() => null));
  };
  useEffect(() => void load(), []);

  const saveJev = async () => {
    setMsg(null);
    try {
      const k = jevKey.trim();
      if (k) {
        if (k.length < 8 || /\s/.test(k)) throw new Error("That does not look like an API key.");
        if (inTauri) await invoke("secret_set", { name: "tool.jev", value: k });
      }
      await saveSettings({ tools: { jev: { baseUrl: jevUrl } } });
      setJevKey("");
      setMsg({ ok: true, text: "Saved. The key is in your system keychain. Jev connects once its API is added." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message ?? String(e) });
    }
  };
  const removeJev = async () => {
    if (inTauri) await invoke("secret_delete", { name: "tool.jev" });
    setMsg({ ok: true, text: "Removed the Jev key." });
    await load();
  };

  return (
    <section className="page" aria-label="Tools">
      <div className="tools-grid">
        {tools.map((t) => (
          <article key={t.id} className="card tool">
            <header>
              <h3>{t.name}</h3>
              <span className={`pill ${t.ready ? "on" : ""}`}>{t.status}</span>
            </header>
            <p className="muted">{t.what}</p>
            {t.setup === "jev" && (
              <div className="stack">
                <label className="field">
                  API key {hint && <span className="muted">(saved, ends in {hint})</span>}
                  <input type="password" value={jevKey} onChange={(e) => setJevKey(e.target.value)} placeholder={hint ? "Paste a new key to replace it" : "Paste your Jev API key"} autoComplete="off" spellCheck={false} />
                </label>
                <label className="field">
                  API address
                  <input value={jevUrl} onChange={(e) => setJevUrl(e.target.value)} placeholder="https://" spellCheck={false} />
                </label>
                <div className="row">
                  <button className="primary" type="button" onClick={saveJev}>Save</button>
                  {hint && <button className="btn" type="button" onClick={removeJev}>Remove key</button>}
                </div>
                {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
              </div>
            )}
            {t.setup === "settings" && <button className="btn" type="button" onClick={openSettings}>Set up in Settings</button>}
            {t.setup === "models" && <button className="btn" type="button" onClick={openSettings}>Choose models</button>}
            {t.setup === "brain" && <button className="btn" type="button" onClick={openBrain}>Open the second brain</button>}
          </article>
        ))}
      </div>
      <section className="card">
        <h3>Who can use what</h3>
        <p className="muted">Each crew member's tools. Change them in Settings, Crew. Sending, deleting and paying are never allowed without you.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Agent</th><th>Allowed</th><th>Asks you first</th><th>Off</th></tr></thead>
            <tbody>
              {crew.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  {(["allowed", "ask", "off"] as const).map((mode) => (
                    <td key={mode}>{c.tools.filter((x) => x.mode === mode).map((x) => x.label).join(", ") || "None"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
