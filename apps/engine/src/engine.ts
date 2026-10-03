import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { ROLE_LABEL, PROVIDER_LABEL, buildPrompt, composeBrief, describeModels, loadCoreRules, loadPolicy, loadRole, parseModelCommand, runAgent, type ActionRecord, type AgentTool } from "@deck/agents";
import { ChatBot, TelegramClient, type BotActions } from "@deck/chat";
import { vaultProofProbe } from "@deck/connectors";
import { CHECKS, EventBus, Scheduler, TaskBoard, clockProbe, runStartupChecks, summarize, type CheckResult, type Probe } from "@deck/core";
import { LocalEmbedder } from "@deck/embed-local";
import { ApprovalQueue, redactSecrets } from "@deck/gate";
import { MemoryReader, MemoryWriter, SqliteMemoryStore, migrateMemory, storedDim, type Embedder } from "@deck/memory";
import { ModelError, ModelRouter, OpenAIEmbedder, SpendCapError, listModels, makeChatModel, refId, type ChatModel, type ModelRef } from "@deck/models";
import { applyUpdate, type DeepPartial, type Settings } from "@deck/settings";
import { SqliteTrackerStore, Tracker } from "@deck/tracker";
import type { Keychain } from "./keychain.js";

/** A settings change the owner asked for in chat. Nothing changes until they confirm. */
export interface Proposal {
  id: string;
  summary: string;
  patch: DeepPartial<Settings>;
}

export interface EngineDeps {
  dataDir: string;
  keychain: Keychain;
  settings: Settings;
  emit?: (event: string, data: unknown) => void;
  clock?: () => Date;
  fetch?: typeof fetch;
  /** Overrides for tests. */
  makeEmbedder?: (s: Settings) => Embedder;
  makeModel?: (ref: ModelRef, getKey: () => Promise<string>) => ChatModel;
}

type Turn = { from: "owner" | "agent"; text: string };
const KEY_PHRASE: Record<ModelRef["provider"], string> = { anthropic: "an Anthropic key", openai: "an OpenAI key", gemini: "a Google Gemini key", openrouter: "an OpenRouter key" };
const MEMORY_KEY = "memory.key";
const AGENT = "chief-of-staff";

/** The agent engine: owns the workspace database, models, the crew and the chat bot. The desktop app talks to it over stdio. */
export class Engine {
  private store!: SqliteMemoryStore;
  private writer!: MemoryWriter;
  private reader!: MemoryReader;
  private tracker!: Tracker;
  private router!: ModelRouter;
  readonly bus = new EventBus();
  readonly board: TaskBoard;
  readonly approvals: ApprovalQueue;
  private scheduler: Scheduler;
  private bot: ChatBot | null = null;
  private turns: Turn[] = [];
  private stopped = false;
  private proposals = new Map<string, Proposal>();
  private clock: () => Date;

  constructor(private d: EngineDeps) {
    this.clock = d.clock ?? (() => new Date());
    this.board = new TaskBoard(this.bus, this.clock);
    this.approvals = new ApprovalQueue((a) => {
      this.emit("approval", a);
      if (a.status === "pending") for (const id of this.d.settings.chat.telegram.ownerChatIds) void this.bot?.notifyApproval(id, a).catch(() => {});
    });
    this.scheduler = new Scheduler(this.bus, this.clock);
    this.bus.on("*", (e) => this.emit("deck", e));
  }

  private emit(event: string, data: unknown) {
    this.d.emit?.(event, data);
  }

  private embedder(): Embedder {
    if (this.d.makeEmbedder) return this.d.makeEmbedder(this.d.settings);
    if (this.d.settings.embeddings.provider === "openai") return new OpenAIEmbedder(() => this.secret("provider.openai", KEY_PHRASE.openai), 512, "text-embedding-3-small", this.d.fetch ?? fetch);
    return new LocalEmbedder({ cacheDir: join(this.d.dataDir, "models") });
  }

  private async secret(name: string, what: string): Promise<string> {
    const v = await this.d.keychain.get(name);
    if (!v) throw new Error(`Add ${what} in Settings > Models first.`);
    return v;
  }

