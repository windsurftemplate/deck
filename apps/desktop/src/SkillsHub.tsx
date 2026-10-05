import { useEffect, useState } from "react";
import { BadgeCheck, Download, FolderInput, PenLine, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import type { Settings } from "@deck/settings";
import { engineCall, saveSettings } from "./bridge";
import { toast } from "./ui/toast";

type Entry = { hub: string; hubUrl: string; name: string; description: string };
type Check = { id?: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
type Preview = { entry: Entry; verdict: "verified" | "scanned" | "blocked"; checks: Check[]; publisher: string | null; body: string };
const err = (e: unknown) => String(e).replace(/^Error: /, "");

export function Verdict({ v }: { v: string }) {
  if (v === "verified") return <span className="pill on"><BadgeCheck size={12} aria-hidden="true" /> Verified</span>;
  if (v === "blocked") return <span className="pill bad"><ShieldAlert size={12} aria-hidden="true" /> Blocked</span>;
  return <span className="pill"><ShieldCheck size={12} aria-hidden="true" /> Scanned</span>;
}
function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="skill-checks">
      {checks.map((c, i) => (
        <li key={i} className={c.status}>
          <b>{c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✕"} {c.label}</b> <span className="muted">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** Settings: browse skill hubs, see each skill's verification, install (with approval), trust publishers, publish. */
export function SkillsHubCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ entries: Entry[]; errors: string[] } | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [me, setMe] = useState<{ publicKey: string; fingerprint: string } | null>(null);
  const [hubName, setHubName] = useState("");
  const [hubUrl, setHubUrl] = useState("");
  const [pubName, setPubName] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [folder, setFolder] = useState("~/Desktop/deck/skills-hub");
  const search = async () => setRes((await engineCall<{ entries: Entry[]; errors: string[] }>("skills.hub.search", { query: q }).catch((e) => ({ entries: [], errors: [err(e)] }))) ?? { entries: [], errors: ["Works inside the desktop app."] });
  useEffect(() => {
    void search();
    void engineCall<{ publicKey: string; fingerprint: string }>("skills.publisher").then((x) => x && setMe(x)).catch(() => {});
  }, []);
  const hubs = s.skills?.hubs ?? [];
  const trusted = s.skills?.trusted ?? [];
  return (
    <div className="card skills-hub">
      <h3>Skills hub</h3>
      <p className="muted">Browse skills from the hubs below. Every skill is checked before you can install it: no download-and-run steps, no hidden payloads, no credential or wallet theft, no keys inside, no instructions aimed at the agent. Only the instructions are installed (scripts never run), and each one waits for your approval. <b>Verified</b> means signed by a publisher you trust.</p>
      <div className="row">
        <label className="board-search grow">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder="Search skills" aria-label="Search skills" />
        </label>
        <button className="btn" type="button" onClick={search}>Search</button>
      </div>
      {res?.errors.map((x) => <p key={x} className="error">{x}</p>)}
      {res && (
        <ul className="hub-list">
          {res.entries.length === 0 && <li className="muted">No skills found.</li>}
          {res.entries.map((e) => (
            <li key={e.hubUrl + e.name}>
              <div>
                <b>{e.name}</b> <span className="muted">from {e.hub}</span>
                <p className="muted">{e.description}</p>
              </div>
              <button className="btn" type="button" onClick={async () => { try { setPv(await engineCall<Preview>("skills.hub.preview", { hubUrl: e.hubUrl, name: e.name })); } catch (x) { toast("Could not open it", err(x), "error"); } }}>Check and preview</button>
            </li>
          ))}
        </ul>
      )}
      {pv && (
        <div className="hub-preview" role="dialog" aria-label={pv.entry.name}>
          <header>
            <b>{pv.entry.name}</b> <Verdict v={pv.verdict} />
            <span className="grow" />
            <button className="icon-btn" type="button" aria-label="Close" onClick={() => setPv(null)}><X size={15} /></button>
          </header>
          <Checks checks={pv.checks} />
          <pre className="security-out">{pv.body}</pre>
          <button className="primary" type="button" disabled={pv.verdict === "blocked"} onClick={async () => { try { const r = await engineCall<{ added: string[]; errors: string[] }>("skills.hub.install", { hubUrl: pv.entry.hubUrl, name: pv.entry.name }); toast(r?.added.length ? "Waiting for your approval" : "Not installed", r?.added.length ? `${pv.entry.name} will be usable once you approve it.` : (r?.errors ?? []).join("; "), r?.added.length ? "success" : "error"); setPv(null); } catch (x) { toast("Not installed", err(x), "error"); } }}>
            <Download size={14} aria-hidden="true" /> {pv.verdict === "blocked" ? "Blocked" : "Install"}
          </button>
        </div>
      )}
      <details>
        <summary>Hubs ({hubs.length})</summary>
        <ul className="hub-mini">
          {hubs.map((h) => (
            <li key={h.url}><b>{h.name}</b> <span className="muted mono">{h.url}</span> <button className="icon-btn" type="button" aria-label={`Remove ${h.name}`} onClick={async () => onSaved(await saveSettings({ skills: { hubs: hubs.filter((x) => x.url !== h.url) } }))}><X size={13} /></button></li>
          ))}
        </ul>
        <div className="row">
          <input value={hubName} onChange={(e) => setHubName(e.target.value)} placeholder="Name" aria-label="Hub name" />
          <input className="grow" value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="https://…/index.json" aria-label="Hub address" />
          <button className="btn" type="button" onClick={async () => { try { onSaved(await saveSettings({ skills: { hubs: [...hubs, { name: hubName, url: hubUrl }] } })); setHubName(""); setHubUrl(""); } catch (x) { toast("Not added", err(x), "error"); } }}>Add hub</button>
        </div>
      </details>
      <details>
        <summary>Trusted publishers ({trusted.length + 1})</summary>
        <ul className="hub-mini">
          <li><b>You</b> <span className="muted mono">{me ? me.fingerprint : "…"}</span> <button className="btn small" type="button" disabled={!me} onClick={() => me && navigator.clipboard.writeText(me.publicKey).then(() => toast("Copied your public key", "Share it so others can trust skills you sign."))}>Copy public key</button></li>
          {trusted.map((t) => (
            <li key={t.publicKey}><b>{t.name}</b> <span className="muted mono">{t.publicKey.slice(0, 12)}…</span> <button className="icon-btn" type="button" aria-label={`Remove ${t.name}`} onClick={async () => onSaved(await saveSettings({ skills: { trusted: trusted.filter((x) => x.publicKey !== t.publicKey) } }))}><X size={13} /></button></li>
          ))}
        </ul>
        <div className="row">
          <input value={pubName} onChange={(e) => setPubName(e.target.value)} placeholder="Publisher name" aria-label="Publisher name" />
          <input className="grow" value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="Public key (44 characters)" aria-label="Publisher public key" />
          <button className="btn" type="button" onClick={async () => { try { onSaved(await saveSettings({ skills: { trusted: [...trusted, { name: pubName, publicKey: pubKey }] } })); setPubName(""); setPubKey(""); } catch (x) { toast("Not added", err(x), "error"); } }}>Trust</button>
        </div>
      </details>
      <details>
        <summary><PenLine size={13} aria-hidden="true" /> Sign and publish a folder</summary>
        <p className="muted">Signs every skill folder inside with your key (kept in your keychain), refuses any that fail the checks, and writes index.json. Commit and push the folder to publish it, for example the skills-hub folder in your deck repository.</p>
        <div className="row">
          <input className="grow" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder to publish" />
          <button className="btn" type="button" onClick={async () => { try { const r = await engineCall<{ index: string; signed: string[]; blocked: string[] }>("skills.hub.publish", { dir: folder }); toast(`Signed ${r?.signed.length ?? 0} skills`, r?.blocked.length ? `Blocked: ${r.blocked.join("; ")}` : `Wrote ${r?.index}`, r?.blocked.length ? "error" : "success"); } catch (x) { toast("Not published", err(x), "error"); } }}>Sign and publish</button>
        </div>
      </details>
    </div>
  );
}

type Item = { kind: string; file: string; title: string; chars: number; flags: string[]; skill?: { name: string; verdict: string; checks: Check[]; scripts: number } };
type Scan = { root: string; workspace: string | null; items: Item[]; skipped: string[] };

/** Settings: bring an OpenClaw install into deck, after showing exactly what comes over and what is checked. */
export function OpenClawCard() {
  const [path, setPath] = useState("~/.openclaw");
  const [scan, setScan] = useState<Scan | null>(null);
  const [parts, setParts] = useState({ memory: true, persona: true, heartbeat: true });
  const [skills, setSkills] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const doScan = async () => {
    try {
      const r = await engineCall<Scan>("openclaw.scan", { path });
      setScan(r);
      setSkills((r?.items ?? []).filter((i) => i.kind === "skill" && i.skill?.verdict !== "blocked").map((i) => i.skill!.name));
    } catch (e) {
      toast("Nothing to import", err(e), "error");
    }
  };
  const count = (k: string[]) => scan?.items.filter((i) => k.includes(i.kind)).length ?? 0;
  return (
    <div className="card">
      <h3><FolderInput size={15} aria-hidden="true" /> Import from OpenClaw</h3>
      <p className="muted">Brings your OpenClaw memory, persona, heartbeat and skills into deck. Credentials (auth-profiles.json), config, .env files and session databases are never read. Every file is scanned, keys are removed, and skills are verified.</p>
      <div className="row">
        <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} aria-label="OpenClaw folder" />
        <button className="btn" type="button" onClick={doScan}>Scan</button>
      </div>
      {scan && (
        <div className="oc-scan">
          <p className="muted">Found {scan.workspace ? `a workspace at ${scan.workspace}` : "no workspace"}; never read: {scan.skipped.join(", ") || "nothing sensitive present"}.</p>
          <label className="check"><input type="checkbox" checked={parts.memory} onChange={(e) => setParts({ ...parts, memory: e.target.checked })} /> Memory: {count(["user", "memory", "daily"])} files (USER.md, MEMORY.md, daily logs) into your second brain</label>
          <label className="check"><input type="checkbox" checked={parts.persona} disabled={!count(["persona"])} onChange={(e) => setParts({ ...parts, persona: e.target.checked })} /> Persona: {count(["persona"])} files become owner rules for the Chief of Staff (you approve them; anything about tools, approvals or safety is left out)</label>
          <label className="check"><input type="checkbox" checked={parts.heartbeat} disabled={!count(["heartbeat"])} onChange={(e) => setParts({ ...parts, heartbeat: e.target.checked })} /> Heartbeat: becomes a weekday automation, switched off until you review it</label>
          {scan.items.filter((i) => i.flags.length).map((i) => <p key={i.file} className="warn-line">{i.title}: {i.flags.join("; ")}</p>)}
          <p><b>Skills</b></p>
          <ul className="hub-list">
            {scan.items.filter((i) => i.kind === "skill").map((i) => (
              <li key={i.file}>
                <label className="check">
                  <input type="checkbox" disabled={i.skill!.verdict === "blocked"} checked={skills.includes(i.skill!.name)} onChange={(e) => setSkills(e.target.checked ? [...skills, i.skill!.name] : skills.filter((x) => x !== i.skill!.name))} />
                  <b>{i.skill!.name}</b> <Verdict v={i.skill!.verdict} />
                  {i.skill!.scripts > 0 && <span className="muted"> {i.skill!.scripts} script file{i.skill!.scripts > 1 ? "s" : ""} not copied</span>}
                </label>
                <button className="btn small" type="button" onClick={() => setOpen(open === i.file ? null : i.file)}>{open === i.file ? "Hide checks" : "Checks"}</button>
                {open === i.file && <Checks checks={i.skill!.checks} />}
              </li>
            ))}
          </ul>
          <button className="primary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await engineCall<{ summary: string[] }>("openclaw.import", { path, parts: { ...parts, skills } }); toast("OpenClaw imported", (r?.summary ?? []).join("\n")); setScan(null); } catch (e) { toast("Import failed", err(e), "error"); } setBusy(false); }}>{busy ? "Importing…" : "Import"}</button>
        </div>
      )}
    </div>
  );
}
