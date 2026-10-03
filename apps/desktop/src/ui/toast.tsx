import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
type T = { id: number; tone: Tone; title: string; body?: string };
const subs = new Set<(t: T) => void>();
let n = 0;

/** Small confirmation that appears bottom right and fades after a few seconds. */
export function toast(title: string, body?: string, tone: Tone = "success") {
  const t = { id: ++n, tone, title, ...(body ? { body } : {}) };
  subs.forEach((f) => f(t));
}

export function Toaster() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => {
    const add = (t: T) => {
      setList((l) => [...l.slice(-3), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.tone === "error" ? 8000 : 4500);
    };
    subs.add(add);
    return () => void subs.delete(add);
  }, []);
  const Icon = { success: CheckCircle2, error: CircleAlert, info: Info };
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => {
        const I = Icon[t.tone];
        return (
          <div key={t.id} className={`toast ${t.tone}`}>
            <I size={16} aria-hidden="true" />
            <div>
              <b>{t.title}</b>
              {t.body && <p>{t.body}</p>}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