  /** Opens (or creates) the encrypted workspace. Re-embeds memory if the embedding model changed. */
  async open(): Promise<void> {
    mkdirSync(this.d.dataDir, { recursive: true });
    const path = join(this.d.dataDir, "workspace.db");
    let key = await this.d.keychain.get(MEMORY_KEY);
    if (!key && existsSync(path)) {
      // Never make a new key for an existing workspace: that would lock the old data away for good.
      throw new Error("The workspace exists but its encryption key is missing from the system keychain. Restore the keychain entry, or move workspace.db aside to start fresh.");
    }
    if (!key) {
      key = randomBytes(32).toString("hex");
      try {
        await this.d.keychain.set(MEMORY_KEY, key);
      } catch {
        /* checked below */
      }
      if ((await this.d.keychain.get(MEMORY_KEY)) !== key) {
        throw new Error("The system keychain is not available, so the encryption key cannot be stored safely. Unlock or install a keychain (on Linux, a Secret Service such as GNOME Keyring), then start again.");
      }
    }
    const embedder = this.embedder();
    const was = existsSync(path) ? storedDim(path, key) : null;
    if (was !== null && was !== embedder.dim) await this.reembed(path, key, was, embedder);
    this.store = new SqliteMemoryStore({ path, key, dim: embedder.dim });
    this.writer = new MemoryWriter(this.store, embedder, this.clock);
    this.reader = new MemoryReader(this.store, embedder);
    this.tracker = new Tracker(new SqliteTrackerStore(this.store.connection), "VP", this.clock);
    this.buildRouter();
  }

  private buildRouter() {
    const m = this.d.settings.models;
    const make = this.d.makeModel ?? ((ref: ModelRef, k: () => Promise<string>) => makeChatModel(ref, k, this.d.fetch));
    const chosen = [m.heavy, m.cheap, ...(m.fallback ? [m.fallback] : [])];
    const models: Record<string, ChatModel> = {};
    for (const ref of chosen) models[refId(ref)] ??= make(ref, () => this.secret(`provider.${ref.provider}`, KEY_PHRASE[ref.provider]));
    const chain = (ref: ModelRef) => [refId(ref), ...(m.fallback && refId(m.fallback) !== refId(ref) ? [refId(m.fallback)] : [])];
    this.router = new ModelRouter({ roles: { heavy: chain(m.heavy), cheap: chain(m.cheap) }, models, prices: {}, caps: { tokens: m.dailyTokenCap }, clock: this.clock });
  }

  private async reembed(path: string, key: string, oldDim: number, embedder: Embedder) {
    this.emit("status", { message: `Embedding model changed (${oldDim} to ${embedder.dim}). Rebuilding memory search.` });
    const tmp = `${path}.new`;
    rmSync(tmp, { force: true });
    const from = new SqliteMemoryStore({ path, key, dim: oldDim });
    const to = new SqliteMemoryStore({ path: tmp, key, dim: embedder.dim });
    await migrateMemory(from, to, embedder);
    const issues = await new SqliteTrackerStore(from.connection).exportAll();
    await new SqliteTrackerStore(to.connection).importAll(issues);
    await from.close();
    await to.close();
    for (const ext of ["-wal", "-shm"]) rmSync(path + ext, { force: true });
    renameSync(path, `${path}.bak`);
    renameSync(tmp, path);
  }

