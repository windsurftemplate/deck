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
    "chat.send": (p) => engine.chat(String((p as { text?: string })?.text ?? "")),
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
  process.stderr.write(`engine failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});
