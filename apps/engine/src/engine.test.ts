import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HashEmbedder } from "@deck/memory";
import { ModelError, type ChatModel, type ChatRequest } from "@deck/models";
import { DEFAULTS, type Settings } from "@deck/settings";
import { Engine } from "./engine.js";
import { memoryKeychain, type Keychain } from "./keychain.js";
import { handleLine } from "./protocol.js";

const ANTHROPIC = "sk-ant-" + "api03-" + "k".repeat(40);
const dir = () => mkdtempSync(join(tmpdir(), "engine-"));
const sent: ChatRequest[] = [];
const fakeModel = (id: string, fail = false): ChatModel => ({
  id,
  chat: async (req) => { if (fail) throw new ModelError(`${id} down`, 503, true); sent.push(req); return { text: `reply from ${id}`, model: id, stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } }; },
});
const offline = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
const make = (o: { dataDir?: string; keychain?: Keychain; settings?: Settings; dim?: number } = {}) =>
  new Engine({ dataDir: o.dataDir ?? dir(), keychain: o.keychain ?? memoryKeychain(), settings: o.settings ?? DEFAULTS, fetch: offline, makeEmbedder: () => new HashEmbedder(o.dim ?? 64), makeModel: (ref) => fakeModel(ref.model) });

describe("engine", () => {
  it("creates a memory key once and keeps the workspace encrypted", async () => {
    const d = dir(), kc = memoryKeychain();
    const e = make({ dataDir: d, keychain: kc });
    await e.open();
    const key = await kc.get("memory.key");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    await e.issues().create({ title: "Prep Acme call" });
    await e.close();
    expect(readFileSync(join(d, "workspace.db")).includes(Buffer.from("Prep Acme call"))).toBe(false);
    const again = make({ dataDir: d, keychain: kc });
    await again.open();
    expect(await kc.get("memory.key")).toBe(key);
    expect((await again.issues().list()).map((i) => i.title)).toEqual(["Prep Acme call"]);
    await again.close();
  });

  it("refuses to start when the keychain cannot keep the key, and never replaces a lost key", async () => {
    const forgetful: Keychain = { get: async () => null, set: async () => {}, remove: async () => {} };
    const d = dir();
    await expect(make({ dataDir: d, keychain: forgetful }).open()).rejects.toThrow(/keychain is not available/);
    expect(existsSync(join(d, "workspace.db"))).toBe(false);
    const kc = memoryKeychain();
    const e = make({ dataDir: d, keychain: kc });
    await e.open();
    await e.close();
    await kc.remove("memory.key");
    await expect(make({ dataDir: d, keychain: kc }).open()).rejects.toThrow(/key is missing from the system keychain/);
  });

  it("a saved recovery key opens the workspace again after a keychain reset", async () => {
    const d = dir(), kc = memoryKeychain();
    const a = make({ dataDir: d, keychain: kc });
    await a.open();
    await a.issues().create({ title: "Survives a keychain reset" });
    await a.close();
    const saved = (await kc.get("memory.key"))!;
    const fresh = memoryKeychain(); // the old keychain is gone
    await expect(make({ dataDir: d, keychain: fresh }).open()).rejects.toThrow(/missing/);
    await fresh.set("memory.key", saved); // what the Restore button does
    const b = make({ dataDir: d, keychain: fresh });
    await b.open();
    expect((await b.issues().list()).map((i) => i.title)).toEqual(["Survives a keychain reset"]);
    await b.close();
  });

  it("startup checks: core waits for a key, then ignites", async () => {
    const kc = memoryKeychain();
    const e = make({ keychain: kc });
    await e.open();
    const before = Object.fromEntries((await e.checks()).map((r) => [r.id, r.status]));
    expect(before).toMatchObject({ models: "waiting", gateway: "off", chat: "off", keychain: "ok", memory: "ok", clock: "degraded" });
    expect(before.world).toBeUndefined();
    await kc.set("provider.anthropic", ANTHROPIC);
    const after = await e.checks();
    expect(after.find((r) => r.id === "models")).toMatchObject({ status: "ok", message: expect.stringMatching(/answered in/) });
    expect(e.readiness(after).canStart).toBe(true);
    await e.close();
  });

  it("chat: strips secrets before sending, remembers the exchange", async () => {
    const kc = memoryKeychain({ "provider.anthropic": ANTHROPIC });
    const e = make({ keychain: kc });
    await e.open();
    sent.length = 0;
    const leaked = "vp-proj-" + "Q".repeat(24);
    const r = await e.chat(`Use this token ${leaked} to set up the Acme pilot`);
    expect(r.reply).toMatch(/removed VaultProof token/);
    expect(r.redacted).toEqual(["VaultProof token"]);
    expect(JSON.stringify(sent.at(-1))).not.toContain(leaked);
    expect(sent.at(-1)!.system!.at(-1)!.cache).toBe(true);
    const second = await e.chat("What did I just ask about?");
    expect(second.memories.some((m) => m.startsWith("episode:"))).toBe(true);
    await e.close();
  });

  it("chat without a key explains what to do", async () => {
    const e = new Engine({ dataDir: dir(), keychain: memoryKeychain(), settings: DEFAULTS, fetch: offline, makeEmbedder: () => new HashEmbedder(64) });
    await e.open();
    expect((await e.chat("hello")).reply).toMatch(/Add an Anthropic key in Settings > Models/);
    await e.close();
  });

  it("emergency stop refuses new work until resumed", async () => {
    const e = make({ keychain: memoryKeychain({ "provider.anthropic": ANTHROPIC }) });
    await e.open();
    expect(e.kill()).toMatch(/Stopped all agents/);
    expect((await e.chat("hi")).reply).toMatch(/stopped/);
    e.resume();
    expect((await e.chat("hi")).reply).toMatch(/reply from/);
    await e.close();
  });

  it("re-embeds memory and keeps issues when the embedding model changes", async () => {
    const d = dir(), kc = memoryKeychain();
    const a = make({ dataDir: d, keychain: kc, dim: 64 });
    await a.open();
    await a.issues().create({ title: "Keep me" });
    await (a as unknown as { writer: { writeFact: (f: object) => Promise<unknown> } }).writer.writeFact({ subject: "Acme", attribute: "timing", claim: "Not buying until Q2", source: "inferred" });
    await a.close();
    const b = make({ dataDir: d, keychain: kc, dim: 32 });
    await b.open();
    expect(existsSync(join(d, "workspace.db.bak"))).toBe(true);
    expect((await b.issues().list()).map((i) => i.title)).toEqual(["Keep me"]);
    const mem = await (b as unknown as { reader: { retrieve: (q: string) => Promise<{ text: string }[]> } }).reader.retrieve("Acme timing");
    expect(mem.map((m) => m.text).join()).toContain("Not buying until Q2");
    await b.close();
  });
});

