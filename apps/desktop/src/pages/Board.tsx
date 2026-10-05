import { useEffect, useMemo, useRef, useState } from "react";
import { Pin, RotateCcw, Search } from "lucide-react";
import { engineCall } from "../bridge";
import { Empty } from "../ui/states";

type Node = { id: string; label: string; type: string; kind?: string; size: number };
type Link = { source: string; target: string; label?: string };
type Graph = { nodes: Node[]; links: Link[]; facts: Record<string, string[]> };
type Pos = Record<string, { x: number; y: number }>;

const POS_KEY = "deck.board.positions";
const PIN: Record<string, string> = { owner: "#ff9a3d", subject: "#c59bff", doc: "#79a8ff" };
const loadPos = (): Pos => {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}");
  } catch {
    return {};
  }
};

/**
 * Investigation board: the people, companies, facts and documents in your second brain, pinned on a corkboard
 * with string between related items. Built only from what you saved; nothing is looked up.
 */
export function Board() {
  const [g, setG] = useState<Graph | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos>(loadPos);
  const [open, setOpen] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => void engineCall<Graph>("brain.graph").then((x) => setG(x && Array.isArray(x.nodes) && Array.isArray(x.links) ? { ...x, facts: x.facts ?? {} } : { nodes: [], links: [], facts: {} })).catch(() => setG({ nodes: [], links: [], facts: {} })), []);

  // What is on the board: the focus and everything within two links of it, or the most connected items.
  const shown = useMemo(() => {
    if (!g) return { nodes: [] as Node[], links: [] as Link[] };
    const deg = new Map<string, number>();
    for (const l of g.links) deg.set(l.source, (deg.get(l.source) ?? 0) + 1), deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    let ids: Set<string>;
    if (focus) {
      ids = new Set([focus]);
      for (let hop = 0; hop < 2; hop++) for (const l of g.links) if (ids.has(l.source) || ids.has(l.target)) ids.add(l.source), ids.add(l.target);
    } else ids = new Set([...g.nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0)).slice(0, 30).map((n) => n.id));
    const nodes = g.nodes.filter((n) => ids.has(n.id)).slice(0, 40);
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, links: g.links.filter((l) => keep.has(l.source) && keep.has(l.target)) };
  }, [g, focus]);

  // Default spot for anything not moved yet: rings around the centre (focus in the middle).
  const at = (id: string, i: number): { x: number; y: number } => {
    if (pos[id]) return pos[id]!;
    if (id === focus) return { x: 520, y: 320 };
    const ring = i < 8 ? 0 : i < 22 ? 1 : 2;
    const inRing = ring === 0 ? 8 : ring === 1 ? 14 : 18;
    const k = ring === 0 ? i : ring === 1 ? i - 8 : i - 22;
    const a = (k / inRing) * Math.PI * 2 + ring * 0.4;
    const r = 170 + ring * 140;
    return { x: 520 + Math.cos(a) * r * 1.35, y: 320 + Math.sin(a) * r * 0.8 };
  };
  const place = new Map(shown.nodes.map((n, i) => [n.id, at(n.id, n.id === focus ? 0 : i)]));

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !board.current) return;
    const b = board.current.getBoundingClientRect();
    const x = e.clientX - b.left + board.current.scrollLeft - drag.current.dx;
    const y = e.clientY - b.top + board.current.scrollTop - drag.current.dy;
    setPos((p) => ({ ...p, [drag.current!.id]: { x: Math.max(0, x), y: Math.max(0, y) } }));
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setPos((p) => {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(p));
      } catch {
        /* storage unavailable */
      }
      return p;
    });
  };

  if (!g) return <section className="page"><p className="muted">Loading the board…</p></section>;
  if (!g.nodes.length) return <section className="page"><Empty icon={Pin} title="Nothing to pin yet" hint="Tell the crew facts, add documents, or capture business cards. They appear here, connected." /></section>;

  const matches = q.trim().length >= 2 ? g.nodes.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const sel = open ? g.nodes.find((n) => n.id === open) : null;

  return (
    <section className="board-page" aria-label="Investigation board">
      <div className="board-bar">
        <label className="board-search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Focus on a person, company or document" aria-label="Focus the board" />
        </label>
        {matches.length > 0 && (
          <ul className="board-matches">
            {matches.map((m) => <li key={m.id}><button type="button" onClick={() => (setFocus(m.id), setQ(""), setOpen(m.id))}>{m.label}</button></li>)}
          </ul>
        )}
        {focus && <button className="btn" type="button" onClick={() => setFocus(null)}>Show the most connected</button>}
        <button className="btn" type="button" title="Put every card back in its default spot" onClick={() => (setPos({}), localStorage.removeItem(POS_KEY))}><RotateCcw size={14} aria-hidden="true" /> Tidy</button>
        <span className="muted">{shown.nodes.length} pinned · drag to arrange</span>
      </div>
      <div className="corkboard" ref={board} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
        <svg className="strings" width="1400" height="900" aria-hidden="true">
          {shown.links.map((l, i) => {
            const a = place.get(l.source), b = place.get(l.target);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2 + 80, my = (a.y + b.y) / 2 + 40 + Math.abs(a.x - b.x) * 0.06;
            return (
              <g key={i}>
                <path d={`M${a.x + 80},${a.y + 8} Q${mx},${my} ${b.x + 80},${b.y + 8}`} />
                {l.label && <text x={mx} y={my - 4}>{l.label}</text>}
              </g>
            );
          })}
        </svg>
        {shown.nodes.map((n) => {
          const p = place.get(n.id)!;
          const tilt = ((n.id.charCodeAt(n.id.length - 1) % 7) - 3) * 0.6;
          return (
            <button
              key={n.id}
              type="button"
              className={`pin-card ${n.type} ${n.id === focus ? "focus" : ""}`}
              style={{ left: p.x, top: p.y, transform: `rotate(${tilt}deg)` }}
              onPointerDown={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                drag.current = { id: n.id, dx: e.clientX - r.left, dy: e.clientY - r.top };
              }}
              onDoubleClick={() => setFocus(n.id)}
              onClick={() => setOpen(n.id)}
              aria-label={`${n.label}. Double-click to focus.`}
            >
              <span className="pushpin" style={{ background: PIN[n.type] ?? "#ff6b6b" }} aria-hidden="true" />
              <b>{n.label}</b>
              <span className="pin-kind">{n.type === "doc" ? n.kind ?? "document" : n.type === "owner" ? "you" : `${g.facts[n.id]?.length ?? 0} facts`}</span>
            </button>
          );
        })}
      </div>
      {sel && (
        <aside className="board-detail" aria-label={sel.label}>
          <header>
            <b>{sel.label}</b>
            <button className="icon-btn" type="button" aria-label="Close" onClick={() => setOpen(null)}>×</button>
          </header>
          {(g.facts[sel.id] ?? []).length > 0 ? <ul>{g.facts[sel.id]!.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="muted">{sel.type === "doc" ? "A document in your second brain. Open the Brain page to read it." : "No facts yet."}</p>}
          <p className="muted">Connected to: {g.links.filter((l) => l.source === sel.id || l.target === sel.id).map((l) => g.nodes.find((x) => x.id === (l.source === sel.id ? l.target : l.source))?.label).filter(Boolean).slice(0, 12).join(", ") || "nothing yet"}</p>
          <button className="btn" type="button" onClick={() => setFocus(sel.id)}>Focus on this</button>
        </aside>
      )}
    </section>
  );
}
