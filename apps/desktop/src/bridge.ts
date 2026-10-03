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
  const native = await invoke<CheckResult[]>("native_checks");
  for (const id of ids) {
    await pause();
    const n = native.find((r) => r.id === id);
    push(n ?? (id === "gateway" ? vaultproof : { id, name: names[id]!, status: "waiting", message: ENGINE_PENDING }));
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
  return next;
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
}