describe("switching providers", () => {
  it("uses the chosen provider's key and falls back to another provider", async () => {
    const settings = { ...DEFAULTS, models: { ...DEFAULTS.models, heavy: { provider: "gemini" as const, model: "gem-x" }, fallback: { provider: "openai" as const, model: "gpt-x" } } };
    const kc = memoryKeychain({ "provider.anthropic": ANTHROPIC });
    const e = new Engine({ dataDir: dir(), keychain: kc, settings, fetch: offline, makeEmbedder: () => new HashEmbedder(64), makeModel: (ref, getKey) => ({ id: ref.model, chat: async (req) => { await getKey(); return fakeModel(ref.model, ref.provider === "gemini").chat(req); } }) });
    await e.open();
    expect((await e.chat("hi")).reply).toMatch(/Add (a Google Gemini|an OpenAI) key in Settings > Models first/);
    await kc.set("provider.gemini", "g-key");
    await kc.set("provider.openai", "o-key");
    expect((await e.chat("hi")).reply).toBe("reply from gpt-x");
    await e.close();
  });
});

describe("switching models from chat", () => {
  const lists = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("generativelanguage")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-pro-x", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-flash-x", supportedGenerationMethods: ["generateContent"] }] }));
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  const used: string[] = [];
  const setup = async (keys: Record<string, string>) => {
    const d = dir();
    const e = new Engine({ dataDir: d, keychain: memoryKeychain(keys), settings: DEFAULTS, fetch: lists, makeEmbedder: () => new HashEmbedder(64), makeModel: (ref) => ({ id: ref.model, chat: async (req) => (used.push(`${ref.provider}:${ref.model}`), fakeModel(ref.model).chat(req)) }) });
    await e.open();
    return { e, d };
  };

  it("asks for a key, then for a model, then proposes and applies only after confirming", async () => {
    const { e, d } = await setup({ "provider.anthropic": ANTHROPIC });
    expect((await e.chat("switch to gemini")).reply).toMatch(/Add a Google Gemini key in Settings > Models first/);
    const { e: e2, d: d2 } = await setup({ "provider.anthropic": ANTHROPIC, "provider.gemini": "g-key" });
    const ask = await e2.chat("switch to gemini");
    expect(ask.reply).toMatch(/Which Gemini model for heavy work and quick tasks\?[\s\S]*- gemini-pro-x/);
    expect(ask.proposal).toBeUndefined();
    expect((await e2.chat("use gemini-ultra-z for heavy work")).reply).toMatch(/not available with your Gemini key/);
    const p = await e2.chat("use gemini-pro-x for heavy work");
    expect(p.reply).toBe("Switch heavy work to Gemini gemini-pro-x?");
    expect(existsSync(join(d2, "settings.json"))).toBe(false);
    used.length = 0;
    await e2.chat("hello");
    expect(used).toEqual(["anthropic:claude-sonnet-5"]);
    const done = await e2.applyProposal(p.proposal!.id);
    expect(done).toMatchObject({ applied: true, summary: "Done: Use Gemini gemini-pro-x for heavy work." });
    expect(JSON.parse(readFileSync(join(d2, "settings.json"), "utf8")).models.heavy).toEqual({ provider: "gemini", model: "gemini-pro-x" });
    used.length = 0;
    await e2.chat("hello again");
    expect(used).toEqual(["gemini:gemini-pro-x"]);
    expect((await e2.applyProposal(p.proposal!.id)).applied).toBe(false);
    expect((await e2.chat("which models are you using?")).reply).toBe("Heavy work: Gemini gemini-pro-x\nQuick tasks: Claude claude-haiku-4-5-20251001\nBackup: none");
    await e.close();
    await e2.close();
    void d;
  });
});

