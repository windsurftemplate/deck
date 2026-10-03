import type { Task } from "./taskboard.js";

/** Everything the UI, chat bot and logs need to react to. */
export type DeckEvent =
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task; from: Task["status"] }
  | { type: "agent.message"; agent: string; text: string }
  | { type: "approval.requested"; id: string; agent: string; summary: string }
  | { type: "approval.resolved"; id: string; approved: boolean }
  | { type: "credential.used"; agent: string; scope: string }
  | { type: "action.blocked"; agent: string; reason: string }
  | { type: "agent.killed"; agent: string | "all" }
  | { type: "schedule.fired"; job: string };

type Handler<E> = (e: E) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<DeckEvent>>>();

  on<T extends DeckEvent["type"]>(type: T | "*", fn: Handler<Extract<DeckEvent, { type: T }>>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn as Handler<DeckEvent>);
    this.handlers.set(type, set);
    return () => set.delete(fn as Handler<DeckEvent>);
  }

  emit(e: DeckEvent): void {
    for (const key of [e.type, "*"]) {
      for (const fn of this.handlers.get(key) ?? []) {
        try {
          fn(e);
        } catch (err) {
          // One broken listener must not stop the others.
          console.error(`event handler for ${e.type} failed`, err);
        }
      }
    }
  }
}
