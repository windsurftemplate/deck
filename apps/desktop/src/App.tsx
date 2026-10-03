import { useEffect, useState } from "react";
import { Deck3D } from "./deck3d/Deck3D";
import { MicButton } from "./Voice";
import { SnapshotButton, attachFile, type Picture } from "./Camera";
import { PowerUp } from "./boot/PowerUp";
import { applyProposal, decideApproval, emergencyStop, listen, loadSettings, onEngineEvent, pendingApprovals, saveSettings, sendChat, type ActionRecord, type Approval, type Proposal } from "./bridge";
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
  const [pending, setPending] = useState<Approval[]>([]);
  const [signal, setSignal] = useState<{ beam?: string; archive?: number; visit?: string }>({});
  const [view, setView] = useState<"3d" | "list">("3d");
  const [voiceOn, setVoiceOn] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  useEffect(() => void loadSettings().then((s) => (setView(s.world.view), setVoiceOn(s.voice.enabled), setSpeak(s.voice.speakReplies), setCameraOn(s.camera.enabled))), [showSettings]);
  const switchView = async () => {
    const next = view === "3d" ? "list" : "3d";
    setView(next);
    await saveSettings({ world: { view: next } }).catch(() => {});
  };

  // Approvals and finished actions arrive from the engine at any time.
  useEffect(() => {
    let off = () => {};
    const addApproval = (a: Approval) => setLog((l) => (l.some((x) => x.approval?.id === a.id) ? l : [...l, { from: "system", text: `${({ "chief-of-staff": "Chief of Staff", gtm: "GTM", ops: "Operations", code: "Engineering", research: "Research" } as Record<string, string>)[a.agent] ?? a.agent} needs your approval: ${a.summary}`, approval: a }]));
    pendingApprovals().then((list) => (list.forEach(addApproval), setPending(list)));
    onEngineEvent((event, data) => {
      if (event === "approval") {
        const a = data as Approval;
        setPending((p) => (a.status === "pending" ? [...p.filter((x) => x.id !== a.id), a] : p.filter((x) => x.id !== a.id)));
        if (a.status === "approved") setSignal((s) => ({ ...s, beam: `${a.agent}#${a.id}` }));
        if (a.status === "pending") addApproval(a);
        else setLog((l) => l.map((x) => (x.approval?.id === a.id ? { ...x, settled: true } : x)));
      }
      if (event === "deck") {
        const d = data as { type: string; task?: { agent: string | null; status: string; title: string } };
        if ((d.type === "task.created" || d.type === "task.updated") && d.task?.agent) setCrew((c) => ({ ...c, [d.task!.agent!]: { status: d.task!.status, task: d.task!.title } }));
        // Handoffs on the deck: walk to Command to take a task (created) and to report (done or not finished).
        if (d.task?.agent && (d.type === "task.created" || ["done", "failed"].includes(d.task.status))) setSignal((s) => ({ ...s, visit: `${d.task!.agent}#${Date.now()}` }));
      }
      if (event === "security") {
        setStopped(true);
        setLog((l) => [...l, { from: "system", text: (data as { message: string }).message }]);
      }
      if (event === "learning" || event === "skill") setSignal((s) => ({ ...s, archive: Date.now() }));
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
          <button className="btn" type="button" onClick={switchView}>
            {view === "3d" ? "List view" : "3D view"}
          </button>
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
      <div className={`main ${view === "3d" ? "with-deck" : ""}`}>
        {view === "3d" ? (
          <Deck3D
            state={{ crew, pending, stopped }}
            signal={{ ...(signal.beam ? { beam: signal.beam.split("#")[0]! } : {}), ...(signal.archive ? { archive: signal.archive } : {}), ...(signal.visit ? { visit: signal.visit } : {}) }}
            onDecide={async (id, approve) => {
              const msg = await decideApproval(id, approve);
              setLog((l) => [...l, { from: "system", text: msg }]);
            }}
          />
        ) : (
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
        )}
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
          {(pictures.length > 0 || attachErr) && (
            <div className="thumbs" aria-label="Attached pictures">
              {pictures.map((p, i) => (
                <span key={i} className="thumb">
                  <img src={p.preview} alt={`Picture ${i + 1}`} />
                  <button type="button" className="btn" aria-label={`Remove picture ${i + 1}`} onClick={() => setPictures((ps) => ps.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </span>
              ))}
              {attachErr && <span className="error">{attachErr}</span>}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              const text = draft.trim();
              const pics = pictures;
              setLog((l) => [...l, { from: "you", text: pics.length ? `${text} (${pics.length} picture${pics.length > 1 ? "s" : ""})` : text }, { from: "system", text: "Thinking…" }]);
              setDraft("");
              setPictures([]);
              sendChat(text, pics.map(({ mediaType, data }) => ({ mediaType, data }))).then((r) => {
                if (speak && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(r.reply.slice(0, 1200)));
                return r;
              }).then((r) => setLog((l) => [...l.slice(0, -1), { from: "agent", text: r.reply, ...(r.proposal ? { proposal: r.proposal } : {}), ...(r.actions?.length ? { actions: r.actions.filter((a) => a.status !== "waiting") } : {}) }]));
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the Chief of Staff, or say: switch heavy work to Gemini" aria-label="Message" />
            {cameraOn && <SnapshotButton onPicture={(p) => setPictures((ps) => [...ps, p].slice(0, 3))} />}
            {cameraOn && (
              <label className="btn attach">
                Attach
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) attachFile(f).then((p) => (setAttachErr(null), setPictures((ps) => [...ps, p].slice(0, 3)))).catch((err) => setAttachErr((err as Error).message));
                  }}
                />
              </label>
            )}
            {voiceOn && <MicButton onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} />}
            <button className="btn" type="submit">Send</button>
          </form>
        </section>
      </div>
      )}
    </div>
  );
}