describe("the crew acts with tools", () => {
  const scripted = (turns: ChatResponseLike[]) => (ref: { model: string }) => ({ id: ref.model, chat: async () => turns.shift() ?? { text: "ok", model: ref.model, stopReason: "end_turn", usage: U } });
  type ChatResponseLike = { text: string; toolCalls?: { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }[]; model: string; stopReason: string; usage: typeof U };
  const U = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const tool = (name: string, input: Record<string, unknown>): ChatResponseLike => ({ text: "", toolCalls: [{ type: "tool_call", id: `c-${name}`, name, input }], model: "m", stopReason: "tool_use", usage: U });
  const text = (t: string): ChatResponseLike => ({ text: t, model: "m", stopReason: "end_turn", usage: U });
  const engine = (preset: "cautious" | "balanced", turns: ChatResponseLike[]) =>
    new Engine({ dataDir: dir(), keychain: memoryKeychain({ "provider.anthropic": ANTHROPIC }), settings: { ...DEFAULTS, preset }, fetch: offline, makeEmbedder: () => new HashEmbedder(64), makeModel: scripted(turns) });

  it("Balanced: creates an issue and remembers a fact right away", async () => {
    const e = engine("balanced", [tool("issues_create", { title: "Acme follow-up", priority: 2 }), tool("memory_remember", { subject: "Acme", topic: "timing", fact: "Not buying until Q2" }), text("Created VP-1 and noted Acme's timing.")]);
    await e.open();
    const r = await e.chat("Make an issue for the Acme follow-up, and remember they are not buying until Q2");
    expect(r.reply).toBe("Created VP-1 and noted Acme's timing.");
    expect(r.actions!.map((a) => `${a.status}:${a.summary}`)).toEqual(["done:Create issue: Acme follow-up", "done:Remember about Acme: Not buying until Q2"]);
    expect((await e.issues().list()).map((i) => [i.key, i.title, i.priority])).toEqual([["VP-1", "Acme follow-up", 2]]);
    await e.close();
  });

  it("Cautious: the issue waits for approval, then gets created", async () => {
    const e = engine("cautious", [tool("issues_create", { title: "Needs a yes" }), text("That is waiting for your approval.")]);
    const events: string[] = [];
    (e as unknown as { d: { emit: (ev: string, data: unknown) => void } }).d.emit = (ev, data) => events.push(`${ev}:${(data as { status?: string }).status ?? ""}`);
    await e.open();
    const r = await e.chat("Make an issue: Needs a yes");
    expect(r.actions![0]!.status).toBe("waiting");
    expect(await e.issues().list()).toEqual([]);
    expect(e.pendingApprovals()).toHaveLength(1);
    expect(e.decide("nope", true)).toMatch(/no request/);
    expect(e.decide(r.actions![0]!.approvalId!, true)).toBe("Approved: Create issue: Needs a yes");
    await new Promise((res) => setTimeout(res, 30));
    expect((await e.issues().list()).map((i) => i.title)).toEqual(["Needs a yes"]);
    expect(events).toContain("action:done");
    await e.close();
  });

  it("emergency stop rejects what is waiting and blocks late approvals", async () => {
    const e = engine("cautious", [tool("issues_create", { title: "Stop me" }), text("Waiting.")]);
    await e.open();
    const r = await e.chat("Make an issue: Stop me");
    e.kill();
    expect(e.pendingApprovals()).toHaveLength(0);
    expect(e.decide(r.actions![0]!.approvalId!, true)).toMatch(/stopped/);
    await new Promise((res) => setTimeout(res, 30));
    expect(await e.issues().list()).toEqual([]);
    await e.close();
  });
});

