import { useEffect, useRef, useState } from "react";
import { engineCall, loadSettings, onEngineEvent } from "../bridge";
import { MessagesSquare } from "lucide-react";
import { Empty } from "../ui/states";
import { useCrew } from "../ui/crew";

type Msg = { id: number; ts: string; channel: string; sender: string; recipient: string; kind: string; text: string; taskId?: string };
type Discussion = { id: string; topic: string; agents: string[]; createdAt: string; status: string };
const WHO: Record<string, { name: string; color: string }> = {
  "chief-of-staff": { name: "Chief of Staff", color: "#6fd6ff" },
  gtm: { name: "GTM", color: "#c59bff" },
  ops: { name: "Operations", color: "#ffd27a" },
  code: { name: "Engineering", color: "#7cf5b0" },
  research: { name: "Research", color: "#ff9dd2" },
  ciso: { name: "CISO", color: "#ff8f6b" },
  verifier: { name: "Verifier", color: "#9fb7ff" },
  owner: { name: "You", color: "#ff9a3d" },
};
// Custom crew members get their name from the crew list and a steady color from their id.
const NAMES: Record<string, string> = {};
const tint = (id: string) => `hsl(${[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)} 70% 72%)`;
const who = (id: string) => {
  const h = id.match(/^helper:([^:]+):(\d+)$/);
  if (h) return { name: `Helper ${h[2]} (${WHO[h[1]!]?.name ?? NAMES[h[1]!] ?? h[1]})`, color: "#9aa3b5" };
  return WHO[id] ?? { name: NAMES[id] ?? id.replace(/_/g, " "), color: NAMES[id] ? tint(id) : "#8f8ab8" };
};
const KIND: Record<string, string> = { handoff: "Hands off", report: "Reports", tool: "Uses a tool", check: "Checks", approval: "Asks you", decision: "Decides", summary: "Sums up", topic: "Topic", note: "Note", thinking: "Thinks" };

