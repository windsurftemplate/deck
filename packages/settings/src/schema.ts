/**
 * App settings that are safe to store in a plain file. Secrets (tokens, keys) never go here;
 * they live in the OS keychain and are referenced by name only.
 */
export interface VaultProofSettings {
  /** Connect to the VaultProof MCP server. Off until the server launches. */
  enabled: boolean;
  /** MCP endpoint (Streamable HTTP). Empty until set. */
  mcpUrl: string;
  /** Keychain entry holding the session from VaultProof sign-in. Never the token itself. */
  sessionSecret: "vaultproof.session";
}

/** Which database adapter holds the workspace. Only SQLite ships today; adapters plug in behind the same interfaces. */
export type StorageEngine = "sqlite";

export interface ModelSettings {
  /** Model ids per role. */
  heavy: string;
  cheap: string;
  /** Daily token budget across all agents (always on). */
  dailyTokenCap: number;
}

export interface Settings {
  version: 1;
  storage: { engine: StorageEngine };
  models: ModelSettings;
  /** local: free and private, runs on this machine. openai: uses the OpenAI key. Changing it re-embeds memory. */
  embeddings: { provider: "local" | "openai" };
  /** How much the crew may do without asking. Shapes approval defaults. */
  preset: "cautious" | "balanced" | "autonomous";
  onboarding: { done: boolean };
  /** Telegram front door. The bot token lives in the keychain as "chat.telegram". */
  chat: { telegram: { enabled: boolean; ownerChatIds: number[] } };
  general: { startAtLogin: boolean; runInBackground: boolean };
  vaultproof: VaultProofSettings;
  boot: { animation: "full" | "quick" | "off"; sound: boolean; narration: boolean };
}

export const DEFAULTS: Settings = {
  version: 1,
  storage: { engine: "sqlite" },
  models: { heavy: "claude-sonnet-5", cheap: "claude-haiku-4-5-20251001", dailyTokenCap: 2_000_000 },
  embeddings: { provider: "local" },
  preset: "balanced",
  onboarding: { done: false },
  chat: { telegram: { enabled: false, ownerChatIds: [] } },
  general: { startAtLogin: true, runInBackground: true },
  vaultproof: { enabled: false, mcpUrl: "", sessionSecret: "vaultproof.session" },
  boot: { animation: "full", sound: false, narration: false },
};

export class SettingsError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = "SettingsError";
  }
}

/** The URL must be https (http only for local testing) and carry no credentials or query secrets. */
export function validateMcpUrl(raw: string): string {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new SettingsError("vaultproof.mcpUrl", "Enter a full URL, for example https://vaultproof.dev/...");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new SettingsError("vaultproof.mcpUrl", "Use https. Plain http is only allowed for localhost.");
  if (u.username || u.password) throw new SettingsError("vaultproof.mcpUrl", "Remove the username or password from the URL; sign-in happens separately.");
  if ([...u.searchParams.keys()].some((k) => /token|key|secret|auth/i.test(k))) throw new SettingsError("vaultproof.mcpUrl", "Remove tokens from the URL; sign-in happens separately.");
  return u.toString();
}

export const isVaultProofHost = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === "vaultproof.dev" || h.endsWith(".vaultproof.dev");
  } catch {
    return false;
  }
};

/** Merge a partial update over current settings, validating what changed. Unknown keys are dropped. */
export function applyUpdate(current: Settings, patch: DeepPartial<Settings>): Settings {
  const next: Settings = structuredClone(current);
  if (patch.storage?.engine !== undefined && patch.storage.engine !== "sqlite") throw new SettingsError("storage.engine", "Only the SQLite database is available today.");
  if (patch.models) {
    const m = patch.models;
    for (const k of ["heavy", "cheap"] as const) {
      if (m[k] !== undefined) {
        if (!/^[a-z0-9][a-z0-9.\-]{2,80}$/.test(m[k]!)) throw new SettingsError(`models.${k}`, "Model ids are lowercase letters, digits, dots and dashes.");
        next.models[k] = m[k]!;
      }
    }
    if (m.dailyTokenCap !== undefined) {
      if (!Number.isInteger(m.dailyTokenCap) || m.dailyTokenCap < 10_000 || m.dailyTokenCap > 1_000_000_000) throw new SettingsError("models.dailyTokenCap", "Set a daily token budget between 10,000 and 1,000,000,000.");
      next.models.dailyTokenCap = m.dailyTokenCap;
    }
  }
  if (patch.embeddings?.provider !== undefined) {
    if (!["local", "openai"].includes(patch.embeddings.provider)) throw new SettingsError("embeddings.provider", "Choose local or openai.");
    next.embeddings.provider = patch.embeddings.provider;
  }
  if (patch.chat?.telegram) {
    const t = patch.chat.telegram;
    if (t.ownerChatIds !== undefined) {
      const ids = (t.ownerChatIds as unknown[]).map(Number);
      if (ids.some((n) => !Number.isSafeInteger(n) || n === 0)) throw new SettingsError("chat.telegram.ownerChatIds", "Chat ids are whole numbers, like 123456789.");
      next.chat.telegram.ownerChatIds = [...new Set(ids)];
    }
    if (t.enabled !== undefined) next.chat.telegram.enabled = !!t.enabled;
    if (next.chat.telegram.enabled && !next.chat.telegram.ownerChatIds.length) throw new SettingsError("chat.telegram.ownerChatIds", "Add your Telegram chat id before turning the bot on.");
  }
  if (patch.preset !== undefined) {
    if (!["cautious", "balanced", "autonomous"].includes(patch.preset)) throw new SettingsError("preset", "Choose cautious, balanced or autonomous.");
    next.preset = patch.preset;
  }
  if (patch.onboarding?.done !== undefined) next.onboarding.done = !!patch.onboarding.done;
  if (patch.general) Object.assign(next.general, pick(patch.general, ["startAtLogin", "runInBackground"]));
  if (patch.boot) {
    if (patch.boot.animation && !["full", "quick", "off"].includes(patch.boot.animation)) throw new SettingsError("boot.animation", "Choose full, quick or off.");
    Object.assign(next.boot, pick(patch.boot, ["animation", "sound", "narration"]));
  }
  if (patch.vaultproof) {
    if (patch.vaultproof.mcpUrl !== undefined) next.vaultproof.mcpUrl = patch.vaultproof.mcpUrl.trim() ? validateMcpUrl(patch.vaultproof.mcpUrl) : "";
    if (patch.vaultproof.enabled !== undefined) next.vaultproof.enabled = !!patch.vaultproof.enabled;
    if (next.vaultproof.enabled && !next.vaultproof.mcpUrl) throw new SettingsError("vaultproof.mcpUrl", "Add the VaultProof MCP server URL before turning it on.");
  }
  return next;
}

/** Load stored JSON safely: anything missing or invalid falls back to defaults. */
export function parseSettings(json: string | null | undefined): Settings {
  if (!json) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(json) as DeepPartial<Settings>;
    // Apply each section on its own so one bad section falls back to defaults without losing the rest.
    let out = structuredClone(DEFAULTS);
    for (const key of ["storage", "models", "embeddings", "preset", "onboarding", "general", "boot", "vaultproof", "chat"] as const) {
      if (raw[key] === undefined) continue;
      try {
        out = applyUpdate(out, { [key]: raw[key] } as DeepPartial<Settings>);
      } catch {
        /* keep the default for this section */
      }
    }
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
export type { DeepPartial };