describe("crew delegation", () => {
  const U = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const tool = (name: string, input: Record<string, unknown>) => ({ text: "", toolCalls: [{ type: "tool_call" as const, id: `c-${name}-${Math.random()}`, name, input }], model: "m", stopReason: "tool_use", usage: U });
  const text = (t: string) => ({ text: t, model: "m", stopReason: "end_turn", usage: U });
  const setup = (heavy: ReturnType<typeof text>[], cheap: ReturnType<typeof text>[]) => {
    const seen: string[] = [];
    const e = new Engine({
      dataDir: dir(),
      keychain: memoryKeychain({ "provider.anthropic": ANTHROPIC }),
      settings: DEFAULTS,
      fetch: offline,
      makeEmbedder: () => new HashEmbedder(64),
      makeModel: (ref) => ({ id: ref.model, chat: async (req) => (seen.push(`${ref.model}:${req.system?.[1]?.text.split("\n")[0] ?? "verifier"}`), ((ref.model.includes("haiku") ? cheap : heavy).shift() ?? text("ok")) as never) }),
    });
    return { e, seen };
  };

  it("the Chief of Staff hands a task to GTM, GTM drafts, the work is checked, the report comes back", async () => {
    const { e, seen } = setup(
      [tool("delegate", { agent: "gtm", goal: "Draft a follow-up to Dana at Acme", done_when: ["a draft to Dana exists"] }), tool("draft_message", { to: "dana@acme.com", subject: "Q2 pilot", body: "Hi Dana, checking in on Q2." }), text("Drafted a follow-up to Dana."), text("GTM drafted the follow-up; it is ready for you to review.")],
      [text('{"missing": []}')],
    );
    await e.open();
    const r = await e.chat("Get GTM to draft a follow-up to Dana at Acme");
    expect(r.reply).toBe("GTM drafted the follow-up; it is ready for you to review.");
    expect(seen).toEqual(["claude-sonnet-5:# Role: Chief of Staff", "claude-sonnet-5:# Role: GTM", "claude-sonnet-5:# Role: GTM", "claude-haiku-4-5-20251001:verifier", "claude-sonnet-5:# Role: Chief of Staff"]);
    expect(e.recentDrafts()[0]).toMatchObject({ agent: "gtm", to: "dana@acme.com", subject: "Q2 pilot" });
    expect(e.board.list({ agent: "gtm" })[0]).toMatchObject({ status: "done", note: "Checked: all done-when items met." });
    await e.close();
  });

  it("a crew member that does not finish is reported honestly", async () => {
    const { e } = setup([tool("delegate", { agent: "ops", goal: "Close stale issues", done_when: ["every stale issue is closed"] }), text("I looked."), text("Still looked."), text("Ops did not finish.")], [text('{"missing": ["every stale issue is closed"]}'), text('{"missing": ["every stale issue is closed"]}')]);
    await e.open();
    await e.chat("Have ops close stale issues");
    expect(e.board.list({ agent: "ops" })[0]).toMatchObject({ status: "failed", note: "Not finished: every stale issue is closed" });
    await e.close();
  });

  it("crew members cannot delegate further and cannot send", async () => {
    const tools = (e: Engine, a: string) => (e as unknown as { toolsFor: (a: string) => { spec: { name: string } }[] }).toolsFor(a).map((t) => t.spec.name);
    const { e } = setup([], []);
    await e.open();
    expect(tools(e, "chief-of-staff")).toContain("delegate");
    expect(tools(e, "gtm")).not.toContain("delegate");
    expect(await e.delegate("nobody", "x", "y", ["z"])).toMatch(/no crew member/);
    await e.close();
  });
});