  /** Startup checks the engine can answer. The desktop app adds World. */
  async checks(): Promise<CheckResult[]> {
    const s = this.d.settings;
    const f = this.d.fetch ?? fetch;
    const probes: Partial<Record<(typeof CHECKS)[number]["id"], Probe>> = {
      clock: async () => {
        try {
          return await clockProbe(async () => new Date((await f("https://api.anthropic.com", { method: "HEAD" })).headers.get("date") ?? Date.now()), this.clock)();
        } catch {
          return { status: "degraded", message: "Could not check the clock (offline?).", fix: "Check your internet connection." };
        }
      },
      power: async () => {
        const st = await statfs(this.d.dataDir);
        const free = st.bavail * st.bsize;
        return free >= 1e9 ? { status: "ok", message: `${(free / 1e9).toFixed(1)} GB free.` } : { status: "degraded", message: `Only ${(free / 1e9).toFixed(1)} GB free.`, fix: "Free up disk space; memory needs at least 1 GB." };
      },
      keychain: async () => {
        await this.d.keychain.set("selftest.probe", "ok");
        const ok = (await this.d.keychain.get("selftest.probe")) === "ok";
        await this.d.keychain.remove("selftest.probe");
        return ok ? { status: "ok", message: "Keychain unlocked." } : { status: "blocking", message: "Keychain did not return the test value.", fix: "Unlock your system keychain, then restart." };
      },
      memory: async () => {
        const d = await this.store.exportAll(false);
        const open = await this.tracker.list();
        return { status: "ok", message: `Memory open and encrypted: ${d.facts.filter((x) => x.validTo === null).length} facts, ${d.episodes.length} episodes, ${open.length} open issues.` };
      },
      gateway: vaultProofProbe(async () => ({ enabled: s.vaultproof.enabled, url: s.vaultproof.mcpUrl, ...((await this.d.keychain.get(s.vaultproof.sessionSecret)) ? { sessionToken: (await this.d.keychain.get(s.vaultproof.sessionSecret))! } : {}) })),
      connectors: async () => ({ status: "off", message: "No accounts connected yet (Gmail and Calendar come with sign-in)." }),
      skills: async () => ({ status: "ok", message: "No skills yet. They are learned from approved work." }),
      agents: async () => {
        buildPrompt({ coreRules: loadCoreRules(), role: loadRole(AGENT), userModel: "", skillsIndex: [], task: { goal: "check", why: "check", doneWhen: ["check"] }, memories: "", working: "" });
        return { status: "ok", message: "Chief of Staff loaded." };
      },
      scheduler: async () => ({ status: "ok", message: this.bot ? "Morning briefing scheduled for 08:00." : "Running. Morning briefing goes out once chat is on." }),
      chat: async () => {
        if (!s.chat.telegram.enabled) return { status: "off", message: "Telegram is off." };
        const token = await this.d.keychain.get("chat.telegram");
        if (!token) return { status: "degraded", message: "Telegram is on but no bot token is saved.", fix: "Add the bot token in Settings > Chat." };
        return { status: "ok", message: "Telegram bot ready." };
      },
      models: async () => {
        for (const p of new Set([s.models.heavy.provider, s.models.cheap.provider])) {
          if (!(await this.d.keychain.get(`provider.${p}`))) return { status: "waiting", message: `Add ${KEY_PHRASE[p]} in Settings > Models to ignite the core.` };
        }
        const t0 = Date.now();
        try {
          const res = await this.router.chat("cheap", "selftest", { maxTokens: 5, messages: [{ role: "user", content: "Reply with: ok" }] });
          return { status: "ok", message: `Test prompt to ${res.attempts.at(-1)!.model} answered in ${Date.now() - t0} ms.` };
        } catch (err) {
          const e = err as Error;
          return { status: "degraded", message: e.message, fix: e instanceof ModelError && e.status === 401 ? "Replace the key in Settings > Models." : "Try again in a minute." };
        }
      },
      decision: async () => ({ status: "off", message: "Jev and Laya are not set up yet; built-in rules decide for now." }),
      voice: async () => ({ status: "off", message: "Voice and camera are off." }),
    };
    const results = await runStartupChecks(probes, (r) => this.emit("check", r));
    return results.filter((r) => r.id !== "world");
  }

