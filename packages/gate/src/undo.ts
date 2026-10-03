type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const real: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as NodeJS.Timeout) };

export type UndoOutcome<T> = { status: "done"; value: T } | { status: "undone" } | { status: "failed"; error: string };

/** Delays an approved external action so the owner can still take it back. */
export class UndoWindow {
  private pending = new Map<string, { handle: unknown; resolve: (o: UndoOutcome<unknown>) => void }>();
  constructor(
    public windowMs = 60_000,
    private timers: Timers = real,
  ) {}

  schedule<T>(id: string, action: () => Promise<T>): Promise<UndoOutcome<T>> {
    if (this.pending.has(id)) throw new Error(`undo: ${id} is already waiting`);
    return new Promise((resolve) => {
      const handle = this.timers.set(async () => {
        this.pending.delete(id);
        try {
          resolve({ status: "done", value: await action() });
        } catch (err) {
          resolve({ status: "failed", error: (err as Error).message });
        }
      }, this.windowMs);
      this.pending.set(id, { handle, resolve: resolve as (o: UndoOutcome<unknown>) => void });
    });
  }

  undo(id: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.timers.clear(p.handle);
    this.pending.delete(id);
    p.resolve({ status: "undone" });
    return true;
  }

  undoAll(): number {
    const ids = [...this.pending.keys()];
    ids.forEach((id) => this.undo(id));
    return ids.length;
  }

  waiting(): string[] {
    return [...this.pending.keys()];
  }
}