describe("onboarding", () => {
  it("saves the interview as stated facts and uses them in chat", async () => {
    const e = make({ keychain: memoryKeychain({ "provider.anthropic": ANTHROPIC }) });
    await e.open();
    expect(await e.saveProfile({ name: "Nelson", role: "Founder of VaultProof", priorities: "", style: "Short, direct answers" })).toEqual({ saved: 3 });
    expect(await e.userModel()).toContain("role: Founder of VaultProof");
    sent.length = 0;
    await e.chat("hi");
    expect(sent.at(-1)!.system!.map((b) => b.text).join()).toContain("role: Founder of VaultProof");
    expect(await e.testModel()).toMatchObject({ ok: true });
    await e.close();
  });
});

describe("wire protocol", () => {
  it("answers, reports errors, and ignores junk", async () => {
    const h = { ping: async () => "pong", boom: async () => { throw new Error("nope"); } };
    expect(await handleLine('{"id":1,"method":"ping"}', h)).toEqual({ id: 1, result: "pong" });
    expect(await handleLine('{"id":2,"method":"boom"}', h)).toEqual({ id: 2, error: { message: "nope" } });
    expect(await handleLine('{"id":3,"method":"nope"}', h)).toEqual({ id: 3, error: { message: "unknown method nope" } });
    expect(await handleLine("not json", h)).toBeNull();
  });

  it("runs as a real process over stdio", async () => {
    const main = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "main.js");
    if (!existsSync(main)) return;
    const p = spawn(process.execPath, [main, dir()], { env: { ...process.env, DECK_TEST_KEYCHAIN: "memory" }, stdio: ["pipe", "pipe", "pipe"] });
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    p.stdout.on("data", (c) => {
      buf += c;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      parts.filter(Boolean).forEach((l) => lines.push(JSON.parse(l)));
    });
    const waitFor = (pred: (l: Record<string, unknown>) => boolean) =>
      new Promise<Record<string, unknown>>((res, rej) => {
        const t = setInterval(() => {
          const hit = lines.find(pred);
          if (hit) (clearInterval(t), res(hit));
        }, 20);
        setTimeout(() => (clearInterval(t), rej(new Error(`timeout; got ${JSON.stringify(lines)}`))), 60_000);
      });
    await waitFor((l) => l.event === "ready");
    p.stdin.write('{"id":1,"method":"issues.create","params":{"title":"From the app"}}\n{"id":2,"method":"issues.list"}\n');
    const list = await waitFor((l) => l.id === 2);
    expect((list.result as { title: string }[]).map((i) => i.title)).toEqual(["From the app"]);
    p.stdin.end();
    await new Promise((r) => p.on("exit", r));
  }, 90_000);
});
