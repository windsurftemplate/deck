import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { engineCall, onEngineEvent } from "../bridge";

type Pending = { id: string; summary: string; deadline: string };

/** Approved actions that leave the machine wait here for a moment, with an Undo button, before they run. */
export function UndoBar() {
  const [items, setItems] = useState<Pending[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    void engineCall<Pending[]>("actions.undos").then((x) => Array.isArray(x) && setItems(x)).catch(() => {});
    let off: (() => void) | undefined;
    void onEngineEvent((ev, data) => {
      const d = data as Pending & { undone?: boolean };
      if (ev === "undo") setItems((all) => [...all.filter((x) => x.id !== d.id), { id: d.id, summary: d.summary, deadline: d.deadline }]);
      if (ev === "undo.end") setItems((all) => all.filter((x) => x.id !== d.id));
    }).then((u) => (off = u));
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => {
      clearInterval(t);
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      {items.map((u) => {
        const left = Math.max(0, Math.ceil((Date.parse(u.deadline) - Date.now()) / 1000));
        return (
          <div key={u.id} className="undo-item">
            <span>
              <b>{u.summary}</b>
              <span className="muted"> runs in {left} s</span>
            </span>
            <button className="primary" type="button" onClick={async () => { await engineCall("actions.undo", { id: u.id }).catch(() => {}); setItems((all) => all.filter((x) => x.id !== u.id)); }}>
              <Undo2 size={14} aria-hidden="true" /> Undo
            </button>
          </div>
        );
      })}
    </div>
  );
}
