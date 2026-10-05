import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { platform } from "node:os";

/**
 * Isolated browser. Uses Chrome (or Chromium, Edge, Brave) installed on the computer, but with its own empty
 * profile: none of your cookies, logins or saved passwords, no extensions, no sync, downloads off, and every
 * request to this computer or a private network refused. The agent sees each page as text plus numbered links,
 * buttons and fields. Password and payment fields are never filled.
 */
export interface PageElement {
  id: number;
  tag: string;
  role: "link" | "button" | "field" | "select";
  label: string;
  href?: string;
  inputType?: string;
  risk: ElementRisk;
}
export type ElementRisk = "read" | "write" | "external" | "refused";
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
}

const CANDIDATES: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
};
export const findChrome = (custom?: string) => (custom && existsSync(custom) ? custom : (CANDIDATES[platform()] ?? []).find(existsSync) ?? null);

/** Pages may only load public http and https addresses. */
export function allowedUrl(raw: string, allowHosts: string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "about:" && u.href === "about:blank") return true;
  if (u.protocol === "data:" || u.protocol === "blob:") return true; // content the page itself made
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowHosts.includes(h)) return true;
  return !(h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || /^f[cd]/.test(h) || h.startsWith("fe80") || /^\d+$/.test(h));
}

const EXTERNAL = /\b(buy|pay|purchase|checkout|check out|place order|order now|subscribe|send|post|publish|tweet|delete|remove|confirm|sign up|register|apply|book|reserve|donate|transfer|submit|save|upload|unsubscribe|follow|accept|agree)\b/i;
const SECRET_FIELD = /password|passcode|card|cvc|cvv|ccv|iban|routing|ssn|social security|security code|expir|pin\b/i;

export function elementRisk(e: { tag: string; role: string; label: string; inputType?: string; autocomplete?: string; name?: string; formAction?: boolean }): ElementRisk {
  const all = `${e.label} ${e.name ?? ""} ${e.autocomplete ?? ""}`;
  if (e.role === "field" || e.role === "select") {
    if (e.inputType === "password" || /^(cc-|current-password|new-password|one-time-code)/.test(e.autocomplete ?? "") || SECRET_FIELD.test(all)) return "refused";
    return "write";
  }
  if (e.role === "link") return EXTERNAL.test(e.label) ? "external" : "read";
  if (e.inputType === "submit" || e.formAction || EXTERNAL.test(e.label)) return "external";
  return "write";
}