/** Where the crew talks: the live feed of handoffs, tool use, reports, checks and approvals, plus discussions you start. */
export function CrewChannel() {
  const crewList = useCrew();
  for (const [id, n] of crewList) NAMES[id] = n;
  const CREW = crewList.map(([id]) => id).filter((id) => id !== "chief-of-staff");
  const [channel, setChannel] = useState("activity");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string[]>(["gtm", "ops", "code", "research"]);
  const [rounds, setRounds] = useState(2);
  const [say, setSay] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [voteOn, setVoteOn] = useState(false);
  const [mode, setMode] = useState<"discussion" | "vote">("discussion");
  useEffect(() => void loadSettings().then((s) => setVoteOn(!!s.labs?.consensus)), []);
  const end = useRef<HTMLDivElement>(null);
  const chRef = useRef(channel);
  chRef.current = channel;

  const loadDiscussions = () => void engineCall<Discussion[]>("crew.discussions").then((d) => setDiscussions(d ?? [])).catch(() => {});
  useEffect(loadDiscussions, []);
  useEffect(() => void engineCall<Msg[]>("crew.messages", { channel, limit: 300 }).then((m) => setMsgs(m ?? [])).catch(() => setMsgs([])), [channel]);
  useEffect(() => {
    let off: (() => void) | undefined;
    void onEngineEvent((event, data) => {
      if (event === "crew.message" && (data as Msg).channel === chRef.current) setMsgs((m) => [...m.slice(-499), data as Msg]);
      if (event === "crew.discussion") loadDiscussions();
    }).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* already gone */
      }
    };
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length]);

  const start = async () => {
    setErr(null);
    try {
      const r = mode === "vote" ? await engineCall<{ id: string }>("crew.vote", { question: topic, agents: picked }) : await engineCall<{ id: string }>("crew.discuss", { topic, agents: picked, rounds });
      if (r) (setChannel(`discussion:${r.id}`), setTopic(""), loadDiscussions());
      else setErr("Discussions run inside the desktop app.");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
    }
  };
  const disc = discussions.find((d) => `discussion:${d.id}` === channel);
  const shown = msgs.filter((m) => filter === "all" || m.sender === filter || m.recipient === filter);

  return (
    <section className="page channel" aria-label="Crew chat">
      <aside className="channel-side">
        <button type="button" className={`thread ${channel === "activity" ? "on" : ""}`} onClick={() => setChannel("activity")}>
          Live activity
          <span className="muted">handoffs, tools, reports</span>
        </button>
        <button type="button" className={`thread ${channel === "federation" ? "on" : ""}`} onClick={() => setChannel("federation")}>
          Federation
          <span className="muted">messages with trusted crews</span>
        </button>
        <h3>Discussions</h3>
        {discussions.length === 0 && <p className="muted">None yet. Start one below.</p>}
        {discussions.map((d) => (
          <button key={d.id} type="button" className={`thread ${channel === `discussion:${d.id}` ? "on" : ""}`} onClick={() => setChannel(`discussion:${d.id}`)}>
            {d.topic}
            <span className="muted">{d.status === "running" ? "talking…" : d.createdAt.slice(0, 10)}</span>
          </button>
        ))}
        <div className="card new-disc">
          <h3>Start a {mode === "vote" ? "vote" : "discussion"}</h3>
          {voteOn && (
            <div className="seg" role="group" aria-label="Kind">
              <button type="button" className={mode === "discussion" ? "on" : ""} aria-pressed={mode === "discussion"} onClick={() => setMode("discussion")}>Discussion</button>
              <button type="button" className={mode === "vote" ? "on" : ""} aria-pressed={mode === "vote"} onClick={() => setMode("vote")}>Vote</button>
            </div>
          )}
          <textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Should we build SSO before the Acme pilot?" aria-label="Discussion topic" />
          <fieldset>
            <legend className="muted">Who joins</legend>
            {CREW.map((a) => (
              <label key={a} className="check">
                <input type="checkbox" checked={picked.includes(a)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a] : p.filter((x) => x !== a)))} />
                {who(a).name}
              </label>
            ))}
          </fieldset>
          {mode === "discussion" && <label className="field">
            Rounds
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>}
          <button className="primary" type="button" disabled={!topic.trim() || !picked.length} onClick={start}>
            {mode === "vote" ? "Start vote" : "Start discussion"}
          </button>
          {err && <p className="error">{err}</p>}
          <p className="muted">{mode === "vote" ? "Each member answers on its own, then ranks the others; the Chief of Staff reports the winner and any dissent." : "Talk only: no tools, nothing is sent anywhere. The Chief of Staff sums up at the end."}</p>
        </div>
      </aside>

      <div className="channel-main">
        <div className="page-head">
          <h3>{disc ? disc.topic : "Live activity"}</h3>
          <label className="field inline">
            Show
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Everyone</option>
              {Object.entries(WHO).map(([id, w]) => (
                <option key={id} value={id}>{w.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="feed" aria-live="polite">
          {shown.length === 0 && (channel === "activity" ? <Empty icon={MessagesSquare} title="No crew activity yet" hint="When the Chief of Staff hands work to the crew, every handoff, tool call, report and check shows up here." /> : <p className="muted">Waiting for the first message…</p>)}
          {shown.map((m) => {
            const w = who(m.sender);
            const to = m.recipient === "crew" ? "" : who(m.recipient).name;
            return (
              <article key={m.id} className={`post ${m.kind}`}>
                <span className="avatar" style={{ background: w.color }} aria-hidden="true">{w.name[0]}</span>
                <div>
                  <header>
                    <b>{w.name}</b>
                    {m.kind !== "discussion" && <span className="kind">{KIND[m.kind] ?? m.kind}{to ? ` → ${to}` : ""}</span>}
                    <time className="muted">{m.ts.slice(11, 16)}</time>
                  </header>
                  <p>{m.text}</p>
                </div>
              </article>
            );
          })}
          {disc?.status === "running" && (
            <p className="muted"><span className="dots" aria-hidden="true"><i /><i /><i /></span> the crew is talking</p>
          )}
          <div ref={end} />
        </div>
        {disc && (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); if (say.trim()) void engineCall("crew.interject", { id: disc.id, text: say }).then(() => setSay("")); }}>
            <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Add to the discussion" aria-label="Add to the discussion" />
            <button className="btn" type="submit">Post</button>
          </form>
        )}
      </div>
    </section>
  );
}
