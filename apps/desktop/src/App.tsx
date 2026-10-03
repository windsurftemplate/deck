import { useEffect, useState } from "react";
import { PowerUp } from "./boot/PowerUp";
import { emergencyStop, listen, loadSettings, sendChat } from "./bridge";
import { Onboarding } from "./onboarding/Onboarding";
import { SettingsPanel } from "./SettingsPanel";

type Line = { from: "you" | "agent" | "system"; text: string };

export function App() {
  const [phase, setPhase] = useState<"boot" | "onboarding" | "shell">("boot");
  const [stopped, setStopped] = useState(false);
  const [log, setLog] = useState<Line[]>([{ from: "system", text: "Chief of Staff is ready. Ask anything, or open Settings to add keys." }]);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let off = () => {};
    listen("kill-all", () => {
      setStopped(true);
      setLog((l) => [...l, { from: "system", text: "Emergency stop from the tray. All agents stopped." }]);
    }).then((fn) => (off = fn));
    return () => off();
  }, []);

  if (phase === "boot") return <PowerUp onDone={() => loadSettings().then((s) => setPhase(s.onboarding.done ? "shell" : "onboarding"))} />;
  if (phase === "onboarding") return <Onboarding onDone={() => setPhase("shell")} />;

  const stopAll = async () => {
    await emergencyStop();
    setStopped(true);
    setLog((l) => [...l, { from: "system", text: "All agents stopped." }]);
  };

  return (
    <div className="shell">
      <header className="bar">
        <b>Command deck</b>
        <div className="row">
          <button className="btn" type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            Settings
          </button>
          <button className="danger" type="button" onClick={stopAll} disabled={stopped}>
            {stopped ? "Stopped" : "Stop all agents"}
          </button>
        </div>
      </header>
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
      <div className="main">
        <aside className="crew" aria-label="Crew">
          <h2>Crew</h2>
          <div className="member">
            Chief of Staff
            <div className="st">{stopped ? "Stopped" : "Standby"}</div>
          </div>
        </aside>
        <section className="chat" aria-label="Chat with the Chief of Staff">
          <h2>Chat</h2>
          <div className="log" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className={`msg ${l.from}`}>
                {l.from === "you" ? "You: " : ""}
                {l.text}
              </div>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              const text = draft.trim();
              setLog((l) => [...l, { from: "you", text }, { from: "system", text: "Thinking…" }]);
              setDraft("");
              sendChat(text).then((r) => setLog((l) => [...l.slice(0, -1), { from: "agent", text: r.reply }]));
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the Chief of Staff" aria-label="Message" />
            <button className="btn" type="submit">Send</button>
          </form>
        </section>
      </div>
      )}
    </div>
  );
}
