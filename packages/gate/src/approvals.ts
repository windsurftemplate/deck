import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface Approval {
  id: string;
  agent: string;
  /** One line the owner reads, e.g. "Send email to dana@acme.com: Re: pilot". */
  summary: string;
  /** The exact action, shown in full before approving. */
  detail: string;
  scope: string;
  createdAt: number;
  status: ApprovalStatus;
}

/** Holds external actions until the owner decides. Nothing in here runs without an explicit approve. */
export class ApprovalQueue {
  private items = new Map<string, Approval>();
  private waiters = new Map<string, (a: Approval) => void>();
  constructor(
    private onChange: (a: Approval) => void = () => {},
    private clock: () => number = Date.now,
    private ttlMs = 24 * 3600_000,
  ) {}

  request(a: { agent: string; summary: string; detail: string; scope: string }): { approval: Approval; decision: Promise<Approval> } {
    const approval: Approval = { ...a, id: randomUUID().slice(0, 8), createdAt: this.clock(), status: "pending" };
    this.items.set(approval.id, approval);
    const decision = new Promise<Approval>((res) => this.waiters.set(approval.id, res));
    this.onChange({ ...approval });
    return { approval: { ...approval }, decision };
  }

  decide(id: string, approve: boolean): Approval {
    const a = this.items.get(id);
    if (!a) throw new Error(`approvals: no request ${id}`);
    if (a.status !== "pending") throw new Error(`approvals: ${id} is already ${a.status}`);
    if (this.clock() - a.createdAt > this.ttlMs) return this.settle(a, "expired");
    return this.settle(a, approve ? "approved" : "rejected");
  }

  /** Expire stale requests so an old approval can never be used later. */
  sweep(): number {
    let n = 0;
    for (const a of this.items.values()) if (a.status === "pending" && this.clock() - a.createdAt > this.ttlMs) (this.settle(a, "expired"), n++);
    return n;
  }

  /** Kill switch: reject everything pending, for one agent or all. */
  rejectAll(agent: string | "all" = "all"): number {
    let n = 0;
    for (const a of this.items.values()) if (a.status === "pending" && (agent === "all" || a.agent === agent)) (this.settle(a, "rejected"), n++);
    return n;
  }

  pending(): Approval[] {
    return [...this.items.values()].filter((a) => a.status === "pending").map((a) => ({ ...a }));
  }

  private settle(a: Approval, status: ApprovalStatus): Approval {
    a.status = status;
    this.onChange({ ...a });
    this.waiters.get(a.id)?.({ ...a });
    this.waiters.delete(a.id);
    return { ...a };
  }
}
