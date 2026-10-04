#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseSettings } from "@deck/settings";
import { Engine } from "./engine.js";
import { memoryKeychain, osKeychain } from "./keychain.js";
import { handleLine, type Handler } from "./protocol.js";

/** Started by the desktop app with its data folder. Talks JSON lines over stdin and stdout; logs go to stderr. */
async function main() {
  const dataDir = process.argv[2] ?? process.env.DECK_DATA_DIR;
  if (!dataDir) {
    process.stderr.write("usage: deck-engine <data-dir>\n");
    process.exit(2);
  }
  const write = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  const readSettings = () => {
    try {
      return parseSettings(readFileSync(join(dataDir, "settings.json"), "utf8"));
    } catch {
      return parseSettings(null);
    }
  };
  // DECK_TEST_KEYCHAIN=memory is for automated tests only: secrets are not persisted or protected.
  const keychain = process.env.DECK_TEST_KEYCHAIN === "memory" ? (process.stderr.write("warning: test keychain in use\n"), memoryKeychain()) : await osKeychain();
  let engine = new Engine({ dataDir, keychain, settings: readSettings(), emit: (event, data) => write({ event, data }) });
  await engine.open();
  await engine.startChat();

  const handlers: Record<string, Handler> = {
    ping: async () => "pong",
    checks: () => engine.checks(),
    "chat.send": (p) => engine.chat(String((p as { text?: string })?.text ?? ""), ((p as { images?: { mediaType: string; data: string }[] })?.images ?? []).slice(0, 5), (p as { threadId?: string })?.threadId),
    "brain.addFile": (p) => { const q = p as { name?: string; data?: string }; return engine.brain.addFile(String(q?.name ?? "file"), String(q?.data ?? "")); },
    "brain.addText": (p) => { const q = p as { title?: string; text?: string }; return engine.brain.addText(String(q?.title ?? ""), String(q?.text ?? "")); },
    "brain.addLink": (p) => engine.brain.addLink(String((p as { url?: string })?.url ?? "")),
    "brain.importMarkdown": (p) => engine.brain.importMarkdown(((p as { files?: { path: string; content: string }[] })?.files ?? []).map((f) => ({ path: String(f.path), content: String(f.content) }))),
    "brain.importNotion": (p) => engine.brain.importNotionZip(String((p as { data?: string })?.data ?? "")),
    "brain.importAppleNotes": () => engine.brain.importAppleNotes(),
    "brain.saveNote": (p) => { const q = p as { id?: number | null; title?: string; text?: string }; return engine.brain.saveNote(typeof q?.id === "number" ? q.id : null, String(q?.title ?? ""), String(q?.text ?? "")); },
    "brain.documents": (p) => engine.brain.documents((p as { kind?: string })?.kind),
    "brain.document": (p) => engine.brain.document(Number((p as { id?: number })?.id)),
    "brain.delete": (p) => engine.brain.remove(Number((p as { id?: number })?.id)),
    "brain.graph": () => engine.brain.graph(),
    "deck.stats": () => engine.deckStats(),
    "tools.list": () => engine.toolsList(),
    "goals.list": () => engine.goalsList(),
    "goals.create": async (p) => engine.goalCreate(p as never),
    "goals.update": async (p) => { const q = p as { id?: string; patch?: object }; return engine.goalUpdate(String(q?.id ?? ""), (q?.patch ?? {}) as never); },
    "goals.delete": async (p) => engine.goalDelete(String((p as { id?: string })?.id ?? "")),
    "goals.plan": (p) => engine.goalPlan(String((p as { id?: string })?.id ?? "")),
    "goals.check": (p) => engine.goalCheck(String((p as { id?: string })?.id ?? "")),
    "issues.setStatus": async (p) => { const q = p as { key?: string; status?: string }; return engine.issues().update({ key: String(q?.key ?? ""), status: q?.status } as never); },
    "arena.run": (p) => { const q = p as { agent?: string; candidates?: { provider: string; model: string }[] }; return engine.arena(String(q?.agent ?? ""), q?.candidates as never); },
    "backup.now": (p) => engine.backupNow(String((p as { passphrase?: string })?.passphrase ?? "")),
    "backup.restore": (p) => { const q = p as { data?: string; passphrase?: string }; return engine.restoreBackup(String(q?.data ?? ""), String(q?.passphrase ?? "")); },
    "learn.tune": (p) => engine.tune(String((p as { agent?: string })?.agent ?? "")),
    "automations.list": async () => engine.automationsList(),
    "automations.create": async (p) => engine.automationCreate(p as never),
    "automations.update": async (p) => { const q = p as { id?: string; patch?: object }; return engine.automationUpdate(String(q?.id ?? ""), (q?.patch ?? {}) as never); },
    "automations.delete": async (p) => engine.automationDelete(String((p as { id?: string })?.id ?? "")),
    "automations.run": (p) => engine.runAutomation(String((p as { id?: string })?.id ?? "")),
    "analytics.get": (p) => engine.analytics(Number((p as { days?: number })?.days ?? 30)),
    "crew.messages": async (p) => { const q = p as { channel?: string; limit?: number; before?: number }; return engine.crewMessages(String(q?.channel ?? "activity"), q?.limit, q?.before); },
    "crew.discussions": async () => engine.discussions(),
    // Starts a discussion and answers at once with its id; messages arrive as events while the crew talks.
    "crew.discuss": (p) => {
      const q = p as { topic?: string; agents?: string[]; rounds?: number };
      return new Promise((resolve, reject) => void engine.crewDiscuss(String(q?.topic ?? ""), q?.agents, q?.rounds, (id) => resolve({ id })).catch(reject));
    },
    "crew.interject": async (p) => { const q = p as { id?: string; text?: string }; return engine.interject(String(q?.id ?? ""), String(q?.text ?? "")); },
    "threads.list": async () => engine.threads.list(),
    "threads.messages": async (p) => engine.threads.messages(String((p as { id?: string })?.id ?? "")),
    "threads.rename": async (p) => engine.threads.rename(String((p as { id?: string })?.id ?? ""), String((p as { title?: string })?.title ?? "")),
    "threads.delete": async (p) => engine.threads.remove(String((p as { id?: string })?.id ?? "")),
    brief: () => engine.brief(),
    status: async () => engine.status(),
    kill: async (p) => engine.kill((p as { agent?: string })?.agent ?? "all"),
    resume: async () => engine.resume(),
    "issues.list": (p) => engine.issues().list((p ?? {}) as never),
    "issues.create": (p) => engine.issues().create(p as never),
    "issues.update": (p) => engine.issues().update(p as never),
    "issues.get": (p) => engine.issues().get(p as never),
    "profile.save": (p) => engine.saveProfile((p ?? {}) as Record<string, string>),
    "models.test": () => engine.testModel(),
    "voice.transcribe": (p) => engine.transcribe(String((p as { audio?: string })?.audio ?? "")),
    "packs.list": async () => engine.packsList(),
    "packs.apply": (p) => engine.applyPack(String((p as { id?: string })?.id ?? "")),
    "crew.info": async () => engine.crewInfo(),
    "crew.update": (p) => engine.crewUpdate(String((p as { agent?: string })?.agent ?? ""), ((p as { override?: object })?.override ?? {}) as never, "settings"),
    "crew.history": () => engine.crewHistory(),
    "crew.undo": () => engine.crewUndo(),
    "learn.now": () => engine.learnNow(),
    "skills.list": () => engine.skillsList(),
    "drafts.list": async () => engine.recentDrafts(),
    "crew.tasks": async () => engine.board.list(),
    "approvals.list": async () => engine.pendingApprovals(),
    "approvals.decide": async (p) => engine.decide(String((p as { id?: string })?.id ?? ""), !!(p as { approve?: boolean })?.approve),
    "settings.apply": (p) => engine.applyProposal(String((p as { id?: string })?.id ?? "")),
    "models.list": (p) => engine.listModels((p as { provider: "anthropic" | "openai" | "gemini" | "openrouter" }).provider),
    /** Settings changed in the app: reopen with the new settings (re-embeds if the embedding model changed). */
    reload: async () => {
      await engine.close();
      engine = new Engine({ dataDir, keychain, settings: readSettings(), emit: (event, data) => write({ event, data }) });
      await engine.open();
      await engine.startChat();
      return "reloaded";
    },
  };

  write({ event: "ready", data: { pid: process.pid } });
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const res = await handleLine(line, handlers);
    if (res) write(res);
  });
  rl.on("close", async () => {
    await engine.close();
    process.exit(0);
  });
}

main().catch((err) => {
  const message = (err as Error).message;
  // Tell the app why, so the power-up screen can show it instead of a generic failure.
  process.stdout.write(JSON.stringify({ event: "fatal", data: { message } }) + "\n");
  process.stderr.write(`engine failed to start: ${message}\n`);
  process.exit(1);
});
