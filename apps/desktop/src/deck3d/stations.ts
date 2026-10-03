/** Stations on the deck and which agent works at each. Pure data, shared by the scene and the panel. */
export type StationStatus = "working" | "needs" | "blocked" | "idle";

export interface Station {
  id: string;
  name: string;
  crew: string;
  /** Engine agent id this station shows, if any. */
  agent?: string;
  color: number;
  about: string;
}

export const STATIONS: Station[] = [
  { id: "command", name: "Command", crew: "Chief of Staff", agent: "chief-of-staff", color: 0x6fd6ff, about: "Plans the day, hands work to the crew, and keeps your approvals in one place." },
  { id: "comms", name: "Comms", crew: "GTM", agent: "gtm", color: 0xc59bff, about: "Lead notes, outreach drafts and follow-ups. Drafts only; nothing is sent without you." },
  { id: "engineering", name: "Engineering", crew: "Engineering", agent: "code", color: 0x7cf5b0, about: "Breaks engineering work into issues and records decisions." },
  { id: "operations", name: "Operations", crew: "Operations", agent: "ops", color: 0xffd27a, about: "Keeps the tracker tidy, drafts admin replies, tracks commitments." },
  { id: "science", name: "Science lab", crew: "Research", agent: "research", color: 0xff9dd2, about: "Web research with sources, and the weekly self-review of the crew." },
  { id: "archive", name: "Archive", crew: "Memory", color: 0x9fb7ff, about: "Encrypted memory: facts, past work and skills. Lights up when the crew learns." },
  { id: "core", name: "Reactor core", crew: "Models", color: 0xe9fbff, about: "The models in use. Glows while the crew works; dark when stopped." },
  { id: "vault", name: "Vault", crew: "Approvals", color: 0xff8f6b, about: "Every action that needs you waits here. Beams go out when you approve one." },
];

export const stationForAgent = (agent: string) => STATIONS.find((s) => s.agent === agent);

/** How an agent's task state and pending approvals map to a station's light. */
export function stationStatus(taskStatus: string | undefined, pending: number, stopped: boolean): StationStatus {
  if (stopped) return "idle";
  if (pending > 0) return "needs";
  if (taskStatus === "running") return "working";
  if (taskStatus === "failed") return "blocked";
  return "idle";
}

export const STATUS_TEXT: Record<StationStatus, string> = { working: "Working", needs: "Needs you", blocked: "Not finished", idle: "Standby" };
export const STATUS_COLOR: Record<StationStatus, number> = { working: 0x6fd6ff, needs: 0xffc23d, blocked: 0xff5c5c, idle: 0x55546a };
