import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { SettingsError, type Labs, type PluginServer, type Settings } from "@deck/settings";
import { engineCall, inTauri, saveSettings } from "./bridge";
import { toast } from "./ui/toast";

const secret = async (name: string, value: string) => {
  if (inTauri) await invoke("secret_set", { name, value });
};
const hint = async (name: string) => (inTauri ? await invoke<string | null>("secret_hint", { name }).catch(() => null) : null);

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
    </label>
  );
}

function Lab({ title, children, on, onToggle, about }: { title: string; about: string; on: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className={`lab ${on ? "on" : ""}`}>
      <div className="lab-head">
        <div>
          <b>{title}</b>
          <p className="muted">{about}</p>
        </div>
        <Switch on={on} onChange={onToggle} label={title} />
      </div>
      {on && children && <div className="lab-body">{children}</div>}
    </div>
  );
}

/** Labs: features that start off. Each switch has its own setup underneath once it is on. */
export function LabsCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const L = s.labs;
  const [draft, setDraft] = useState<Labs>(L);
  useEffect(() => setDraft(L), [s]);
  const [gh, setGh] = useState({ token: "", hint: null as string | null });
  const [google, setGoogle] = useState({ secret: "", hint: null as string | null });
  const [pluginTokens, setPluginTokens] = useState<Record<string, string>>({});
  const [pluginStatus, setPluginStatus] = useState<{ id: string; tools: string[]; error?: string }[]>([]);
  const [fed, setFed] = useState({ addr: "", invite: "", code: "", peers: [] as { id: string; name: string; addr: string }[] });
  useEffect(() => {
    void hint("tool.github").then((h) => setGh((x) => ({ ...x, hint: h })));
    void hint("google.client_secret").then((h) => setGoogle((x) => ({ ...x, hint: h })));
    if (L.federation.enabled) void engineCall<typeof fed.peers>("federation.peers").then((p) => setFed((f) => ({ ...f, peers: p ?? [] }))).catch(() => {});
  }, [L.federation.enabled]);

  const save = async (patch: Partial<Labs>, msg?: string) => {
    try {
      const next = await saveSettings({ labs: patch });
      onSaved(next);
      if (msg) toast(msg);
    } catch (e) {
      toast("Not saved", e instanceof SettingsError ? e.message : String(e), "error");
    }
  };
  const set = <K extends keyof Labs>(k: K, v: Labs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const servers = draft.plugins.servers;

  return (
    <div className="card labs">
      <h3><FlaskConical size={15} aria-hidden="true" /> Labs</h3>
      <p className="muted">Features that start off. Turn on what you want. Whatever you turn on, anything that leaves your machine still needs your approval.</p>

      <Lab title="Complexity routing" about="Simple requests (thanks, quick lookups, create an issue) go to the cheap model; anything that needs thinking or writing goes to the heavy one. No extra model call to decide." on={L.routing} onToggle={(v) => save({ routing: v })} />

      <Lab title="Local models (Ollama)" about="Run models on this computer with Ollama: free, and nothing leaves the machine. Install Ollama, run ollama pull llama3.2, then pick Ollama in Settings, Models." on={L.ollama.enabled} onToggle={(v) => save({ ollama: { ...draft.ollama, enabled: v } })}>
        <label className="field">
          Ollama address
          <input value={draft.ollama.baseUrl} onChange={(e) => set("ollama", { ...draft.ollama, baseUrl: e.target.value })} spellCheck={false} />
        </label>
        <div className="row">
          <button className="btn" type="button" onClick={() => save({ ollama: draft.ollama }, "Saved")}>Save</button>
          <button className="btn" type="button" onClick={async () => { try { const m = await engineCall<string[]>("models.list", { provider: "ollama" }); toast("Ollama is running", m?.length ? `Models: ${m.join(", ")}` : "No models pulled yet. Try: ollama pull llama3.2", "info"); } catch (e) { toast("Ollama not reachable", String(e).replace(/^Error: /, ""), "error"); } }}>Check connection</button>
        </div>
      </Lab>

      <Lab title="Parallel work" about="The Chief of Staff can hand 2 to 4 independent tasks to the crew at once. Faster for research across several companies; uses tokens faster too." on={L.fanout} onToggle={(v) => save({ fanout: v })} />

      <Lab title="Crew votes" about="For judgement calls: each crew member answers on its own, then they rank each other's answers, and the Chief of Staff reports the winner and any dissent. Start one in Crew chat, or the Chief of Staff can call one." on={L.consensus} onToggle={(v) => save({ consensus: v })} />

      <Lab title="Plugins (MCP servers)" about="Connect outside tools that speak MCP. Every plugin call asks you first, unless you trust a plugin's read-only tools. Results are treated as untrusted. Plugins run on their servers with whatever access their token has, so add only ones you trust." on={L.plugins.enabled} onToggle={(v) => save({ plugins: { ...draft.plugins, enabled: v } })}>
        {servers.map((p, i) => (
          <div key={i} className="plugin-row">
            <input value={p.name} onChange={(e) => set("plugins", { ...draft.plugins, servers: servers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Name, like Linear" aria-label="Plugin name" />
            <input value={p.url} onChange={(e) => set("plugins", { ...draft.plugins, servers: servers.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…/mcp" aria-label="Plugin address" spellCheck={false} />
            <input type="password" value={pluginTokens[p.id || p.name] ?? ""} onChange={(e) => setPluginTokens({ ...pluginTokens, [p.id || p.name]: e.target.value })} placeholder="Token (optional)" aria-label="Plugin token" autoComplete="off" />
            <label className="check"><input type="checkbox" checked={p.enabled} onChange={(e) => set("plugins", { ...draft.plugins, servers: servers.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} /> On</label>
            <label className="check" title="Tools the server marks read-only run without asking"><input type="checkbox" checked={p.trustReadOnly} onChange={(e) => set("plugins", { ...draft.plugins, servers: servers.map((x, j) => (j === i ? { ...x, trustReadOnly: e.target.checked } : x)) })} /> Trust read-only</label>
            <button className="icon-btn" type="button" aria-label={`Remove ${p.name || "plugin"}`} onClick={() => set("plugins", { ...draft.plugins, servers: servers.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            {pluginStatus.find((x) => x.id === p.id) && <p className={`plugin-status ${pluginStatus.find((x) => x.id === p.id)!.error ? "error" : "ok"}`}>{pluginStatus.find((x) => x.id === p.id)!.error ?? `Tools: ${pluginStatus.find((x) => x.id === p.id)!.tools.join(", ") || "none"}`}</p>}
          </div>
        ))}
        <div className="row">
          <button className="btn" type="button" disabled={servers.length >= 12} onClick={() => set("plugins", { ...draft.plugins, servers: [...servers, { id: "", name: "", url: "", enabled: true, trustReadOnly: false } as PluginServer] })}><Plus size={14} aria-hidden="true" /> Add plugin</button>
          <button
            className="primary"
            type="button"
            onClick={async () => {
              try {
                const next = await saveSettings({ labs: { plugins: draft.plugins } });
                for (const p of next.labs.plugins.servers) {
                  const t = pluginTokens[p.id] ?? pluginTokens[p.name];
                  if (t) await secret(`plugin.${p.id}`, t.trim());
                }
                onSaved(next);
                setPluginTokens({});
                setTimeout(async () => setPluginStatus((await engineCall<typeof pluginStatus>("plugins.refresh").catch(() => null)) ?? []), 1500);
                toast("Plugins saved", "Connecting to list their tools…", "info");
              } catch (e) {
                toast("Not saved", e instanceof SettingsError ? e.message : String(e), "error");
              }
            }}
          >
            Save and connect
          </button>
        </div>
      </Lab>

      <Lab title="Sandboxed shell" about="Engineering can run commands inside your operating system's sandbox (macOS sandbox-exec, Linux bubblewrap). They can only change files in the workspace folder, cannot read the rest of your home folder, keys or keychain, and have no network. Read-only commands run; commands that change files follow your approval preset; installs, clones and downloads always ask and get the undo window. sudo, keychain access, remote shells, piped installers and similar are blocked. Not available on Windows." on={!!L.shell?.enabled} onToggle={(v) => save({ shell: { ...(draft.shell ?? { workspace: "~/deck-workspace" }), enabled: v } })}>
        <label className="field">
          Workspace folder (a dedicated folder; created if missing)
          <input value={draft.shell?.workspace ?? "~/deck-workspace"} onChange={(e) => set("shell", { ...(draft.shell ?? { enabled: false }), workspace: e.target.value } as Labs["shell"])} spellCheck={false} />
        </label>
        <button className="btn" type="button" onClick={() => save({ shell: draft.shell }, "Workspace saved")}>Save</button>
      </Lab>

      <Lab title="Isolated browser" about="Research and the Chief of Staff can browse with Chrome, Chromium, Edge or Brave using a separate, empty profile: none of your cookies, logins or passwords, no extensions, downloads off. Pages on this computer or your local network are blocked, including their images and scripts. Reading and following links run freely; typing follows your approval preset; anything that buys, sends, posts, submits or deletes always asks and gets the undo window, and is refused if the page changed since you approved. Password and payment fields are never filled." on={!!L.browser?.enabled} onToggle={(v) => save({ browser: { ...(draft.browser ?? { chromePath: "", visible: false }), enabled: v } })}>
        <label className="field">
          Browser path (leave empty to find Chrome, Chromium, Edge or Brave)
          <input value={draft.browser?.chromePath ?? ""} onChange={(e) => set("browser", { ...(draft.browser ?? { enabled: false, visible: false }), chromePath: e.target.value } as Labs["browser"])} placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" spellCheck={false} />
        </label>
        <label className="check">
          <input type="checkbox" checked={!!draft.browser?.visible} onChange={(e) => save({ browser: { ...(draft.browser ?? { enabled: false, chromePath: "" }), visible: e.target.checked } })} /> Show the browser window while it works
        </label>
        <button className="btn" type="button" onClick={() => save({ browser: draft.browser }, "Browser saved")}>Save</button>
      </Lab>

      <Lab title="Agent pull requests (GitHub)" about="Engineering can read one repository and propose changes as pull requests on a new branch, labelled agent-proposal. Opening one always asks you first. It can never merge. Use a fine-grained token limited to that repository with contents and pull requests access." on={L.github.enabled} onToggle={(v) => save({ github: { ...draft.github, enabled: v } })}>
        <label className="field">
          Repository
          <input value={draft.github.repo} onChange={(e) => set("github", { ...draft.github, repo: e.target.value })} placeholder="owner/name" spellCheck={false} />
        </label>
        <label className="field">
          Token {gh.hint && <span className="muted">(saved, ends in {gh.hint})</span>}
          <input type="password" value={gh.token} onChange={(e) => setGh({ ...gh, token: e.target.value })} placeholder={gh.hint ? "Paste a new token to replace it" : "github_pat_…"} autoComplete="off" />
        </label>
        <button className="btn" type="button" onClick={async () => { if (gh.token.trim()) await secret("tool.github", gh.token.trim()); await save({ github: draft.github }, "GitHub saved"); setGh({ token: "", hint: await hint("tool.github") }); }}>Save</button>
      </Lab>

      <Lab title="Gmail and Calendar" about="The Chief of Staff can search and read your mail and calendar (as untrusted content) and save Gmail drafts after you approve. It cannot send: deck never asks Google for send permission. Needs your own Google Cloud OAuth client (type: Desktop app)." on={L.google.enabled} onToggle={(v) => save({ google: { ...draft.google, enabled: v } })}>
        <label className="field">
          Client id
          <input value={draft.google.clientId} onChange={(e) => set("google", { ...draft.google, clientId: e.target.value })} placeholder="1234-abc.apps.googleusercontent.com" spellCheck={false} />
        </label>
        <label className="field">
          Client secret {google.hint && <span className="muted">(saved, ends in {google.hint})</span>}
          <input type="password" value={google.secret} onChange={(e) => setGoogle({ ...google, secret: e.target.value })} autoComplete="off" />
        </label>
        <div className="row">
          <button className="btn" type="button" onClick={async () => { if (google.secret.trim()) await secret("google.client_secret", google.secret.trim()); await save({ google: draft.google }, "Saved"); setGoogle({ secret: "", hint: await hint("google.client_secret") }); }}>Save</button>
          <button className="primary" type="button" onClick={async () => { toast("Opening Google sign-in", "Finish in your browser, then come back.", "info"); try { toast("Google connected", (await engineCall<string>("google.connect")) ?? ""); } catch (e) { toast("Google sign-in failed", String(e).replace(/^Error: /, ""), "error"); } }}>Connect Google</button>
          <button className="btn" type="button" onClick={async () => { await engineCall("google.disconnect"); toast("Google disconnected"); }}>Disconnect</button>
        </div>
      </Lab>

      <Lab title="Federation (trusted crews on other computers)" about="Your crew can message crews on other computers you trust: a co-founder's deck, a teammate's. You add each one by swapping invite codes. Messages are signed and encrypted. Every message you send needs your approval, and when another crew asks something, you approve both letting the Chief of Staff draft an answer and the answer itself. Use it over a private network like your LAN or Tailscale." on={L.federation.enabled} onToggle={(v) => save({ federation: { ...draft.federation, enabled: v } })}>
        <div className="row">
          <label className="field">
            Your crew's name
            <input value={draft.federation.name} onChange={(e) => set("federation", { ...draft.federation, name: e.target.value })} placeholder="Nelson's deck" />
          </label>
          <label className="field">
            Port
            <input type="number" value={draft.federation.port} onChange={(e) => set("federation", { ...draft.federation, port: Number(e.target.value) })} />
          </label>
          <button className="btn" type="button" onClick={() => save({ federation: draft.federation }, "Saved")}>Save</button>
        </div>
        <label className="field">
          Address others reach you at (LAN IP or Tailscale name)
          <div className="row">
            <input value={fed.addr} onChange={(e) => setFed({ ...fed, addr: e.target.value })} placeholder="192.168.1.20" spellCheck={false} />
            <button className="btn" type="button" onClick={async () => { try { setFed({ ...fed, invite: (await engineCall<string>("federation.invite", { addr: fed.addr })) ?? "" }); } catch (e) { toast("No invite", String(e).replace(/^Error: /, ""), "error"); } }}>Make my invite</button>
          </div>
        </label>
        {fed.invite && <textarea readOnly rows={3} value={fed.invite} aria-label="Your invite code" onFocus={(e) => e.target.select()} />}
        <label className="field">
          Add a trusted crew (paste their invite)
          <div className="row">
            <input value={fed.code} onChange={(e) => setFed({ ...fed, code: e.target.value })} placeholder="deck-invite:…" spellCheck={false} />
            <button className="btn" type="button" onClick={async () => { try { await engineCall("federation.addPeer", { code: fed.code }); setFed({ ...fed, code: "", peers: (await engineCall<typeof fed.peers>("federation.peers")) ?? [] }); toast("Crew added"); } catch (e) { toast("Not added", String(e).replace(/^Error: /, ""), "error"); } }}>Add</button>
          </div>
        </label>
        <ul className="peers">
          {fed.peers.map((p) => (
            <li key={p.id}><b>{p.name}</b> <span className="muted mono">{p.addr} · {p.id}</span> <button className="icon-btn" type="button" aria-label={`Remove ${p.name}`} onClick={async () => { await engineCall("federation.removePeer", { id: p.id }); setFed({ ...fed, peers: fed.peers.filter((x) => x.id !== p.id) }); }}><Trash2 size={14} /></button></li>
          ))}
        </ul>
        <p className="muted">Messages appear in Crew chat under Federation.</p>
      </Lab>

      <Lab title="Camera tours" about="A Tour button on the deck flies through every station, pausing at each. Respects reduced motion." on={L.tours} onToggle={(v) => save({ tours: v })} />
      <Lab title="3D power-up screen" about="The start-up check as a 3D reactor that lights segment by segment, instead of the flat ring." on={L.powerUp3d} onToggle={(v) => save({ powerUp3d: v })} />
    </div>
  );
}
