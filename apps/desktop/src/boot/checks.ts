/** Mirrors @deck/core startup checks. Results arrive from the sidecar; until it is wired, a local preview runs. */
export type CheckStatus = "ok" | "degraded" | "blocking" | "waiting" | "off" | "checking";
export interface CheckResult { id: string; name: string; status: CheckStatus; message: string; fix?: string }

export const SEGMENTS = ["power", "memory", "keychain", "gateway", "connectors", "skills", "agents", "scheduler", "chat", "world"] as const;
export const LABELS: Record<string, string> = { power: "Power", memory: "Memory", keychain: "Keychain", gateway: "VaultProof", connectors: "Connectors", skills: "Skills", agents: "Agents", scheduler: "Scheduler", chat: "Chat", world: "World", models: "Models" };

/** SVG arc for ring segment i of n, radius r around (180,180). */
export function arcPath(i: number, n: number, r = 150, gapDeg = 4): string {
  const span = 360 / n;
  const a0 = i * span + gapDeg / 2 - 90, a1 = (i + 1) * span - gapDeg / 2 - 90;
  const p = (a: number) => [180 + r * Math.cos((a * Math.PI) / 180), 180 + r * Math.sin((a * Math.PI) / 180)].map((v) => v.toFixed(1));
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`;
}

export const statusText = (s: CheckStatus) => ({ ok: "online", degraded: "degraded", blocking: "blocking", waiting: "waiting", off: "off", checking: "charging" })[s];

/** The core may ignite only when nothing is blocking and models answered. */
export const coreLit = (results: CheckResult[]) => results.some((r) => r.id === "models" && r.status === "ok") && !results.some((r) => r.status === "blocking");
