import type { CheckResult } from "./boot/checks";
import { applyUpdate, parseSettings, type DeepPartial, type Settings } from "@deck/settings";
import { checkKeyShape, type ProviderId } from "@deck/models";

/** True inside the Tauri app; false in a plain browser during UI development. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function listen(event: string, fn: () => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen(event, fn);
}

const ENGINE_PENDING = "Agent engine not connected yet. It ships in the next build step.";

/**
 * Startup checks. Inside the app, Rust answers the native ones (power, keychain);
 * the rest come from the agent engine once it is wired. In a browser, a labeled preview runs.
 */
export async function runChecks(onResult: (r: CheckResult) => void): Promise<{ results: CheckResult[]; preview: boolean }> {
  const ids = ["power", "keychain", "memory", "gateway", "connectors", "skills", "agents", "scheduler", "chat", "world", "models"];
  const names: Record<string, string> = { power: "Power", keychain: "Keychain", memory: "Memory", gateway: "VaultProof", connectors: "Connectors", skills: "Skills", agents: "Agents", scheduler: "Scheduler", chat: "Chat", world: "World", models: "Models" };
  const results: CheckResult[] = [];
  const push = (r: CheckResult) => (results.push(r), onResult(r));
  const pause = () => new Promise((r) => setTimeout(r, 260));

  const vp = (await loadSettings()).vaultproof;
  const vaultproof: CheckResult = vp.enabled
    ? { id: "gateway", name: "VaultProof", status: "waiting", message: "Connection check runs in the agent engine (next build step)." }
    : { id: "gateway", name: "VaultProof", status: "off", message: "Not connected. Turn it on in Settings > VaultProof when the server is live." };

  if (!inTauri) {
    for (const id of ids) {
      await pause();
      push(id === "models" ? { id, name: names[id]!, status: "waiting", message: "Connect an LLM to ignite the core." } : id === "gateway" ? vaultproof : { id, name: names[id]!, status: "ok", message: "Preview only." });
    }
    return { results, preview: true };
  }
  let fromEngine: CheckResult[] | null = null;
  let engineError = ENGINE_PENDING;
  try {
    fromEngine = await invoke<CheckResult[]>("engine_call", { method: "checks" });
  } catch (e) {
    engineError = `Agent engine unavailable: ${String(e)}`;
  }
  const native = fromEngine ? [] : await invoke<CheckResult[]>("native_checks");
  for (const id of ids) {
    await pause();
    if (id === "world") {
      push({ id, name: "World", status: "ok", message: "2D deck ready." });
      continue;
    }
    if (!fromEngine && id === "memory") {
      // Without the engine there is no memory: say why, and stop the power-up here.
      push({ id, name: "Memory", status: "blocking", message: engineError, fix: "Fix the cause above, then restart the app." });
      continue;
    }
    const r = fromEngine?.find((x) => x.id === id) ?? native.find((x) => x.id === id);
    push(r ?? (id === "gateway" ? vaultproof : { id, name: names[id]!, status: "waiting", message: engineError }));
  }
  return { results, preview: false };
}

export const emergencyStop = () => (inTauri ? invoke<void>("emergency_stop") : Promise.resolve());

const LOCAL_KEY = "deck.settings";

/** Settings live in a plain file in the app data folder (no secrets). In a browser preview, localStorage. */
export async function loadSettings(): Promise<Settings> {
  if (!inTauri) return parseSettings(globalThis.localStorage?.getItem(LOCAL_KEY));
  return parseSettings(await invoke<string | null>("settings_get"));
}

/** Validates, saves, and returns the new settings. Throws SettingsError with a field and a plain message. */
export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = applyUpdate(await loadSettings(), patch);
  const json = JSON.stringify(next, null, 2);
  if (inTauri) await invoke("settings_set", { json });
  else globalThis.localStorage?.setItem(LOCAL_KEY, json);
  reloadEngine();
  return next;
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
/** Tell the engine settings or keys changed. Batched so several saves cause one reload. */
function reloadEngine() {
  if (!inTauri) return;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void invoke("engine_call", { method: "reload" }).catch(() => {}), 800);
}

/** Send a message to the Chief of Staff through the engine. */
export type Proposal = { id: string; summary: string };
export type ChatResult = { reply: string; redacted: string[]; proposal?: Proposal; actions?: ActionRecord[]; threadId?: string };
export async function sendChat(text: string, images: { mediaType: string; data: string }[] = [], threadId?: string): Promise<ChatResult> {
  if (!inTauri) return { reply: "Preview mode: the agent engine only runs inside the desktop app.", redacted: [] };
  try {
    return await invoke<ChatResult>("engine_call", { method: "chat.send", params: { text, images, ...(threadId ? { threadId } : {}) } });
  } catch (e) {
    return { reply: `Agent engine unavailable: ${String(e)}`, redacted: [] };
  }
}

