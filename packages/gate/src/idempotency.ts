import { createHash } from "node:crypto";

export interface IdempotencyStore {
  get(key: string): { result: string } | undefined;
  set(key: string, result: string): void;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, { result: string }>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, result: string) {
    this.m.set(k, { result });
  }
}

/** Stable key for a side effect: same task, tool and arguments means the same action. */
export function actionKey(taskId: string, tool: string, args: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify([taskId, tool, canon(args)])).digest("hex").slice(0, 32);
}

/** Runs a side effect at most once per key, so retries and restarts never double-send. Concurrent calls share one run. */
export class Idempotent {
  private inflight = new Map<string, Promise<string>>();
  constructor(private store: IdempotencyStore = new MemoryIdempotencyStore()) {}

  async run(key: string, fn: () => Promise<string>): Promise<{ result: string; replayed: boolean }> {
    const hit = this.store.get(key);
    if (hit) return { result: hit.result, replayed: true };
    const running = this.inflight.get(key);
    if (running) return { result: await running, replayed: true };
    const p = fn().then((r) => (this.store.set(key, r), r));
    this.inflight.set(key, p);
    try {
      return { result: await p, replayed: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}
