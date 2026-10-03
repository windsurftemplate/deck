import { useEffect, useState } from "react";
import { SettingsError, type Settings } from "@deck/settings";
import { botTokenHint, saveBotToken, saveSettings } from "./bridge";

export function EmbeddingsCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const pick = async (provider: "local" | "openai") => {
    const next = await saveSettings({ embeddings: { provider } });
    onSaved(next);
    setMsg(provider === "local" ? "Using the local model. Memory search is rebuilt on the next start." : "Using OpenAI. Needs an OpenAI key above. Memory search is rebuilt on the next start.");
  };
  return (
    <div className="card">
      <h3>Memory search</h3>
      <p className="muted">How memories are turned into searchable vectors. Switching rebuilds the search index; memories themselves are kept.</p>
      <label className="check">
        <input type="radio" name="emb" checked={s.embeddings.provider === "local"} onChange={() => pick("local")} />
        Local model: free and private, runs on this machine (downloads about 25 MB once)
      </label>
      <label className="check">
        <input type="radio" name="emb" checked={s.embeddings.provider === "openai"} onChange={() => pick("openai")} />
        OpenAI: uses your OpenAI key
      </label>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

export function TelegramCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [ids, setIds] = useState(s.chat.telegram.ownerChatIds.join(", "));
  const [on, setOn] = useState(s.chat.telegram.enabled);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    botTokenHint().then(setHint);
  }, []);

  const save = async () => {
    setMsg(null);
    if (token.trim()) {
      const err = await saveBotToken(token);
      setToken("");
      if (err) return setMsg({ ok: false, text: err });
      setHint(await botTokenHint());
    }
    try {
      const list = ids.split(/[\s,]+/).filter(Boolean).map(Number);
      const next = await saveSettings({ chat: { telegram: { ownerChatIds: list, enabled: on } } });
      onSaved(next);
      setMsg({ ok: true, text: on && !hint && !token ? "Saved. Add the bot token to start the bot." : "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SettingsError ? e.message : "Could not save." });
    }
  };

  return (
    <div className="card">
      <h3>Chat: Telegram</h3>
      <p className="muted">Talk to the crew from your phone. Create a bot with @BotFather, paste its token, and add your own chat id so only you are answered.</p>
      <div className="keyhead">
        <b>Bot token</b>
        <span className={hint ? "ok" : "muted"}>{hint ? `Saved, ends in ${hint}` : "Not set"}</span>
      </div>
      <input className="keyinput" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={hint ? "Paste a new token to replace it" : "123456789:AA…"} aria-label="Telegram bot token" autoComplete="off" spellCheck={false} />
      <label className="field">
        Your chat id (only these chats are answered)
        <input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="123456789" inputMode="numeric" />
      </label>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Turn on the Telegram bot
      </label>
      <div className="row">
        <button className="primary" type="button" onClick={save}>
          Save
        </button>
        {msg && <span className={msg.ok ? "ok" : "error"}>{msg.text}</span>}
      </div>
    </div>
  );
}