/** Telegram bot token: shape check, then keychain. */
export async function saveBotToken(token: string): Promise<string | null> {
  const t = token.trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) return "That does not look like a Telegram bot token (numbers, a colon, then letters).";
  if (inTauri) await invoke("secret_set", { name: "chat.telegram", value: t });
  else previewKeys.set("chat.telegram", t);
  reloadEngine();
  return null;
}
export async function botTokenHint(): Promise<string | null> {
  if (inTauri) return invoke<string | null>("secret_hint", { name: "chat.telegram" });
  const v = previewKeys.get("chat.telegram");
  return v ? v.slice(-4) : null;
}

/** Browser preview has no keychain: keys are held in memory only and vanish on reload. */
const previewKeys = new Map<string, string>();
const keyName = (p: ProviderId) => `provider.${p}`;

/** Saves a developer key to the OS keychain after a shape check. Returns an error message or null. */
export async function saveKey(provider: ProviderId, key: string): Promise<string | null> {
  const problem = checkKeyShape(provider, key);
  if (problem) return problem;
  if (inTauri) await invoke("secret_set", { name: keyName(provider), value: key.trim() });
  else previewKeys.set(keyName(provider), key.trim());
  reloadEngine();
  return null;
}

/** Last 4 characters of a saved key, or null when none is saved. */
export async function keyHint(provider: ProviderId): Promise<string | null> {
  if (inTauri) return invoke<string | null>("secret_hint", { name: keyName(provider) });
  const v = previewKeys.get(keyName(provider));
  return v ? v.slice(-4) : null;
}

export async function removeKey(provider: ProviderId): Promise<void> {
  if (inTauri) await invoke("secret_delete", { name: keyName(provider) });
  else previewKeys.delete(keyName(provider));
  reloadEngine();
}

/** Generic engine call. In the browser preview it returns null so screens can still be walked through. */
export async function engineCall<T>(method: string, params?: unknown): Promise<T | null> {
  if (!inTauri) return null;
  return invoke<T>("engine_call", { method, params });
}

/** Confirm a change the crew proposed in chat (for example switching models). */
export async function applyProposal(id: string): Promise<string> {
  try {
    const r = await engineCall<{ summary: string }>("settings.apply", { id });
    return r?.summary ?? "Preview mode: changes apply inside the desktop app.";
  } catch (e) {
    return `Could not apply: ${String(e)}`;
  }
}

/** The workspace key, for saving in a password manager. Desktop app only. */
export async function revealRecoveryKey(): Promise<string> {
  if (!inTauri) return "preview0000000000000000000000000000000000000000000000000000000000".slice(0, 64);
  return invoke<string>("recovery_key_reveal");
}

/** Put a saved recovery key back and restart the engine. Returns an error message or null. */
export async function restoreRecoveryKey(key: string): Promise<string | null> {
  if (!inTauri) return "Preview mode: restore works inside the desktop app.";
  try {
    await invoke("recovery_key_restore", { key });
    await invoke("engine_restart");
    return null;
  } catch (e) {
    return String(e);
  }
}

export type Approval = { id: string; agent: string; summary: string; detail: string; status: "pending" | "approved" | "rejected" | "expired"; review?: { risk: "low" | "medium" | "high"; text: string; by: string } };
export type ActionRecord = { tool: string; summary: string; status: "done" | "waiting" | "denied" | "failed"; approvalId?: string; result?: string };

/** Engine events (approvals, finished actions). Returns an unsubscribe function. */
export async function onEngineEvent(fn: (event: string, data: unknown) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<{ event: string; data: unknown }>("engine-event", (e) => fn(e.payload.event, e.payload.data));
}

export async function pendingApprovals(): Promise<Approval[]> {
  return (await engineCall<Approval[]>("approvals.list").catch(() => null)) ?? [];
}

export async function decideApproval(id: string, approve: boolean): Promise<string> {
  try {
    return (await engineCall<string>("approvals.decide", { id, approve })) ?? "Preview mode.";
  } catch (e) {
    return String(e);
  }
}

export type Thread = { id: string; title: string; updatedAt: string };
export const listThreads = async () => (await engineCall<Thread[]>("threads.list").catch(() => null)) ?? [];
export const threadMessages = async (id: string) => (await engineCall<{ role: "owner" | "agent"; text: string }[]>("threads.messages", { id }).catch(() => null)) ?? [];
export const renameThread = (id: string, title: string) => engineCall("threads.rename", { id, title });
export const deleteThread = (id: string) => engineCall("threads.delete", { id });
