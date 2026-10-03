import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CornerDownLeft, FileText, MessageSquarePlus, MessageSquareText, OctagonX, Play, Search, Settings, Sparkles, SlidersHorizontal, PanelRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { engineCall } from "../bridge";
import { PAGES, mod, type View } from "./Nav";

type Item = { id: string; group: string; label: string; hint?: string; icon: LucideIcon; run: () => void };

/** ⌘K: jump to any page, action, chat or document by typing. */
export function Palette({ open, onClose, onView, actions }: { open: boolean; onClose: () => void; onView: (v: View) => void; actions: { newChat: () => void; openThread: (id: string) => void; settings: () => void; stop: () => void; resume: () => void; stopped: boolean; toggleChat: () => void; learn: () => void; tune: () => void; openDoc: () => void } }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [docs, setDocs] = useState<{ id: number; title: string; kind: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setI(0);
    requestAnimationFrame(() => input.current?.focus());
    void engineCall<{ id: string; title: string }[]>("threads.list").then((t) => setThreads(t ?? [])).catch(() => {});
    void engineCall<{ id: number; title: string; kind: string }[]>("brain.documents").then((d) => setDocs(d ?? [])).catch(() => {});
  }, [open]);

  const all: Item[] = useMemo(() => [
    ...PAGES.map((p) => ({ id: `page-${p.id}`, group: "Go to", label: p.label, hint: `${mod}${p.key}`, icon: p.icon, run: () => onView(p.id) })),
    { id: "a-new", group: "Actions", label: "New chat", hint: `${mod}N`, icon: MessageSquarePlus, run: actions.newChat },
    { id: "a-chat", group: "Actions", label: "Show or hide the chat panel", hint: `${mod}J`, icon: PanelRight, run: actions.toggleChat },
    { id: "a-settings", group: "Actions", label: "Open settings", hint: `${mod},`, icon: Settings, run: actions.settings },
    { id: "a-learn", group: "Actions", label: "Run learning now", icon: Sparkles, run: actions.learn },
    { id: "a-tune", group: "Actions", label: "Tune prompts now", icon: SlidersHorizontal, run: actions.tune },
    { id: "a-doc", group: "Actions", label: "Add to the second brain", icon: BookOpen, run: actions.openDoc },
    actions.stopped ? { id: "a-resume", group: "Actions", label: "Resume agents", icon: Play, run: actions.resume } : { id: "a-stop", group: "Actions", label: "Stop all agents", icon: OctagonX, run: actions.stop },
    ...threads.slice(0, 50).map((t) => ({ id: `t-${t.id}`, group: "Chats", label: t.title, icon: MessageSquareText, run: () => actions.openThread(t.id) })),
    ...docs.slice(0, 200).map((d) => ({ id: `d-${d.id}`, group: "Second brain", label: d.title, hint: d.kind, icon: FileText, run: () => onView("brain") })),
  ], [threads, docs, actions, onView]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? all.filter((x) => x.label.toLowerCase().includes(t)) : all.filter((x) => x.group !== "Second brain").slice(0, 20);
    return list.slice(0, 40);
  }, [q, all]);
  if (!open) return null;
  const go = (it?: Item) => {
    if (!it) return;
    onClose();
    it.run();
  };
  let last = "";
  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search or jump to" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            placeholder="Search pages, actions, chats and documents"
            aria-label="Search"
            aria-controls="palette-list"
            aria-activedescendant={shown[i]?.id}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(shown.length - 1, x + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              if (e.key === "Enter") (e.preventDefault(), go(shown[i]));
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <ul id="palette-list" role="listbox">
          {shown.length === 0 && <li className="palette-none">Nothing matches "{q}".</li>}
          {shown.map((it, n) => {
            const head = it.group !== last ? (last = it.group) : null;
            return (
              <li key={it.id} role="presentation">
                {head && <div className="palette-group">{head}</div>}
                <button id={it.id} type="button" role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => go(it)}>
                  <it.icon size={15} aria-hidden="true" />
                  <span>{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                  {n === i && <CornerDownLeft size={13} className="palette-enter" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
