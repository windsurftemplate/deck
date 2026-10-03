import { useEffect, useState } from "react";
import { restoreRecoveryKey, revealRecoveryKey } from "./bridge";

/** Settings card: show the workspace key once so it can go into a password manager. */
export function RecoveryCard() {
  const [key, setKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => setKey(null), 60_000); // hide again after a minute
    return () => clearTimeout(t);
  }, [key]);

  const show = async () => {
    setMsg(null);
    try {
      setKey(await revealRecoveryKey());
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };
  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(key).catch(() => {});
    setMsg({ ok: true, text: "Copied. Paste it into your password manager, then clear your clipboard." });
  };

  return (
    <div className="card">
      <h3>Recovery key</h3>
      <p className="muted">Your memory is locked with a key kept in the system keychain. Save this key in a password manager: it is the only way to open your memory on a new computer or after a keychain reset.</p>
      {key ? (
        <>
          <code className="recovery" aria-label="Recovery key">
            {key.match(/.{1,16}/g)!.join(" ")}
          </code>
          <div className="row">
            <button className="primary" type="button" onClick={copy}>
              Copy
            </button>
            <button className="btn" type="button" onClick={() => setKey(null)}>
              Hide
            </button>
            <span className="muted">Hides itself after a minute.</span>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="btn" type="button" onClick={show}>
            Show recovery key
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
    </div>
  );
}

/** Shown on the power-up screen when memory cannot be opened. */
export function RestoreKey({ onRestored }: { onRestored: () => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    const e = await restoreRecoveryKey(value);
    setValue("");
    setBusy(false);
    if (e) setErr(e);
    else onRestored();
  };
  return (
    <div className="issue">
      <b>Restore with your recovery key</b>
      <p>If you saved your recovery key in a password manager, paste it here.</p>
      <div className="row">
        <input className="keyinput" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Recovery key" aria-label="Recovery key" autoComplete="off" spellCheck={false} />
        <button className="primary" type="button" disabled={!value.trim() || busy} onClick={go}>
          {busy ? "Restoring" : "Restore"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
