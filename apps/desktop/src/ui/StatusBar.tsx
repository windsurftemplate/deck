import { Cpu, Gauge, Hourglass, Mic, Power } from "lucide-react";

/** One quiet line at the bottom: are agents running, which model, tokens today, what is waiting, is the mic on. */
export function StatusBar({ stopped, model, tokens, cap, waiting, micOn, onWaiting }: { stopped: boolean; model: string; tokens: number; cap: number; waiting: number; micOn: boolean; onWaiting: () => void }) {
  const pct = Math.min(100, (tokens / Math.max(1, cap)) * 100);
  return (
    <footer className="status" aria-label="Status">
      <span className={stopped ? "st-bad" : "st-good"}>
        <Power size={12} aria-hidden="true" /> {stopped ? "Agents stopped" : "Agents ready"}
      </span>
      {model && (
        <span>
          <Cpu size={12} aria-hidden="true" /> {model}
        </span>
      )}
      <span title={`${tokens.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} tokens today`}>
        <Gauge size={12} aria-hidden="true" /> <span className="num">{Math.round(pct)}%</span> of today's tokens
        <span className="status-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      </span>
      <button type="button" className={waiting ? "st-warn" : ""} onClick={onWaiting}>
        <Hourglass size={12} aria-hidden="true" /> <span className="num">{waiting}</span> waiting for you
      </button>
      {micOn && (
        <span className="st-bad">
          <Mic size={12} aria-hidden="true" /> Microphone on
        </span>
      )}
    </footer>
  );
}
