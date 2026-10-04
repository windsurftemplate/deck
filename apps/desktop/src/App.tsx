import { useEffect, useRef, useState } from "react";
import { Deck3D } from "./deck3d/Deck3D";
import { Search, PanelRight, PanelRightClose } from "lucide-react";
import { Nav, PAGES, type View } from "./ui/Nav";
import { Palette } from "./ui/Palette";
import { StatusBar } from "./ui/StatusBar";
import { Toaster, toast } from "./ui/toast";
import { Kbd } from "./ui/states";
import type { DeckStats } from "./deck3d/scene";
import { BrainView } from "./brain3d/BrainView";
import { CommandCenter } from "./pages/CommandCenter";
import { CrewChannel } from "./pages/CrewChannel";
import { Tools } from "./pages/Tools";
import { Automations } from "./pages/Automations";
import { Goals } from "./pages/Goals";
import { Board } from "./pages/Board";
import { ReviewNote, type Review } from "./ui/Review";
import { Help } from "./help/Help";
import { MicButton } from "./Voice";
import { HandsFree } from "./HandsFree";
import { notify, setNotifications } from "./notify";
import { SnapshotButton, attachFile, type Picture } from "./Camera";
import { PowerUp } from "./boot/PowerUp";
import { engineCall, listThreads, threadMessages, deleteThread, renameThread, type Thread } from "./bridge";
import { applyProposal, decideApproval, emergencyStop, listen, loadSettings, onEngineEvent, pendingApprovals, saveSettings, sendChat, type ActionRecord, type Approval, type Proposal } from "./bridge";
import { Onboarding } from "./onboarding/Onboarding";
import { SettingsPanel } from "./SettingsPanel";

type Line = { from: "you" | "agent" | "system"; text: string; typing?: boolean; proposal?: Proposal; approval?: Approval; actions?: ActionRecord[]; settled?: boolean };

