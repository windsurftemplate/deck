import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { engineCall, inTauri } from "./bridge";
import { toast } from "./ui/toast";

const b64 = async (f: File) => {
  const u = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Encrypted backup and restore, sealed with a passphrase only you know. */
export function BackupCard() {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rpass, setRpass] = useState("");
  const backup = async () => {
    if (pass !== again) return toast("Passphrases do not match", undefined, "error");
    setBusy(true);
    try {
      const r = await engineCall<{ path: string; bytes: number }>("backup.now", { passphrase: pass });
      toast("Backup saved", r ? `${r.path} (${Math.round(r.bytes / 1024)} KB). Keep the passphrase somewhere safe; without it the backup cannot be opened.` : "Backups work inside the desktop app.");
      setPass("");
      setAgain("");
    } catch (e) {
      toast("Backup failed", String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(false);
  };
  const restore = async () => {
    if (!file || !confirm("Restore this backup? Your current memory is kept aside as a copy, and deck restarts.")) return;
    setBusy(true);
    try {
      await engineCall("backup.restore", { data: await b64(file), passphrase: rpass });
      if (inTauri) await invoke("engine_restart");
      toast("Backup restored", "deck is restarting with the restored memory.");
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast("Restore failed", String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(false);
  };
  return (
    <div className="card">
      <h3>Backups</h3>
      <p className="muted">A backup holds your memory, chats, issues, second brain and settings, encrypted with a passphrase you choose. It works on a new computer with only the file and the passphrase. Saved to Documents/deck-backups.</p>
      <label className="field">
        Passphrase (12 characters or more)
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="field">
        Same passphrase again
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </label>
      <div className="row">
        <button className="primary" type="button" disabled={busy || pass.length < 12} onClick={backup}>Back up now</button>
      </div>
      <h3>Restore</h3>
      <label className="field">
        Backup file (.deckbak)
        <input type="file" accept=".deckbak" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="field">
        Its passphrase
        <input type="password" value={rpass} onChange={(e) => setRpass(e.target.value)} autoComplete="off" />
      </label>
      <div className="row">
        <button className="btn" type="button" disabled={busy || !file || !rpass} onClick={restore}>Restore backup</button>
      </div>
    </div>
  );
}
