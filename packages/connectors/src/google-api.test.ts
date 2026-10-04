import { describe, expect, it } from "vitest";
import { GOOGLE_SCOPES, GoogleApi, googleSignIn } from "./index.js";

describe("Google sign-in and API", () => {
  it("signs in through a local page with PKCE, never asks for send permission, and refuses a wrong state", async () => {
    let tokenBody = "";
    const f = (async (u: string, init?: RequestInit) => {
      if (u.startsWith("http://127.0.0.1")) return fetch(u);
      tokenBody = String(init?.body);
      return new Response(JSON.stringify({ refresh_token: "r-1" }));
    }) as unknown as typeof fetch;
    let authUrl = "";
    const r = await googleSignIn({
      clientId: "1-abc.apps.googleusercontent.com",
      clientSecret: "s",
      fetch: f,
      openUrl: async (url) => {
        authUrl = url;
        const u = new URL(url);
        await fetch(`${u.searchParams.get("redirect_uri")}?code=c-1&state=${u.searchParams.get("state")}`);
      },
    });
    expect(r.refreshToken).toBe("r-1");
    expect(new URL(authUrl).searchParams.get("code_challenge_method")).toBe("S256");
    expect(tokenBody).toContain("code_verifier=");
    expect(GOOGLE_SCOPES.join(" ")).not.toMatch(/gmail\.send|mail\.google\.com\/$/);
    await expect(googleSignIn({ clientId: "1-abc.apps.googleusercontent.com", clientSecret: "s", fetch: f, openUrl: async (url) => void (await fetch(`${new URL(url).searchParams.get("redirect_uri")}?code=c&state=forged`)) })).rejects.toThrow(/did not match/);
  });

  it("reads mail and calendar and saves a draft without sending", async () => {
    const calls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${u.split("?")[0]}`);
      if (u.includes("/token")) return new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }));
      if (u.endsWith("/messages?q=is%3Aunread&maxResults=10") || u.includes("/messages?")) return new Response(JSON.stringify({ messages: [{ id: "m1" }] }));
      if (u.includes("/messages/m1?format=metadata")) return new Response(JSON.stringify({ id: "m1", snippet: "Can we talk SSO?", payload: { headers: [{ name: "From", value: "Dana <dana@acme.com>" }, { name: "Subject", value: "SSO" }, { name: "Date", value: "Mon" }] } }));
      if (u.includes("/events")) return new Response(JSON.stringify({ items: [{ summary: "Acme call", start: { dateTime: "2026-10-05T17:00:00Z" }, end: { dateTime: "2026-10-05T17:30:00Z" }, attendees: [{}, {}] }] }));
      if (u.endsWith("/drafts")) return new Response(JSON.stringify({ id: "d1" }));
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const g = new GoogleApi({ clientId: "c", clientSecret: "s", refreshToken: "r", fetch: f });
    expect(await g.gmailSearch("is:unread")).toEqual([{ id: "m1", from: "Dana <dana@acme.com>", subject: "SSO", date: "Mon", snippet: "Can we talk SSO?" }]);
    expect(await g.calendar()).toEqual([{ start: "2026-10-05T17:00:00Z", end: "2026-10-05T17:30:00Z", title: "Acme call", attendees: 2 }]);
    expect(await g.gmailDraft("dana@acme.com", "Re: SSO", "Hi Dana")).toBe("d1");
    expect(calls.some((c) => c.includes("/send"))).toBe(false);
    expect(calls.filter((c) => c.includes("/token"))).toHaveLength(1); // access token reused
  });
});
