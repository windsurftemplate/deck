import type { EventBus } from "./events.js";

export interface Job {
  name: string;
  /** Local wall-clock time, "HH:MM". */
  at: string;
  /** Days to run, 0 = Sunday. Omit for every day. */
  days?: number[];
  run: () => Promise<void> | void;
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as NodeJS.Timeout) };

/** Next local time matching "HH:MM" on an allowed day, strictly after `now`. */
export function nextRun(at: string, now: Date, days?: number[]): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
  if (!m) throw new Error(`scheduler: bad time "${at}", use HH:MM`);
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(Number(m[1]), Number(m[2]));
  for (let i = 0; i < 8; i++) {
    if (d > now && (!days || days.includes(d.getDay()))) return d;
    d.setDate(d.getDate() + 1);
    d.setHours(Number(m[1]), Number(m[2]));
  }
  throw new Error("scheduler: no allowed day");
}

export class Scheduler {
  private handles = new Map<string, unknown>();
  constructor(
    private bus: EventBus,
    private clock: () => Date = () => new Date(),
    private timers: Timers = realTimers,
  ) {}

  add(job: Job): Date {
    this.remove(job.name);
    const when = nextRun(job.at, this.clock(), job.days);
    const h = this.timers.set(async () => {
      this.bus.emit({ type: "schedule.fired", job: job.name });
      try {
        await job.run();
      } catch (err) {
        console.error(`job ${job.name} failed`, err);
      }
      this.add(job);
    }, Math.max(0, when.getTime() - this.clock().getTime()));
    this.handles.set(job.name, h);
    return when;
  }

  remove(name: string): void {
    const h = this.handles.get(name);
    if (h !== undefined) this.timers.clear(h);
    this.handles.delete(name);
  }

  stop(): void {
    for (const n of [...this.handles.keys()]) this.remove(n);
  }
}
