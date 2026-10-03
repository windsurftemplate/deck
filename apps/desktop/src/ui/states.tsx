import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Placeholder blocks shaped like the content that is loading. */
export function Skeleton({ w = "100%", h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

/** An empty screen that says what to do next, with one action. */
export function Empty({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <b>{title}</b>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/** A tiny trend line for a key number. */
export function Sparkline({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  const W = 120, H = 28;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const pts = values.map((v, i) => `${(i * W) / Math.max(1, values.length - 1)},${H - 2 - ((v - min) / (max - min || 1)) * (H - 4)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={pts} />
    </svg>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;
