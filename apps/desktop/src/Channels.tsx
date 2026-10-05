import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import type { Settings } from "@deck/settings";
import { channelTokenHint, removeChannelToken, restartChannels, saveChannelToken, saveSettings, type ChannelTokenName } from "./bridge";
import { toast } from "./ui/toast";

const SLACK_MANIFEST = JSON.stringify(
  {
    display_information: { name: "deck", description: "Your local AI crew" },
    features: { bot_user: { display_name: "deck", always_online: false }, app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
    oauth_config: { scopes: { bot: ["chat:write", "im:history", "im:read", "im:write"] } },
    settings: { event_subscriptions: { bot_events: ["message.im"] }, interactivity: { is_enabled: true }, socket_mode_enabled: true, org_deploy_enabled: false, token_rotation_enabled: false },
  },
  null,
  2,
);

function TokenField({ name, label, placeholder, onSaved }: { name: ChannelTokenName; label: string; placeholder: string; onSaved?: (token: string) => void }) {
  const [v, setV] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => void channelTokenHint(name).then(setHint).catch(() => {}), [name]);
  return (
    <div className="row">
      <label className="field grow">
        {label} {hint && <span className="ok">saved, ends in {hint}</span>}
        <input type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder={hint ? "Paste a new one to replace it" : placeholder} autoComplete="off" spellCheck={false} />
      </label>
      <button className="btn" type="button" disabled={!v.trim()} onClick={async () => { const err = await saveChannelToken(name, v); if (err) return toast("Not saved", err, "error"); onSaved?.(v.trim()); setV(""); setHint(await channelTokenHint(name)); toast("Saved to your keychain", label); }}>Save</button>
      {hint && <button className="btn" type="button" onClick={async () => { await removeChannelToken(name); setHint(null); }}>Remove</button>}
    </div>
  );
}

function OwnerIds({ value, placeholder, onSave }: { value: string[]; placeholder: string; onSave: (ids: string[]) => Promise<void> }) {
  const [v, setV] = useState(value.join(", "));
  return (
    <div className="row">
      <label className="field grow">
        Your user id (only you can talk to it)
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} spellCheck={false} />
      </label>
      <button className="btn" type="button" onClick={() => void onSave(v.split(/[,\s]+/).filter(Boolean))}>Save</button>
    </div>
  );
}

/** Settings: Slack and Discord as chat channels. Both connect outward, so nothing listens on your computer. */
export function ChannelsCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const slack = s.chat.slack ?? { enabled: false, ownerUserIds: [] };
  const discord = s.chat.discord ?? { enabled: false, ownerUserIds: [] };
  const [appId, setAppId] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof saveSettings>[0]) => {
    try {
      onSaved(await saveSettings(patch));
      restartChannels();
    } catch (e) {
      toast("Not saved", String(e).replace(/^Error: /, ""), "error");
    }
  };
  return (
    <div className="card channels">
      <h3>Slack and Discord</h3>
      <p className="muted">Talk to your Chief of Staff from Slack or Discord, get approval cards with Approve, Reject and Undo buttons, and the morning brief. Both connect outward from your computer, so no port is opened. Only direct messages from your own user id are answered; everyone else, every channel and every other bot is ignored. Commands start with ! (for example !brief, !approve id); anything else goes to the Chief of Staff.</p>

      <h4>Slack</h4>
      <details>
        <summary>Set up in about 3 minutes</summary>
        <ol className="steps">
          <li>Go to api.slack.com/apps, choose <b>Create New App</b>, then <b>From an app manifest</b>, pick your workspace, and paste this manifest:
            <div className="row"><button className="btn small" type="button" onClick={() => navigator.clipboard.writeText(SLACK_MANIFEST).then(() => toast("Manifest copied", "Paste it into Slack."))}><Copy size={12} aria-hidden="true" /> Copy manifest</button></div>
          </li>
          <li>Install the app to your workspace, then copy the <b>Bot User OAuth Token</b> (xoxb-) from OAuth & Permissions.</li>
          <li>In Basic Information, under App-Level Tokens, generate a token with the <b>connections:write</b> scope (xapp-).</li>
          <li>Your user id: in Slack, open your profile, the ⋮ menu, <b>Copy member ID</b>.</li>
        </ol>
      </details>
      <TokenField name="chat.slack.bot" label="Bot token" placeholder="xoxb-…" />
      <TokenField name="chat.slack.app" label="App-level token" placeholder="xapp-1-…" />
      <OwnerIds value={slack.ownerUserIds} placeholder="U0123ABCD" onSave={(ids) => save({ chat: { slack: { ownerUserIds: ids } } } as never)} />
      <label className="check"><input type="checkbox" checked={slack.enabled} onChange={(e) => save({ chat: { slack: { enabled: e.target.checked } } } as never)} /> Slack on</label>

      <h4>Discord</h4>
      <details>
        <summary>Set up in about 3 minutes</summary>
        <ol className="steps">
          <li>Go to discord.com/developers/applications, choose <b>New Application</b>, then <b>Bot</b>, then <b>Reset Token</b> and copy it. No privileged intents are needed.</li>
          <li>Paste the token below. An invite link appears: open it and add the bot to a private server of your own (Discord only lets bots message people they share a server with).</li>
          <li>Your user id: in Discord settings, Advanced, turn on <b>Developer Mode</b>, then right-click your name and <b>Copy User ID</b>.</li>
          <li>Send the bot a direct message: !help</li>
        </ol>
      </details>
      <TokenField name="chat.discord" label="Bot token" placeholder="MTA…" onSaved={(t) => { try { setAppId(atob(t.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))); } catch { setAppId(null); } }} />
      {appId && /^\d{15,21}$/.test(appId) && <p className="muted">Invite link: <a href={`https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=0`} target="_blank" rel="noreferrer">add the bot to your server</a> (no permissions requested).</p>}
      <OwnerIds value={discord.ownerUserIds} placeholder="123456789012345678" onSave={(ids) => save({ chat: { discord: { ownerUserIds: ids } } } as never)} />
      <label className="check"><input type="checkbox" checked={discord.enabled} onChange={(e) => save({ chat: { discord: { enabled: e.target.checked } } } as never)} /> Discord on</label>
    </div>
  );
}
