/**
 * Jev (TypeSafe AI): a System One model for fast, structured decisions. One request sends a state and named
 * questions (Noul: yes/no probability, Choice: pick an option, Score: rate on levels) and returns typed answers
 * with confidence. deck uses it where a quick, calibrated judgment beats generating text.
 * API: POST {base}/v1/systemone with Authorization: Bearer <key>.
 */
export const JEV_DEFAULT_BASE = "https://api.typesafe.ai";

export type JevQuestion =
  | { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export interface JevResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class JevClient {
  constructor(
    private o: { getKey: () => Promise<string>; baseUrl?: string; model?: string; fetch?: typeof fetch; timeoutMs?: number; retries?: number },
  ) {}

  async ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> {
    if (!Object.keys(questions).length) throw new JevError("Jev needs at least one question.");
    const url = `${(this.o.baseUrl || JEV_DEFAULT_BASE).replace(/\/+$/, "").replace(/\/v1\/systemone$/, "")}/v1/systemone`;
    const body = JSON.stringify({ state, model: this.o.model ?? "jev-latest", questions });
    const key = await this.o.getKey();
    const f = this.o.fetch ?? fetch;
    let wait = 400;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 20_000);
      let res: Response;
      try {
        res = await f(url, { method: "POST", signal: ctrl.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body });
      } catch (e) {
        throw new JevError((e as Error).name === "AbortError" ? "Jev took too long to answer." : `Could not reach Jev (${(e as Error).message}).`);
      } finally {
        clearTimeout(timer);
      }
      // Rate limited or overloaded: back off and retry a couple of times, as TypeSafe recommends.
      if ((res.status === 429 || res.status === 529) && attempt < (this.o.retries ?? 2)) {
        await new Promise((r) => setTimeout(r, wait));
        wait *= 2;
        continue;
      }
      if (res.status === 401) throw new JevError("Jev rejected the API key. Check it on the Tools page.", 401);
      if (res.status === 422) throw new JevError(`Jev could not read the request: ${(await res.text()).slice(0, 200)}`, 422);
      if (res.status === 429 || res.status === 529) throw new JevError("Jev is busy right now (rate limited or overloaded).", res.status);
      if (!res.ok) throw new JevError(`Jev returned ${res.status}.`, res.status);
      return (await res.json()) as JevResult;
    }
  }
}

/** Reads a Noul answer (0 to 1), or null if the question was not answered as a Noul. */
export const noulOf = (r: JevResult, id: string): number | null => {
  const a = r.answers[id];
  return a && a.type === "noul" ? a.noul : null;
};
export const choiceOf = (r: JevResult, id: string): { choice: string; confidence: number } | null => {
  const a = r.answers[id];
  return a && a.type === "choice" ? { choice: a.choice, confidence: a.confidence } : null;
};
