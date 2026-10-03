/**
 * Engine wire protocol: one JSON object per line over stdio.
 * Requests:  {"id": 1, "method": "chat.send", "params": {...}}
 * Responses: {"id": 1, "result": ...}  or  {"id": 1, "error": {"message": "..."}}
 * Events:    {"event": "check", "data": {...}}  (no id)
 */
export type Request = { id: number; method: string; params?: unknown };
export type Response = { id: number; result?: unknown; error?: { message: string } };
export type EventMsg = { event: string; data: unknown };

export type Handler = (params: unknown) => Promise<unknown>;

/** Dispatches one line. Bad input never crashes the engine; it gets an error reply when it has an id. */
export async function handleLine(line: string, handlers: Record<string, Handler>): Promise<Response | null> {
  let req: Request;
  try {
    req = JSON.parse(line) as Request;
  } catch {
    return null;
  }
  if (typeof req?.id !== "number" || typeof req.method !== "string") return null;
  const h = handlers[req.method];
  if (!h) return { id: req.id, error: { message: `unknown method ${req.method}` } };
  try {
    return { id: req.id, result: (await h(req.params)) ?? null };
  } catch (err) {
    return { id: req.id, error: { message: (err as Error).message } };
  }
}