const SNAPSHOT_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.title || el.name || (el.labels && el.labels[0] && el.labels[0].innerText) || "").trim().replace(/\\s+/g, " ").slice(0, 120);
  document.querySelectorAll("[data-deck-id]").forEach((el) => el.removeAttribute("data-deck-id"));
  const els = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [onclick]")].filter(vis).slice(0, 150);
  const out = els.map((el, i) => {
    el.setAttribute("data-deck-id", String(i + 1));
    const tag = el.tagName.toLowerCase();
    const role = tag === "a" || el.getAttribute("role") === "link" ? "link" : tag === "select" ? "select" : (tag === "input" && !["button","submit","reset","image","checkbox","radio"].includes(el.type)) || tag === "textarea" ? "field" : "button";
    return { id: i + 1, tag, role, label: label(el), href: el.href || undefined, inputType: el.type || undefined, autocomplete: el.getAttribute("autocomplete") || undefined, name: el.name || undefined, formAction: !!(el.form && (el.type === "submit" || (tag === "button" && (!el.type || el.type === "submit")))) };
  });
  return JSON.stringify({ url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 8000), elements: out });
})()`;

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
type WSLike = { send(d: string): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null; onopen: (() => void) | null; onerror: ((e: unknown) => void) | null; onclose: (() => void) | null };

export class IsolatedBrowser {
  private proc: ChildProcess | null = null;
  private ws: WSLike | null = null;
  private session = "";
  private seq = 0;
  private pending = new Map<number, Pending>();
  private waiters: { event: string; resolve: () => void }[] = [];
  private lastSnapshot: PageSnapshot | null = null;
  private blocked: string[] = [];
  constructor(private o: { chromePath?: string; profileDir: string; headless?: boolean; allowHosts?: string[]; timeoutMs?: number }) {}

  get running() {
    return !!this.ws;
  }

  private send(method: string, params: Record<string, unknown> = {}, session = true): Promise<Record<string, unknown>> {
    if (!this.ws) return Promise.reject(new Error("The browser is not running."));
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(session && this.session ? { sessionId: this.session } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), reject(new Error(`${method} timed out`))), this.o.timeoutMs ?? 20_000);
    });
  }
  private waitFor(event: string, ms: number) {
    return new Promise<void>((resolve) => {
      const w = { event, resolve };
      this.waiters.push(w);
      setTimeout(() => ((this.waiters = this.waiters.filter((x) => x !== w)), resolve()), ms);
    });
  }

  async start(): Promise<void> {
    if (this.ws) return;
    const bin = findChrome(this.o.chromePath);
    if (!bin) throw new Error("No Chrome, Chromium, Edge or Brave found. Install one, or set its path in Settings > Labs.");
    mkdirSync(this.o.profileDir, { recursive: true });
    const args = [`--user-data-dir=${this.o.profileDir}`, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--password-store=basic", "--use-mock-keychain", "--disable-features=Translate,AutofillServerCommunication,MediaRouter", "--deny-permission-prompts", ...(this.o.headless === false ? [] : ["--headless=new"]), ...(platform() === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []), "about:blank"];
    // Its own process group, so closing it also ends every helper process it started.
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], detached: platform() !== "win32" });
    this.proc = p;
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const t = setTimeout(() => reject(new Error("The browser did not start in time.")), 20_000);
      p.stderr!.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/);
        if (m) (clearTimeout(t), resolve(m[1]!));
      });
      p.on("exit", () => (clearTimeout(t), reject(new Error("The browser closed while starting."))));
    });
    const WS = (globalThis as unknown as { WebSocket: new (u: string) => WSLike }).WebSocket;
    const ws = new WS(url);
    await new Promise<void>((resolve, reject) => ((ws.onopen = () => resolve()), (ws.onerror = () => reject(new Error("Could not connect to the browser.")))));
    this.ws = ws;
    ws.onclose = () => (this.ws = null);
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        return m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result ?? {});
      }
      if (m.method === "Fetch.requestPaused" && m.params) {
        const reqUrl = String((m.params.request as { url: string }).url);
        const ok = allowedUrl(reqUrl, this.o.allowHosts);
        if (!ok) this.blocked.push(reqUrl);
        void this.send(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: "BlockedByClient" }).catch(() => {});
        return;
      }
      if (m.method) for (const w of this.waiters.filter((x) => x.event === m.method)) (this.waiters = this.waiters.filter((x) => x !== w)), w.resolve();
    };
    await this.send("Browser.setDownloadBehavior", { behavior: "deny" }, false).catch(() => {});
    const { targetId } = (await this.send("Target.createTarget", { url: "about:blank" }, false)) as { targetId: string };
    const { sessionId } = (await this.send("Target.attachToTarget", { targetId, flatten: true }, false)) as { sessionId: string };
    this.session = sessionId;
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    // Every request from the page goes through this filter: nothing on this computer or a private network.
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  }

  async open(url: string): Promise<PageSnapshot> {
    if (!allowedUrl(url, this.o.allowHosts) || !/^https?:/.test(url)) throw new Error("Only public http and https pages can be opened.");
    await this.start();
    const loaded = this.waitFor("Page.loadEventFired", 15_000);
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`Could not open the page: ${String(r.errorText)}`);
    await loaded;
    return this.snapshot();
  }

  async snapshot(): Promise<PageSnapshot> {
    const r = (await this.send("Runtime.evaluate", { expression: SNAPSHOT_JS, returnByValue: true })) as { result?: { value?: string } };
    const raw = JSON.parse(r.result?.value ?? "{}") as { url: string; title: string; text: string; elements: (PageElement & { autocomplete?: string; name?: string; formAction?: boolean })[] };
    const snap: PageSnapshot = { url: raw.url, title: raw.title, text: raw.text, elements: raw.elements.map((e) => ({ id: e.id, tag: e.tag, role: e.role, label: e.label, ...(e.href ? { href: e.href } : {}), ...(e.inputType ? { inputType: e.inputType } : {}), risk: elementRisk(e) })) };
    this.lastSnapshot = snap;
    return snap;
  }

  element(id: number): PageElement | undefined {
    return this.lastSnapshot?.elements.find((e) => e.id === id);
  }

  /** Clicks a numbered element. Callers decide approval from its risk first. */
  async click(id: number, expect?: { url: string; label: string }): Promise<PageSnapshot> {
    const el = this.element(id);
    if (!el) throw new Error(`No element ${id} on the page. Read the page again.`);
    if (el.risk === "refused") throw new Error("That element is refused.");
    if (expect && (this.lastSnapshot?.url !== expect.url || el.label !== expect.label)) throw new Error("The page changed since this was approved, so nothing was clicked.");
    const nav = this.waitFor("Page.loadEventFired", 4000);
    const r = (await this.send("Runtime.evaluate", { expression: `(() => { const el = document.querySelector('[data-deck-id="${id}"]'); if (!el) return "missing"; el.scrollIntoView({block: "center"}); el.click(); return "ok"; })()`, returnByValue: true })) as { result?: { value?: string } };
    if (r.result?.value !== "ok") throw new Error("That element is no longer on the page.");
    await Promise.race([nav, new Promise((res) => setTimeout(res, 1200))]);
    return this.snapshot();
  }

  /** Types into a numbered field. Password and payment fields are refused. */
  async type(id: number, text: string): Promise<PageSnapshot> {
    const el = this.element(id);
    if (!el) throw new Error(`No element ${id} on the page. Read the page again.`);
    if (el.risk === "refused") throw new Error("deck never types into password, card or ID fields.");
    if (el.role !== "field") throw new Error("That element is not a text field.");
    const v = JSON.stringify(text.slice(0, 2000));
    await this.send("Runtime.evaluate", { expression: `(() => { const el = document.querySelector('[data-deck-id="${id}"]'); if (!el) return; el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set; set.call(el, ${v}); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()` });
    return this.snapshot();
  }

  /** Addresses the page tried to reach that were refused (this computer or a private network). */
  blockedRequests(): string[] {
    return [...this.blocked];
  }

  async close(): Promise<void> {
    try {
      await this.send("Browser.close", {}, false);
    } catch {
      /* already closed */
    }
    this.ws?.close();
    this.ws = null;
    this.session = "";
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode === null) {
      const exited = new Promise<void>((r) => p.once("exit", () => r()));
      try {
        if (platform() !== "win32" && p.pid) process.kill(-p.pid, "SIGKILL");
        else p.kill("SIGKILL");
      } catch {
        p.kill("SIGKILL");
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
    // Give helper processes a moment to release the profile folder.
    await new Promise((r) => setTimeout(r, 300));
  }
}
