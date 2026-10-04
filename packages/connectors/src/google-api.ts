import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

/** Read Gmail and Calendar, and write Gmail drafts. Sending is not in the requested permissions at all. */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/calendar.readonly"];

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Google sign-in for a desktop app: a one-time local web page on 127.0.0.1 receives the answer, with PKCE so an
 * intercepted code is useless. Returns the refresh token to keep in the keychain.
 */
export async function googleSignIn(o: { clientId: string; clientSecret: string; openUrl: (url: string) => void | Promise<void>; fetch?: typeof fetch; timeoutMs?: number }): Promise<{ refreshToken: string; email?: string }> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  let finish!: (v: { code?: string; error?: string }) => void;
  const done = new Promise<{ code?: string; error?: string }>((r) => (finish = r));
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") return void res.writeHead(404).end();
    const ok = u.searchParams.get("state") === state && !!u.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<html><body style="font-family:system-ui;padding:40px"><h2>${ok ? "deck is connected to Google." : "Sign-in did not finish."}</h2><p>You can close this tab.</p></body></html>`);
    finish(ok ? { code: u.searchParams.get("code")! } : { error: u.searchParams.get("error") ?? "The answer did not match this sign-in." });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${port}/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: o.clientId, redirect_uri: redirect, response_type: "code", scope: GOOGLE_SCOPES.join(" "), code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent" })}`;
  const timer = setTimeout(() => finish({ error: "Sign-in timed out." }), o.timeoutMs ?? 300_000);
  try {
    await o.openUrl(url);
    const r = await done;
    if (r.error) throw new Error(`Google sign-in: ${r.error}`);
    const res = await (o.fetch ?? fetch)("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: r.code!, client_id: o.clientId, client_secret: o.clientSecret, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect }).toString() });
    const j = (await res.json()) as { refresh_token?: string; error_description?: string; id_token?: string };
    if (!res.ok || !j.refresh_token) throw new Error(`Google sign-in: ${j.error_description ?? "no refresh token returned"}`);
    return { refreshToken: j.refresh_token };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

export class GoogleApi {
  private access: { token: string; until: number } | null = null;
  constructor(private o: { clientId: string; clientSecret: string; refreshToken: string; fetch?: typeof fetch }) {}
  private get f() {
    return this.o.fetch ?? fetch;
  }
  private async token() {
    if (this.access && Date.now() < this.access.until) return this.access.token;
    const res = await this.f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, refresh_token: this.o.refreshToken, grant_type: "refresh_token" }).toString() });
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) throw new Error("Google access expired or was revoked. Connect Google again in Settings, Labs.");
    this.access = { token: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
    return j.access_token;
  }
  private async get<T>(url: string): Promise<T> {
    const res = await this.f(url, { headers: { authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Google returned ${res.status}.`);
    return (await res.json()) as T;
  }
  async gmailSearch(q: string, max = 10): Promise<{ id: string; from: string; subject: string; date: string; snippet: string }[]> {
    const list = await this.get<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(Math.min(25, max)) })}`);
    const out = [];
    for (const m of list.messages ?? []) {
      const d = await this.get<{ id: string; snippet: string; payload: { headers: { name: string; value: string }[] } }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (n: string) => d.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      out.push({ id: d.id, from: h("From"), subject: h("Subject"), date: h("Date"), snippet: d.snippet });
    }
    return out;
  }
  async gmailRead(id: string): Promise<string> {
    type Part = { mimeType: string; body?: { data?: string }; parts?: Part[] };
    const d = await this.get<{ payload: Part & { headers: { name: string; value: string }[] } }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const find = (p: Part): string => (p.mimeType === "text/plain" && p.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : (p.parts ?? []).map(find).find(Boolean) ?? "");
    const h = (n: string) => d.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    return `From: ${h("From")}\nSubject: ${h("Subject")}\nDate: ${h("Date")}\n\n${find(d.payload).slice(0, 20_000)}`;
  }
  /** Saves a draft in Gmail. It is not sent. */
  async gmailDraft(to: string, subject: string, body: string): Promise<string> {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error("That is not an email address.");
    const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject.replace(/[\r\n]+/g, " ")}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString("base64url");
    const res = await this.f("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" }, body: JSON.stringify({ message: { raw } }) });
    if (!res.ok) throw new Error(`Gmail returned ${res.status}.`);
    return ((await res.json()) as { id: string }).id;
  }
  async calendar(days = 1): Promise<{ start: string; end: string; title: string; attendees: number }[]> {
    const now = new Date();
    const until = new Date(now.getTime() + days * 86_400_000);
    const j = await this.get<{ items?: { summary?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; attendees?: unknown[] }[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50" })}`);
    return (j.items ?? []).map((e) => ({ start: e.start.dateTime ?? e.start.date ?? "", end: e.end.dateTime ?? e.end.date ?? "", title: e.summary ?? "(no title)", attendees: e.attendees?.length ?? 0 }));
  }
}
