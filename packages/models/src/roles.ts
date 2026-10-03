import { ModelError, type ChatModel, type ChatRequest, type ChatResponse, type Price, type Role, type Usage } from "./types.js";

export interface RouterConfig {
  /** Ordered fallback chain of model ids per role. */
  roles: Partial<Record<Role, string[]>>;
  models: Record<string, ChatModel>;
  /** Prices per model id, set by the owner in Settings > Models. */
  prices: Record<string, Price>;
  /** Daily spend caps in US dollars. */
  caps: { total: number; perAgent?: Record<string, number> };
  clock?: () => Date;
}

export interface RouteResult extends ChatResponse {
  costUsd: number;
  attempts: { model: string; error?: string }[];
}

export class SpendCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendCapError";
  }
}

export function costOf(u: Usage, p: Price): number {
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

/** Picks a model for a role, enforces spend caps, and falls back down the chain on retryable errors. */
export class ModelRouter {
  private spent = { day: "", total: 0, byAgent: new Map<string, number>() };
  constructor(private cfg: RouterConfig) {
    for (const [role, chain] of Object.entries(cfg.roles)) {
      for (const id of chain ?? []) {
        if (!cfg.models[id]) throw new Error(`models: role ${role} uses unknown model ${id}`);
        if (!cfg.prices[id]) throw new Error(`models: no price set for ${id}; spend caps need it`);
      }
    }
  }

  private today(): string {
    const d = (this.cfg.clock ?? (() => new Date()))().toISOString().slice(0, 10);
    if (d !== this.spent.day) this.spent = { day: d, total: 0, byAgent: new Map() };
    return d;
  }

  spend(): { total: number; byAgent: Record<string, number> } {
    this.today();
    return { total: this.spent.total, byAgent: Object.fromEntries(this.spent.byAgent) };
  }

  private checkCaps(agent: string) {
    this.today();
    if (this.spent.total >= this.cfg.caps.total) throw new SpendCapError(`Daily power budget of $${this.cfg.caps.total} reached`);
    const cap = this.cfg.caps.perAgent?.[agent];
    if (cap !== undefined && (this.spent.byAgent.get(agent) ?? 0) >= cap) throw new SpendCapError(`${agent} reached its daily cap of $${cap}`);
  }

  async chat(role: Role, agent: string, req: ChatRequest, signal?: AbortSignal): Promise<RouteResult> {
    const chain = this.cfg.roles[role];
    if (!chain?.length) throw new Error(`models: no model assigned to role ${role}`);
    this.checkCaps(agent);
    const attempts: RouteResult["attempts"] = [];
    for (const id of chain) {
      try {
        const res = await this.cfg.models[id]!.chat(req, signal);
        const costUsd = costOf(res.usage, this.cfg.prices[id]!);
        this.spent.total += costUsd;
        this.spent.byAgent.set(agent, (this.spent.byAgent.get(agent) ?? 0) + costUsd);
        attempts.push({ model: id });
        return { ...res, costUsd, attempts };
      } catch (err) {
        attempts.push({ model: id, error: (err as Error).message });
        if (!(err instanceof ModelError) || !err.retryable) throw err;
      }
    }
    throw new ModelError(`models: every model for ${role} failed (${attempts.map((a) => a.model).join(", ")})`, 503, false);
  }
}