  /** The owner talks to the Chief of Staff. Secrets are stripped before anything leaves the machine. */
  /** What the Chief of Staff can do. Reads run directly; writes follow the preset; anything external always needs approval. */
  private tools(): AgentTool[] {
    const str = (v: unknown) => String(v ?? "").trim();
    const pr = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : (Math.max(0, Math.min(4, Math.round(Number(v)))) as 0 | 1 | 2 | 3 | 4));
    const STATUS = ["todo", "doing", "blocked", "done", "cancelled"] as const;
    const status = (v: unknown) => (STATUS.includes(v as never) ? (v as (typeof STATUS)[number]) : undefined);
    const line = (i: { key: string; title: string; status: string; priority: number }) => `${i.key} ${i.title} (${i.status}${i.priority ? `, priority ${i.priority}` : ""})`;
    return [
      {
        spec: { name: "issues_list", description: "List issues in the owner's tracker. Defaults to open issues.", parameters: { type: "object", properties: { status: { type: "string", enum: ["open", ...STATUS], description: "Which issues to list" } } } },
        scope: "issues.read",
        kind: "read",
        describe: () => "List issues",
        run: async (i) => {
          const list = await this.tracker.list({ status: (i.status as "open") ?? "open" });
          return list.length ? list.slice(0, 30).map(line).join("\n") : "No issues.";
        },
      },
      {
        spec: { name: "issues_create", description: "Create an issue in the owner's tracker.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, priority: { type: "integer", description: "0 none, 1 urgent, 2 high, 3 medium, 4 low" } }, required: ["title"] } },
        scope: "issues.write",
        kind: "write",
        describe: (i) => `Create issue: ${str(i.title)}`,
        run: async (i) => {
          const p = pr(i.priority);
          const issue = await this.tracker.create({ title: str(i.title), body: str(i.body), ...(p !== undefined ? { priority: p } : {}), by: AGENT });
          return `Created ${issue.key}: ${issue.title}`;
        },
      },
      {
        spec: { name: "issues_update", description: "Change an issue's status, priority or title.", parameters: { type: "object", properties: { key: { type: "string", description: "Like VP-3" }, status: { type: "string", enum: [...STATUS] }, priority: { type: "integer" }, title: { type: "string" } }, required: ["key"] } },
        scope: "issues.write",
        kind: "write",
        describe: (i) => `Update ${str(i.key)}${i.status ? ` to ${str(i.status)}` : ""}${i.title ? `: ${str(i.title)}` : ""}`,
        run: async (i) => {
          const s = status(i.status);
          const p = pr(i.priority);
          const issue = await this.tracker.update(str(i.key), AGENT, { ...(s ? { status: s } : {}), ...(p !== undefined ? { priority: p } : {}), ...(i.title ? { title: str(i.title) } : {}) });
          return `Updated ${line(issue)}`;
        },
      },
      {
        spec: { name: "issues_comment", description: "Add a comment to an issue.", parameters: { type: "object", properties: { key: { type: "string" }, text: { type: "string" } }, required: ["key", "text"] } },
        scope: "issues.write",
        kind: "write",
        describe: (i) => `Comment on ${str(i.key)}`,
        run: async (i) => (await this.tracker.comment(str(i.key), AGENT, str(i.text)), `Commented on ${str(i.key)}`),
      },
      {
        spec: { name: "memory_search", description: "Search the owner's memory for facts and past events.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        scope: "memory.read",
        kind: "read",
        describe: (i) => `Search memory: ${str(i.query)}`,
        run: async (i) => MemoryReader.format(await this.reader.retrieve(str(i.query), { tokenBudget: 600 })) || "Nothing found.",
      },
      {
        spec: { name: "memory_remember", description: "Save a lasting fact the owner told you (a person, company, preference or decision).", parameters: { type: "object", properties: { subject: { type: "string", description: "Who or what it is about" }, topic: { type: "string", description: "Short label, like role or timing" }, fact: { type: "string" } }, required: ["subject", "fact"] } },
        scope: "memory.write",
        kind: "write",
        describe: (i) => `Remember about ${str(i.subject)}: ${str(i.fact)}`,
        run: async (i) => {
          const r = await this.writer.writeFact({ subject: str(i.subject), attribute: str(i.topic) || "note", claim: str(i.fact), source: "inferred" });
          return { new: "Saved.", update: "Saved; replaced the older version.", duplicate: "Already known.", contradicts: "This conflicts with something the owner stated; sent to the owner to decide.", rejected: "Not saved: too vague." }[r.verdict.kind];
        },
      },
    ];
  }

  /** An approved action finished (or was rejected) after the chat turn ended. */
  private later(r: ActionRecord) {
    this.emit("action", r);
    void this.writer.logEpisode({ agent: AGENT, kind: "action", summary: `${r.summary}: ${r.status}${r.result ? ` (${r.result.slice(0, 200)})` : ""}` }).catch(() => {});
    const msg = r.status === "done" ? `Done: ${r.summary}${r.result ? `\n${r.result.slice(0, 500)}` : ""}` : r.status === "failed" ? `Failed: ${r.summary}\n${r.result ?? ""}` : `Not done: ${r.summary} (${r.result ?? "rejected"})`;
    for (const id of this.d.settings.chat.telegram.ownerChatIds) void this.bot?.notify(id, msg).catch(() => {});
  }

  /** Model requests in chat ("switch heavy work to Gemini") become a proposal the owner confirms. */
  private async modelCommand(text: string): Promise<{ reply: string; proposal?: Proposal } | null> {
    const cmd = parseModelCommand(text);
    if (!cmd) return null;
    const m = this.d.settings.models;
    if (cmd.kind === "show") return { reply: describeModels(m) };
    if (cmd.kind === "clear-backup") {
      if (!m.fallback) return { reply: "There is no backup model set." };
      return { reply: "Remove the backup model?", proposal: this.propose("Remove the backup model", { models: { fallback: null } }) };
    }
    if (!(await this.d.keychain.get(`provider.${cmd.provider}`))) return { reply: `Add ${KEY_PHRASE[cmd.provider]} in Settings > Models first, then ask again.` };
    let available: string[] = [];
    try {
      available = await this.listModels(cmd.provider);
    } catch (err) {
      return { reply: `Could not read ${PROVIDER_LABEL[cmd.provider]} models: ${(err as Error).message}` };
    }
    const jobs = cmd.roles.map((r) => ROLE_LABEL[r]).join(" and ");
    if (!cmd.model) {
      const shown = available.slice(0, 12);
      return { reply: `Which ${PROVIDER_LABEL[cmd.provider]} model for ${jobs}? Your key can use:\n${shown.map((x) => `- ${x}`).join("\n")}${available.length > shown.length ? `\n…and ${available.length - shown.length} more` : ""}\n\nSay, for example: use ${shown[0] ?? "<model id>"} for ${jobs}.` };
    }
    if (available.length && !available.includes(cmd.model)) {
      const close = available.filter((x) => x.includes(cmd.model!.split(/[-/]/)[0] ?? "")).slice(0, 6);
      return { reply: `${cmd.model} is not available with your ${PROVIDER_LABEL[cmd.provider]} key.${close.length ? ` Close matches:\n${close.map((x) => `- ${x}`).join("\n")}` : ""}` };
    }
    const choice = { provider: cmd.provider, model: cmd.model };
    const patch: DeepPartial<Settings> = { models: Object.fromEntries(cmd.roles.map((r) => [r, choice])) };
    return { reply: `Switch ${jobs} to ${PROVIDER_LABEL[cmd.provider]} ${cmd.model}?`, proposal: this.propose(`Use ${PROVIDER_LABEL[cmd.provider]} ${cmd.model} for ${jobs}`, patch) };
  }

  private propose(summary: string, patch: DeepPartial<Settings>): Proposal {
    applyUpdate(this.d.settings, patch); // validate now, so a bad proposal is never shown
    const p = { id: randomBytes(3).toString("hex"), summary, patch };
    this.proposals.set(p.id, p);
    return p;
  }

  /** The owner confirmed a proposal: save settings (same file the app uses) and switch models right away. */
  async applyProposal(id: string): Promise<{ applied: boolean; summary: string; settings: Settings }> {
    const p = this.proposals.get(id);
    if (!p) return { applied: false, summary: "That change expired or was already applied.", settings: this.d.settings };
    const next = applyUpdate(this.d.settings, p.patch);
    const file = join(this.d.dataDir, "settings.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
    renameSync(`${file}.tmp`, file);
    this.d.settings = next;
    this.proposals.delete(id);
    this.buildRouter();
    this.emit("settings", next);
    return { applied: true, summary: `Done: ${p.summary}.`, settings: next };
  }

  async chat(text: string): Promise<{ reply: string; memories: string[]; redacted: string[]; proposal?: Proposal; actions?: ActionRecord[] }> {
    if (this.stopped) return { reply: "All agents are stopped. Resume them to continue.", memories: [], redacted: [] };
    const command = await this.modelCommand(text);
    if (command) {
      this.turns.push({ from: "owner", text }, { from: "agent", text: command.reply });
      return { reply: command.reply, memories: [], redacted: [], ...(command.proposal ? { proposal: command.proposal } : {}) };
    }
    const { clean, findings } = redactSecrets(text.slice(0, 8000));
    const memories = await this.reader.retrieve(clean, { tokenBudget: 800 });
    const open = (await this.tracker.list()).slice(0, 10);
    const recent = this.turns.slice(-10).map((t) => `${t.from === "owner" ? "Owner" : "You"}: ${t.text}`).join("\n");
    const p = buildPrompt({
      coreRules: loadCoreRules(),
      role: loadRole(AGENT),
      userModel: await this.userModel(),
      skillsIndex: [],
      task: { goal: "Reply to the owner's latest message", why: "The owner is talking to you directly", doneWhen: ["answers the message directly", "cites memory ids when memory is used", "says plainly when something is not known"] },
      memories: MemoryReader.format(memories),
      working: [recent && `Recent conversation:\n${recent}`, open.length ? `Open issues:\n${open.map((i) => `- ${i.key} ${i.title} (${i.status})`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
    });
    let reply: string;
    let actions: ActionRecord[] = [];
    try {
      const policy = loadPolicy(AGENT);
      const out = await runAgent({
        agent: AGENT,
        chat: (req) => this.router.chat("heavy", AGENT, req),
        system: p.system,
        messages: [{ role: "user", content: `${p.user}\n\n# Owner's message\n${clean}` }],
        tools: this.tools(),
        policy,
        taskScopes: policy.allow,
        preset: this.d.settings.preset,
        approvals: this.approvals,
        onLater: (r) => this.later(r),
      });
      actions = out.actions;
      reply = out.text || (actions.length ? actions.map((a) => `${a.status === "waiting" ? "Waiting for you" : a.status === "done" ? "Done" : a.status}: ${a.summary}`).join("\n") : "(no reply)");
      for (const a of actions) if (a.status === "done") await this.writer.logEpisode({ agent: AGENT, kind: "action", summary: `${a.summary}: done` });
    } catch (err) {
      reply = err instanceof SpendCapError ? `${err.message}. Raise it in Settings > Models or wait until tomorrow.` : (err as Error).message;
    }
    if (findings.length) reply = `I removed ${findings.map((f) => f.name).join(", ")} from your message before sending it.\n\n${reply}`;
    this.turns.push({ from: "owner", text: clean }, { from: "agent", text: reply });
    this.turns = this.turns.slice(-40);
    await this.writer.logEpisode({ agent: AGENT, kind: "chat", summary: `Owner: ${clean.slice(0, 300)} | Reply: ${reply.slice(0, 300)}` });
    return { reply, memories: memories.map((m) => m.id), redacted: findings.map((f) => f.name), ...(actions.length ? { actions } : {}) };
  }

  /** Onboarding interview answers become stated facts about the owner. Empty answers are skipped. */
  async saveProfile(p: Record<string, string>): Promise<{ saved: number }> {
    const labels: Record<string, string> = { name: "name", role: "role", priorities: "current priorities", people: "key people", hours: "working hours", style: "preferred style" };
    let saved = 0;
    for (const [k, attr] of Object.entries(labels)) {
      const v = (p[k] ?? "").trim().slice(0, 500);
      if (!v) continue;
      const r = await this.writer.writeFact({ subject: "Owner", attribute: attr, claim: `${attr}: ${redactSecrets(v).clean}`, source: "stated" });
      if (r.factId !== undefined) saved++;
    }
    return { saved };
  }

  /** The owner's profile as one block for prompts. */
  async userModel(): Promise<string> {
    const claims = await this.store.currentClaims("Owner");
    return claims.length ? claims.map((c) => `- ${c}`).join("\n") : "The owner has not shared a profile yet. Prefer short, direct answers.";
  }

  /** Models the saved key can use, read from the provider. */
  async listModels(provider: ModelRef["provider"]): Promise<string[]> {
    return listModels(provider, await this.secret(`provider.${provider}`, KEY_PHRASE[provider]), this.d.fetch ?? fetch);
  }

  /** Cheap one-shot model test for onboarding. */
  async testModel(): Promise<{ ok: boolean; message: string }> {
    const t0 = Date.now();
    try {
      await this.router.chat("cheap", "selftest", { maxTokens: 5, messages: [{ role: "user", content: "Reply with: ok" }] });
      return { ok: true, message: `Connected. ${refId(this.d.settings.models.cheap)} answered in ${Date.now() - t0} ms.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async brief(): Promise<string> {
    const b = await composeBrief({ sources: { issues: this.tracker.briefSource() }, userModel: await this.userModel(), needsYou: this.approvals.pending().map((a) => a.summary), chat: (req) => this.router.chat("heavy", AGENT, req) });
    return b.text;
  }

  issues() {
    return {
      list: (p: { status?: "open" | "todo" | "doing" | "blocked" | "done" | "cancelled" } = {}) => this.tracker.list({ status: p.status ?? "open" }),
      create: (p: { title: string; body?: string; priority?: 0 | 1 | 2 | 3 | 4; labels?: string[] }) => this.tracker.create({ ...p, by: "owner" }),
      update: (p: { key: string; status?: "todo" | "doing" | "blocked" | "done" | "cancelled"; priority?: 0 | 1 | 2 | 3 | 4; title?: string }) => this.tracker.update(p.key, "owner", p),
      get: (p: { key: string }) => this.tracker.get(p.key),
    };
  }

  /** The owner approves or rejects a queued action (desktop card or Telegram). */
  decide(id: string, approve: boolean): string {
    if (approve && this.stopped) return "Agents are stopped. Resume them first.";
    try {
      const a = this.approvals.decide(id.trim(), approve);
      return a.status === "approved" ? `Approved: ${a.summary}` : a.status === "expired" ? `Expired: ${a.summary}` : `Rejected: ${a.summary}`;
    } catch (err) {
      return (err as Error).message.replace(/^approvals: /, "");
    }
  }

  pendingApprovals() {
    return this.approvals.pending();
  }

  /** Emergency stop: cancel tasks, reject pending approvals, refuse new work until resumed. */
  kill(agent = "all"): string {
    this.stopped = agent === "all" ? true : this.stopped;
    const t = this.board.cancelAgent(agent);
    const a = this.approvals.rejectAll(agent);
    return `Stopped ${agent === "all" ? "all agents" : agent}: ${t} tasks cancelled, ${a} approvals rejected.`;
  }

  resume(): string {
    this.stopped = false;
    return "Agents resumed.";
  }

  status(): string {
    const sp = this.router.spend();
    return [`Agents: ${this.stopped ? "stopped" : "running"}`, `Tokens today: ${sp.tokens.toLocaleString("en-US")} of ${this.d.settings.models.dailyTokenCap.toLocaleString("en-US")}`, `Waiting for you: ${this.approvals.pending().length}`].join("\n");
  }

  /** Starts the Telegram bot and the morning briefing when chat is turned on and a token is saved. */
  async startChat(): Promise<boolean> {
    const t = this.d.settings.chat.telegram;
    const token = await this.d.keychain.get("chat.telegram");
    if (!t.enabled || !token || this.bot) return false;
    const actions: BotActions = {
      brief: () => this.brief(),
      tasks: () => this.board.list().filter((x) => !["done", "cancelled"].includes(x.status)).map((x) => `- ${x.title} (${x.status})`).join("\n") || "No open tasks.",
      status: () => this.status(),
      approve: (id) => this.decide(id, true),
      reject: (id) => this.decide(id, false),
      undo: () => "Nothing to undo.",
      kill: (a) => this.kill(a),
      message: async (text) => {
        const r = await this.chat(text);
        return r.proposal ? `${r.reply}\nReply /apply ${r.proposal.id} to confirm.` : r.reply;
      },
      apply: async (id) => (await this.applyProposal(id)).summary,
    };
    this.bot = new ChatBot(new TelegramClient(token, this.d.fetch ?? fetch), t.ownerChatIds, actions, (m) => this.emit("log", { source: "telegram", message: m }));
    void this.bot.start();
    this.scheduler.add({ name: "morning-brief", at: "08:00", run: async () => { for (const id of t.ownerChatIds) await this.bot?.handle({ update_id: 0, message: { message_id: 0, chat: { id }, from: { id }, text: "/brief" } }); } });
    return true;
  }

  async close(): Promise<void> {
    this.bot?.stop();
    this.scheduler.stop();
    await this.store?.close();
  }

  readiness(results: CheckResult[]) {
    return summarize(results);
  }
}
