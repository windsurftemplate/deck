import { Bot, Boxes, BrainCircuit, CalendarClock, ChevronsLeft, ChevronsRight, LayoutDashboard, ListTree, MessagesSquare, OctagonX, Play, Settings, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type View = "3d" | "brain" | "center" | "channel" | "automations" | "tools" | "list";
export const PAGES: { id: View; label: string; icon: LucideIcon; key: string }[] = [
  { id: "3d", label: "Deck", icon: Boxes, key: "1" },
  { id: "brain", label: "Brain", icon: BrainCircuit, key: "2" },
  { id: "center", label: "Command center", icon: LayoutDashboard, key: "3" },
  { id: "channel", label: "Crew chat", icon: MessagesSquare, key: "4" },
  { id: "automations", label: "Automations", icon: CalendarClock, key: "5" },
  { id: "tools", label: "Tools", icon: Wrench, key: "6" },
  { id: "list", label: "List view", icon: ListTree, key: "7" },
];
const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Fixed left sidebar: pages, settings, and the stop switch. Collapses to icons. */
export function Nav({ view, onView, onSettings, settingsOpen, collapsed, onCollapse, stopped, onStop, onResume, waiting }: { view: View; onView: (v: View) => void; onSettings: () => void; settingsOpen: boolean; collapsed: boolean; onCollapse: () => void; stopped: boolean; onStop: () => void; onResume: () => void; waiting: number }) {
  return (
    <nav className={`side ${collapsed ? "collapsed" : ""}`} aria-label="Main">
      <div className="brand">
        <Bot size={18} aria-hidden="true" />
        {!collapsed && <span>deck</span>}
      </div>
      <ul>
        {PAGES.map((p) => {
          const on = view === p.id && !settingsOpen;
          return (
            <li key={p.id}>
              <button type="button" className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={`${p.label} (${mod}${p.key})`} onClick={() => onView(p.id)}>
                <p.icon size={16} aria-hidden="true" />
                {!collapsed && <span>{p.label}</span>}
                {!collapsed && p.id === "3d" && waiting > 0 && <span className="badge" aria-label={`${waiting} waiting for you`}>{waiting}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="side-foot">
        <button type="button" className={settingsOpen ? "on" : ""} aria-current={settingsOpen ? "page" : undefined} title={`Settings (${mod},)`} onClick={onSettings}>
          <Settings size={16} aria-hidden="true" />
          {!collapsed && <span>Settings</span>}
        </button>
        {stopped ? (
          <button type="button" className="resume" title="Let agents work again" onClick={onResume}>
            <Play size={16} aria-hidden="true" />
            {!collapsed && <span>Resume agents</span>}
          </button>
        ) : (
          <button type="button" className="stop" title="Stop every agent now" onClick={onStop}>
            <OctagonX size={16} aria-hidden="true" />
            {!collapsed && <span>Stop all agents</span>}
          </button>
        )}
        <button type="button" className="collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onCollapse}>
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
    </nav>
  );
}

export { mod };
