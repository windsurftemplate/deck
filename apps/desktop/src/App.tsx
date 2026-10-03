import { useEffect, useState } from "react";
import { PowerUp } from "./boot/PowerUp";
import { emergencyStop, listen } from "./bridge";
import { SettingsPanel } from "./SettingsPanel";

type Line = { from: "you" | "agent" | "system"; text: string };

export function App() {
  const [phase, setPhase] = useState<"boot" | "shell">("boot");
  const [stopped, setStopped] = useState(false);
  const [log, setLog] = useState<Line[]>([{ from: "system", text: "Chief of Staff is on standby. The agent engine connects in the next build step." }]);
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

  if (phase === "boot") return <PowerUp onDone={() => setPhase("shell")} />;

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
              setLog((l) => [...l, { from: "you", text: draft.trim() }, { from: "system", text: "Saved. The Chief of Staff will answer once the engine is connected." }]);
              setDraft("");
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
