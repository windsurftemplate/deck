import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { SettingsError, type Settings } from "@deck/settings";
import { engineCall, saveSettings } from "./bridge";

/** Push-to-talk button. Records only while on (with a visible indicator), stops after 2 minutes, and puts the text in the message box for you to check before sending. */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && stop();
    addEventListener("keydown", esc);
    return () => (removeEventListener("keydown", esc), stop());
  }, []);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); // microphone off as soon as recording ends
        setState("working");
        try {
          const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const text = await engineCall<string>("voice.transcribe", { audio: btoa(bin) });
          if (text) onText(text);
          else setErr("Heard nothing. Try again a little closer to the mic.");
        } catch (e) {
          setErr(String(e));
        }
        setState("idle");
      };
      rec.current = r;
      r.start();
      setState("recording");
      timer.current = setTimeout(stop, 120_000);
    } catch {
      setErr("Microphone not available. Allow microphone access for deck in System Settings.");
    }
  };

  return (
    <>
      <button className={state === "recording" ? "danger" : "btn"} type="button" onClick={state === "recording" ? stop : start} disabled={state === "working"} aria-pressed={state === "recording"} aria-label={state === "recording" ? "Stop recording" : "Talk"}>
        {state === "recording" ? <><Square size={13} aria-hidden="true" /> Stop</> : state === "working" ? "Listening…" : <><Mic size={14} aria-hidden="true" /> Talk</>}
      </button>
      {state === "recording" && (
        <span className="mic-on" role="status">
          Microphone on
        </span>
      )}
      {err && <span className="error">{err}</span>}
    </>
  );
}

export function NotificationsCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  return (
    <div className="card">
      <h3>Notifications</h3>
      <p className="muted">When deck is in the background: approvals waiting for you, replies, automation results, learning reports and security alerts. macOS asks once for permission.</p>
      <label className="check">
        <input type="checkbox" checked={s.notifications.enabled} onChange={async (e) => onSaved(await saveSettings({ notifications: { enabled: e.target.checked } }))} />
        Show desktop notifications
      </label>
    </div>
  );
}

export function VoiceCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [on, setOn] = useState(s.voice.enabled);
  const [bin, setBin] = useState(s.voice.whisperBin);
  const [model, setModel] = useState(s.voice.modelPath);
  const [speak, setSpeak] = useState(s.voice.speakReplies);
  const [hands, setHands] = useState(s.voice.handsFree);
  const [word, setWord] = useState(s.voice.wakeWord);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try {
      onSaved(await saveSettings({ voice: { enabled: on, whisperBin: bin, modelPath: model, speakReplies: speak, handsFree: on && hands, wakeWord: word } }));
      setMsg({ ok: true, text: on ? "Saved. A Talk button appears next to Send." : "Saved. Voice is off." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SettingsError ? e.message : "Could not save." });
    }
  };
  return (
    <div className="card">
      <h3>Voice</h3>
      <p className="muted">Push-to-talk turns your speech into text on this machine with whisper.cpp; audio is deleted right after and never leaves your computer. Install whisper.cpp and ffmpeg (for example with Homebrew), download a model, then set the paths below. Telegram voice notes use the same setup.</p>
      <label className="field">
        whisper.cpp program
        <input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="/opt/homebrew/bin/whisper-cli" spellCheck={false} />
      </label>
      <label className="field">
        Model file
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="/Users/you/models/ggml-base.en.bin" spellCheck={false} />
      </label>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Turn on push-to-talk
      </label>
      <label className="check">
        <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
        Read the Chief of Staff's replies aloud (uses your computer's built-in voice)
      </label>
      <label className="check">
        <input type="checkbox" checked={hands} onChange={(e) => setHands(e.target.checked)} />
        Hands-free: a Hands-free button listens for the wake word, then takes your request and answers out loud
      </label>
      <label className="field">
        Wake word
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="deck" spellCheck={false} />
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
