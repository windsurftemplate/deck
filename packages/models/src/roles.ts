import { ModelError, type ChatModel, type ChatRequest, type ChatResponse, type Price, type Role, type Usage } from "./types.js";

export interface RouterConfig {
  /** Ordered fallback chain of model ids per role. */
  roles: Partial<Record<Role, string[]>>;
  models: Record<string, ChatModel>;
  /** Prices per model id, set by the owner in Settings > Models. Optional: unpriced models are capped by tokens. */
  prices: Record<string, Price>;
  /** Daily caps: dollars (for priced models) and tokens (always). */
  caps: { total?: number; perAgent?: Record<string, number>; tokens?: number };
  clock?: () => Date;
}

export interface RouteResult extends ChatResponse {
  /** Null when the model has no price set. */
  costUsd: number | null;
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
  private spent = { day: "", total: 0, tokens: 0, byAgent: new Map<string, number>() };
  constructor(private cfg: RouterConfig) {
    for (const [role, chain] of Object.entries(cfg.roles)) {
      for (const id of chain ?? []) {
        if (!cfg.models[id]) throw new Error(`models: role ${role} uses unknown model ${id}`);
        if (!cfg.prices[id] && cfg.caps.tokens === undefined) throw new Error(`models: no price set for ${id}; set a price or a daily token cap`);
      }
    }
  }

  private today(): string {
    const d = (this.cfg.clock ?? (() => new Date()))().toISOString().slice(0, 10);
    if (d !== this.spent.day) this.spent = { day: d, total: 0, tokens: 0, byAgent: new Map() };
    return d;
  }

  spend(): { total: number; tokens: number; byAgent: Record<string, number> } {
    this.today();
    return { total: this.spent.total, tokens: this.spent.tokens, byAgent: Object.fromEntries(this.spent.byAgent) };
  }

  private checkCaps(agent: string) {
    this.today();
    if (this.cfg.caps.total !== undefined && this.spent.total >= this.cfg.caps.total) throw new SpendCapError(`Daily power budget of $${this.cfg.caps.total} reached`);
    if (this.cfg.caps.tokens !== undefined && this.spent.tokens >= this.cfg.caps.tokens) throw new SpendCapError(`Daily token budget of ${this.cfg.caps.tokens.toLocaleString("en-US")} reached`);
    const cap = this.cfg.caps.perAgent?.[agent];
    if (cap !== undefined && (this.spent.byAgent.get(agent) ?? 0) >= cap) throw new SpendCapError(`${agent} reached its daily cap of $${cap}`);
  }

  async chat(role: Role, agent: string, req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<RouteResult> {
    const chain = this.cfg.roles[role];
    if (!chain?.length) throw new Error(`models: no model assigned to role ${role}`);
    this.checkCaps(agent);
    const attempts: RouteResult["attempts"] = [];
    for (const id of chain) {
      try {
        const res = await this.cfg.models[id]!.chat(req, signal, onText);
        const price = this.cfg.prices[id];
        const costUsd = price ? costOf(res.usage, price) : null;
        const used = res.usage.inputTokens + res.usage.outputTokens + res.usage.cacheReadTokens + res.usage.cacheWriteTokens;
        this.spent.tokens += used;
        if (costUsd !== null) {
          this.spent.total += costUsd;
          this.spent.byAgent.set(agent, (this.spent.byAgent.get(agent) ?? 0) + costUsd);
        }
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