export function App() {
  const [phase, setPhase] = useState<"boot" | "onboarding" | "shell">("boot");
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [cisoOn, setCisoOn] = useState(true);
  useEffect(() => {
    void loadSettings().then((x) => setCisoOn(x.ciso?.reviews !== false)).catch(() => {});
    let off: (() => void) | undefined;
    void onEngineEvent((ev, data) => {
      const a = data as Approval | undefined;
      if (ev === "approval" && a?.review) setReviews((r) => ({ ...r, [a.id]: a.review! }));
    }).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  const [labs3d, setLabs3d] = useState(false);
  const [tours, setTours] = useState(false);
  useEffect(() => void loadSettings().then((s) => (setLabs3d(!!s.labs?.powerUp3d), setTours(!!s.labs?.tours))).catch(() => {}), [phase]);
  const [stopped, setStopped] = useState(false);
  const [log, setLog] = useState<Line[]>([{ from: "system", text: "Chief of Staff is ready. Ask anything, or open Settings to add keys." }]);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [crew, setCrew] = useState<Record<string, { status: string; task?: string }>>({});
  const [pending, setPending] = useState<Approval[]>([]);
  const [signal, setSignal] = useState<{ beam?: string; archive?: number; visit?: string }>({});

  const [view, setView] = useState<View>("3d");
  const [voiceOn, setVoiceOn] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [handsFree, setHandsFree] = useState<{ on: boolean; word: string }>({ on: false, word: "deck" });
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [model, setModel] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [showChats, setShowChats] = useState(false);
  const threadRef = useRef<string | undefined>(undefined);
  threadRef.current = threadId;
  const refreshThreads = () => void listThreads().then(setThreads);
  const [stats, setStats] = useState<DeckStats | null>(null);
  useEffect(() => {
    if (view !== "3d") return;
    const load = () => void engineCall<DeckStats>("deck.stats").then((x) => x && typeof x.tokens === "number" && setStats(x)).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [view, crew, pending]);
  useEffect(refreshThreads, []);
  const openThread = async (id: string | undefined) => {
    setThreadId(id);
    setShowChats(false);
    if (!id) return setLog([{ from: "system", text: "New chat. Ask anything." }]);
    const msgs = await threadMessages(id);
    setLog(msgs.map((m) => ({ from: m.role === "owner" ? "you" : "agent", text: m.text })));
  };
  const [attachErr, setAttachErr] = useState<string | null>(null);
  useEffect(() => void loadSettings().then((s) => (setView(s.world.view), setVoiceOn(s.voice.enabled), setSpeak(s.voice.speakReplies), setCameraOn(s.camera.enabled), setHandsFree({ on: s.voice.enabled && s.voice.handsFree, word: s.voice.wakeWord }), setNotifications(s.notifications.enabled), setModel(s.models.heavy.model === "auto" ? "OpenAI auto-pick" : s.models.heavy.model))), [showSettings]);
  /** Sends a message to the Chief of Staff and resolves with the reply (used by the box and by hands-free voice). */
  const sendMessage = async (text: string, speakIt: boolean): Promise<string> => {
    const pics = pictures;
    setLog((l) => [...l, { from: "you", text: pics.length ? `${text} (${pics.length} picture${pics.length > 1 ? "s" : ""})` : text }, { from: "agent", text: "", typing: true }]);
    setDraft("");
    setPictures([]);
    setBusy(true);
    setCrew((c) => ({ ...c, "chief-of-staff": { status: "running", task: "Answering you" } }));
    const r = await sendChat(text, pics.map(({ mediaType, data }) => ({ mediaType, data })), threadRef.current);
    if (r.threadId && r.threadId !== threadRef.current) setThreadId(r.threadId);
    setCrew((c) => ({ ...c, "chief-of-staff": { status: "done", task: "" } }));
    setBusy(false);
    if (speakIt && speak && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(r.reply.slice(0, 1200)));
    setLog((l) => [...l.filter((x) => !x.typing), { from: "agent", text: r.reply, ...(r.proposal ? { proposal: r.proposal } : {}), ...(r.actions?.length ? { actions: r.actions.filter((a) => a.status !== "waiting") } : {}) }]);
    void notify("Chief of Staff", r.reply);
    return r.reply;
  };

  const switchView = async (next: View) => {
    setView(next);
    // The station, brain and list views are remembered; the other pages open from the header.
    if (next === "3d" || next === "brain" || next === "list") await saveSettings({ world: { view: next } }).catch(() => {});
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
      if (event === "approval" && (data as Approval).status === "pending") void notify("Needs your approval", (data as Approval).summary);
      if (event === "automation") toast(`Automation: ${(data as { name: string }).name}`, String((data as { result?: string }).result ?? "").slice(0, 160), "info");
      if (event === "notify") void notify((data as { title: string }).title, (data as { body: string }).body);
      if (event === "security") void notify("Security alert", "Agents were stopped. Open deck to see why.");
      if (event === "learning") void notify("Learning report", String((data as { report?: string }).report ?? ""));
      if (event === "chat.delta") {
        const d = data as { threadId: string; delta: string };
        // Text arrives word by word; it goes into the reply that is being written.
        setLog((l) => {
          const i = l.findIndex((x) => x.typing);
          if (i < 0) return l;
          const next = [...l];
          next[i] = { ...next[i]!, from: "agent", text: (next[i]!.text === "" ? "" : next[i]!.text) + d.delta };
          return next;
        });
      }
      if (event === "threads") refreshThreads();
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

  // Keyboard: ⌘K search, ⌘1-7 pages, ⌘N new chat, ⌘J chat panel, ⌘, settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const page = PAGES.find((p) => p.key && p.key === k);
      if (k === "k") (e.preventDefault(), setPaletteOpen((v) => !v));
      else if (page) (e.preventDefault(), setShowSettings(false), void switchViewRef.current(page.id));
      else if (k === "n") (e.preventDefault(), void openThreadRef.current(undefined), setChatOpen(true));
      else if (k === "j") (e.preventDefault(), setChatOpen((v) => !v));
      else if (k === ",") (e.preventDefault(), setShowSettings((v) => !v));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const switchViewRef = useRef<(v: View) => Promise<void>>(async () => {});
  const openThreadRef = useRef<(id: string | undefined) => Promise<void>>(async () => {});

  if (phase === "boot") return <PowerUp threeD={labs3d} onDone={() => loadSettings().then((s) => setPhase(s.onboarding.done ? "shell" : "onboarding"))} />;
  if (phase === "onboarding") return <Onboarding onDone={() => setPhase("shell")} />;

  const stopAll = async () => {
    await emergencyStop();
    setStopped(true);
    setLog((l) => [...l, { from: "system", text: "All agents stopped." }]);
    toast("All agents stopped", "Pending approvals were rejected. Resume from the sidebar when ready.", "info");
  };
  const resumeAll = async () => {
    await engineCall("resume").catch(() => {});
    setStopped(false);
    toast("Agents resumed");
  };
  switchViewRef.current = switchView;
  openThreadRef.current = openThread;
  const title = showSettings ? "Settings" : (PAGES.find((p) => p.id === view)?.label ?? "Deck");

  return (
    <div className={`app ${navCollapsed ? "nav-min" : ""} ${chatOpen ? "" : "no-chat"}`}>
      <Nav view={view} onView={(v) => (setShowSettings(false), void switchView(v))} onSettings={() => setShowSettings((v) => !v)} settingsOpen={showSettings} collapsed={navCollapsed} onCollapse={() => setNavCollapsed((v) => !v)} stopped={stopped} onStop={stopAll} onResume={resumeAll} waiting={pending.length} />
      <div className="content">
      <header className="topbar">
        <h1 className="page-title">{title}</h1>
        <button type="button" className="search-btn" onClick={() => setPaletteOpen(true)}>
          <Search size={14} aria-hidden="true" />
          <span>Search or jump to</span>
          <Kbd>{/Mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
        <button type="button" className="icon-btn" aria-label={chatOpen ? "Hide chat" : "Show chat"} title={chatOpen ? "Hide chat (⌘J)" : "Show chat (⌘J)"} onClick={() => setChatOpen((v) => !v)}>
          {chatOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
        </button>
      </header>
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
      <div className={`main ${view !== "list" ? "with-deck" : ""}`}>
        {view === "brain" ? (
          <BrainView />
        ) : view === "center" ? (
          <CommandCenter go={(t) => (t === "settings" ? setShowSettings(true) : t === "learn" ? void engineCall<string>("learn.now").then((r) => toast("Learning finished", r ?? undefined)) : (setShowSettings(false), void switchView(t as View)))} />
        ) : view === "channel" ? (
          <CrewChannel />
        ) : view === "help" ? (
          <Help />
        ) : view === "board" ? (
          <Board />
        ) : view === "goals" ? (
          <Goals />
        ) : view === "automations" ? (
          <Automations />
        ) : view === "tools" ? (
          <Tools openSettings={() => setShowSettings(true)} openBrain={() => switchView("brain")} />
        ) : view === "3d" ? (
          <Deck3D
            tours={tours}
            onOpenBrain={() => switchView("brain")}
            stats={stats}
            state={{ crew, pending, stopped }}
            signal={{ ...(signal.beam ? { beam: signal.beam.split("#")[0]! } : {}), ...(signal.archive ? { archive: signal.archive } : {}), ...(signal.visit ? { visit: signal.visit } : {}) }}
            onDecide={async (id, approve) => {
              const msg = await decideApproval(id, approve);
              toast(approve ? "Approved" : "Rejected", msg.replace(/^(Approved|Rejected): /, ""), approve ? "success" : "info");
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
          <div className="chat-head">
            <h2>{threads.find((t) => t.id === threadId)?.title ?? "New chat"}</h2>
            <div className="row">
              <button className="btn" type="button" onClick={() => (setShowChats((v) => !v), refreshThreads())} aria-expanded={showChats}>
                Chats
              </button>
              <button className="btn" type="button" onClick={() => openThread(undefined)}>
                New chat
              </button>
            </div>
          </div>
          {showChats && (
            <ul className="threads" aria-label="Past chats">
              {threads.length === 0 && <li className="muted">No saved chats yet.</li>}
              {threads.map((t) => (
                <li key={t.id} className={t.id === threadId ? "on" : ""}>
                  <button type="button" className="thread" onClick={() => openThread(t.id)}>
                    {t.title}
                    <span className="muted">{t.updatedAt.slice(0, 10)}</span>
                  </button>
                  <button type="button" className="btn" aria-label={`Rename ${t.title}`} onClick={async () => { const n = prompt("Rename chat", t.title); if (n) { await renameThread(t.id, n); refreshThreads(); } }}>
                    Rename
                  </button>
                  <button type="button" className="btn" aria-label={`Delete ${t.title}`} onClick={async () => { if (confirm(`Delete "${t.title}"? Memory keeps what the crew learned.`)) { await deleteThread(t.id); if (t.id === threadId) void openThread(undefined); refreshThreads(); } }}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="log" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className={`msg ${l.from}`}>
                {l.from === "you" ? "You: " : ""}
                {l.typing && !l.text ? (
                  <span className="dots" role="status" aria-label="Writing a reply">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  l.text
                )}
                {l.actions && l.actions.length > 0 && (
                  <ul className="actions-done">
                    {l.actions.map((a, k) => (
                      <li key={k} className={a.status}>
                        {a.status === "done" ? "Did" : a.status === "denied" ? "Not allowed" : "Failed"}: {a.summary}
                      </li>
                    ))}
                  </ul>
                )}
                {l.approval && !l.settled && <ReviewNote review={reviews[l.approval.id] ?? l.approval.review} waiting={cisoOn} />}
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
              void sendMessage(draft.trim(), true);
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
            {handsFree.on && <HandsFree wakeWord={handsFree.word} busy={busy} onRequest={(t) => sendMessage(t, false)} />}
            {voiceOn && <MicButton onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} />}
            <button className="btn" type="submit">Send</button>
          </form>
        </section>
      </div>
      )}
      </div>
      <StatusBar stopped={stopped} model={model} tokens={stats?.tokens ?? 0} cap={stats?.tokenCap ?? 1} waiting={pending.length} micOn={false} onWaiting={() => (setShowSettings(false), void switchView("3d"))} />
      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onView={(v) => (setShowSettings(false), void switchView(v))}
        actions={{
          newChat: () => (void openThread(undefined), setChatOpen(true)),
          openThread: (id) => (void openThread(id), setChatOpen(true)),
          settings: () => setShowSettings(true),
          stop: stopAll,
          resume: resumeAll,
          stopped,
          toggleChat: () => setChatOpen((v) => !v),
          learn: () => void engineCall<string>("learn.now").then((r) => toast("Learning finished", r ?? undefined)).catch((e) => toast("Learning failed", String(e), "error")),
          tune: () => void (async () => { const out: string[] = []; for (const a of ["gtm", "ops", "code", "research"]) out.push((await engineCall<string>("learn.tune", { agent: a }).catch((e) => String(e))) ?? ""); toast("Prompt tuning finished", out.join(" "), "info"); })(),
          openDoc: () => (setShowSettings(false), void switchView("brain")),
        }}
      />
      <Toaster />
    </div>
  );
}
