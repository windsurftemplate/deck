import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HashEmbedder } from "@deck/memory";
import type { ChatModel, ChatRequest } from "@deck/models";
import { DEFAULTS, type Settings } from "@deck/settings";
import { Engine } from "./engine.js";
import { memoryKeychain, type Keychain } from "./keychain.js";
import { handleLine } from "./protocol.js";

const ANTHROPIC = "sk-ant-" + "api03-" + "k".repeat(40);
const dir = () => mkdtempSync(join(tmpdir(), "engine-"));
const sent: ChatRequest[] = [];
const fakeModel = (id: string): ChatModel => ({
  id,
  chat: async (req) => (sent.push(req), { text: `reply from ${id}`, model: id, stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
});
const offline = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
const make = (o: { dataDir?: string; keychain?: Keychain; settings?: Settings; dim?: number } = {}) =>
  new Engine({ dataDir: o.dataDir ?? dir(), keychain: o.keychain ?? memoryKeychain(), settings: o.settings ?? DEFAULTS, fetch: offline, makeEmbedder: () => new HashEmbedder(o.dim ?? 64), makeModel: (id) => fakeModel(id) });

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
