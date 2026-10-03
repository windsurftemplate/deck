import { useEffect, useState } from "react";
import { PowerUp } from "./boot/PowerUp";
import { applyProposal, decideApproval, emergencyStop, listen, loadSettings, onEngineEvent, pendingApprovals, sendChat, type ActionRecord, type Approval, type Proposal } from "./bridge";
import { Onboarding } from "./onboarding/Onboarding";
import { SettingsPanel } from "./SettingsPanel";

type Line = { from: "you" | "agent" | "system"; text: string; proposal?: Proposal; approval?: Approval; actions?: ActionRecord[]; settled?: boolean };

export function App() {
  const [phase, setPhase] = useState<"boot" | "onboarding" | "shell">("boot");
  const [stopped, setStopped] = useState(false);
  const [log, setLog] = useState<Line[]>([{ from: "system", text: "Chief of Staff is ready. Ask anything, or open Settings to add keys." }]);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [crew, setCrew] = useState<Record<string, { status: string; task?: string }>>({});

  // Approvals and finished actions arrive from the engine at any time.
  useEffect(() => {
    let off = () => {};
    const addApproval = (a: Approval) => setLog((l) => (l.some((x) => x.approval?.id === a.id) ? l : [...l, { from: "system", text: `${a.agent === "chief-of-staff" ? "Chief of Staff" : a.agent} needs your approval: ${a.summary}`, approval: a }]));
    pendingApprovals().then((list) => list.forEach(addApproval));
    onEngineEvent((event, data) => {
      if (event === "approval") {
        const a = data as Approval;
        if (a.status === "pending") addApproval(a);
        else setLog((l) => l.map((x) => (x.approval?.id === a.id ? { ...x, settled: true } : x)));
      }
      if (event === "deck") {
        const d = data as { type: string; task?: { agent: string | null; status: string; title: string } };
        if ((d.type === "task.created" || d.type === "task.updated") && d.task?.agent) setCrew((c) => ({ ...c, [d.task!.agent!]: { status: d.task!.status, task: d.task!.title } }));
      }
      if (event === "security") {
        setStopped(true);
        setLog((l) => [...l, { from: "system", text: (data as { message: string }).message }]);
      }
      if (event === "learning") setLog((l) => [...l, { from: "system", text: `Learning: ${(data as { report: string }).report}` }]);
      if (event === "action") {
        const r = data as ActionRecord;
        setLog((l) => [...l, { from: "system", text: r.status === "done" ? `Done: ${r.summary}${r.result ? ` (${r.result})` : ""}` : r.status === "failed" ? `Failed: ${r.summary}: ${r.result ?? ""}` : `Not done: ${r.summary}` }]);
      }
    }).then((fn) => (off = fn));
    return () => off();
  }, []);

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
          {[
            ["chief-of-staff", "Chief of Staff", "Command"],
            ["gtm", "GTM", "Comms"],
            ["code", "Engineering", "Engineering"],
            ["ops", "Operations", "Operations"],
            ["research", "Research", "Science lab"],
          ].map(([id, name, station]) => {
            const c = crew[id!];
            const label = stopped ? "Stopped" : !c ? "Standby" : c.status === "running" ? `Working: ${c.task}` : c.status === "done" ? `Done: ${c.task}` : c.status === "failed" ? `Not finished: ${c.task}` : c.status;
            return (
              <div className={`member ${c?.status ?? ""}`} key={id}>
                {name} <span className="station">{station}</span>
                <div className="st">{label}</div>
              </div>
            );
          })}
        </aside>
        <section className="chat" aria-label="Chat with the Chief of Staff">
          <h2>Chat</h2>
          <div className="log" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className={`msg ${l.from}`}>
                {l.from === "you" ? "You: " : ""}
                {l.text}
                {l.actions && l.actions.length > 0 && (
                  <ul className="actions-done">
                    {l.actions.map((a, k) => (
                      <li key={k} className={a.status}>
                        {a.status === "done" ? "Did" : a.status === "denied" ? "Not allowed" : "Failed"}: {a.summary}
                      </li>
                    ))}
                  </ul>
                )}
                {l.approval && !l.settled && (
                  <div className="row proposal">
                    <button
                      className="primary"
                      type="button"
                      onClick={async () => {
                        const msg = await decideApproval(l.approval!.id, true);
                        setLog((all) => [...all.map((x, j) => (j === i ? { ...x, settled: true } : x)), { from: "system", text: msg }]);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        const msg = await decideApproval(l.approval!.id, false);
                        setLog((all) => [...all.map((x, j) => (j === i ? { ...x, settled: true } : x)), { from: "system", text: msg }]);
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {l.proposal && !l.settled && (
                  <div className="row proposal">
                    <button
                      className="primary"
                      type="button"
                      onClick={async () => {
                        const summary = await applyProposal(l.proposal!.id);
                        setLog((all) => [...all.map((x, j) => (j === i ? { ...x, settled: true } : x)), { from: "system", text: summary }]);
                      }}
                    >
                      Apply
                    </button>
                    <button className="btn" type="button" onClick={() => setLog((all) => [...all.map((x, j) => (j === i ? { ...x, settled: true } : x)), { from: "system", text: "Cancelled. Nothing changed." }])}>
                      Cancel
                    </button>
                  </div>
                )}
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
              sendChat(text).then((r) => setLog((l) => [...l.slice(0, -1), { from: "agent", text: r.reply, ...(r.proposal ? { proposal: r.proposal } : {}), ...(r.actions?.length ? { actions: r.actions.filter((a) => a.status !== "waiting") } : {}) }]));
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the Chief of Staff, or say: switch heavy work to Gemini" aria-label="Message" />
            <button className="btn" type="submit">Send</button>
          </form>
        </section>
      </div>
      )}
    </div>
  );
}
