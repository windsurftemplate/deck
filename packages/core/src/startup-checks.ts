export type CheckStatus = "ok" | "degraded" | "blocking" | "waiting" | "off";

export interface CheckResult {
  id: CheckId;
  name: string;
  status: CheckStatus;
  message: string;
  /** One concrete step the owner can take. */
  fix?: string;
}

export type CheckId =
  | "power" | "memory" | "keychain" | "gateway" | "connectors" | "skills" | "agents"
  | "scheduler" | "chat" | "world" | "models" | "decision" | "voice" | "clock";

/** A probe returns its own verdict. Probes are plain code, so results are exact; the agent only explains them. */
export type Probe = () => Promise<Omit<CheckResult, "id" | "name">>;

/** Boot order. Each segment lights in this order; dependents wait on their parents. */
export const CHECKS: { id: CheckId; name: string; dependsOn?: CheckId[] }[] = [
  { id: "clock", name: "Clock" },
  { id: "power", name: "Power" },
  { id: "memory", name: "Memory", dependsOn: ["keychain"] },
  { id: "keychain", name: "Keychain" },
  { id: "gateway", name: "Gateway", dependsOn: ["clock"] },
  { id: "connectors", name: "Connectors", dependsOn: ["gateway", "keychain"] },
  { id: "skills", name: "Skills" },
  { id: "agents", name: "Agents" },
  { id: "scheduler", name: "Scheduler" },
  { id: "chat", name: "Chat", dependsOn: ["keychain"] },
  { id: "world", name: "World" },
  { id: "models", name: "Models", dependsOn: ["gateway"] },
  { id: "decision", name: "Decision models", dependsOn: ["models"] },
  { id: "voice", name: "Voice and vision" },
];

/** Keychain must be read before memory can be decrypted, so it runs first despite its display order. */
function runOrder() {
  const done = new Set<CheckId>();
  const out: typeof CHECKS = [];
  const visit = (c: (typeof CHECKS)[number]) => {
    if (done.has(c.id)) return;
    for (const d of c.dependsOn ?? []) visit(CHECKS.find((x) => x.id === d)!);
    done.add(c.id);
    out.push(c);
  };
  CHECKS.forEach(visit);
  return out;
}

export async function runStartupChecks(probes: Partial<Record<CheckId, Probe>>, onResult?: (r: CheckResult) => void): Promise<CheckResult[]> {
  const results = new Map<CheckId, CheckResult>();
  for (const c of runOrder()) {
    const blockedBy = (c.dependsOn ?? []).filter((d) => ["blocking", "waiting"].includes(results.get(d)!.status));
    let r: CheckResult;
    if (blockedBy.length) {
      const names = blockedBy.map((d) => results.get(d)!.name).join(", ");
      r = { id: c.id, name: c.name, status: "waiting", message: `Waiting on ${names}.` };
    } else if (!probes[c.id]) {
      r = { id: c.id, name: c.name, status: "off", message: "Not enabled." };
    } else {
      try {
        r = { id: c.id, name: c.name, ...(await probes[c.id]!()) };
      } catch (err) {
        r = { id: c.id, name: c.name, status: "blocking", message: `Check crashed: ${(err as Error).message}`, fix: "Restart the app. If it repeats, send the diagnostics report." };
      }
    }
    results.set(c.id, r);
    onResult?.(r);
  }
  return CHECKS.map((c) => results.get(c.id)!);
}

export interface Readiness {
  canStart: boolean;
  blocking: CheckResult[];
  degraded: CheckResult[];
}

export function summarize(results: CheckResult[]): Readiness {
  const blocking = results.filter((r) => r.status === "blocking");
  return { canStart: blocking.length === 0, blocking, degraded: results.filter((r) => r.status === "degraded") };
}

/** Clock probe: token expiry depends on a correct clock. Compares local time with a trusted server's Date header. */
export function clockProbe(serverTime: () => Promise<Date>, now: () => Date = () => new Date(), maxSkewMs = 120_000): Probe {
  return async () => {
    const skew = Math.abs((await serverTime()).getTime() - now().getTime());
    return skew <= maxSkewMs
      ? { status: "ok", message: "Clock in sync." }
      : { status: "blocking", message: `Clock is off by ${Math.round(skew / 1000)} seconds.`, fix: "Turn on automatic date and time in system settings." };
  };
}

/** Disk probe: memory needs room to grow. */
export function diskProbe(freeBytes: () => Promise<number>, minBytes = 1_000_000_000): Probe {
  return async () => {
    const free = await freeBytes();
    const gb = (free / 1e9).toFixed(1);
    return free >= minBytes ? { status: "ok", message: `${gb} GB free.` } : { status: "degraded", message: `Only ${gb} GB free.`, fix: "Free up disk space; memory needs at least 1 GB." };
  };
}
