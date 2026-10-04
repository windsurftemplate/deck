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

export type Provider = "anthropic" | "openai" | "gemini" | "openrouter" | "ollama";
export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "openrouter", "ollama"];
export interface ModelChoice {
  provider: Provider;
  model: string;
}

export interface PluginServer {
  id: string;
  name: string;
  /** MCP Streamable HTTP address (https, or http on this machine) */
  url: string;
  enabled: boolean;
  /** Tools the server marks read-only may run without asking. Off: every call asks you. */
  trustReadOnly: boolean;
}

export interface Labs {
  /** Simple requests go to the cheap model, hard ones to the heavy model. */
  routing: boolean;
  /** Local models through Ollama (no key, nothing leaves the machine). */
  ollama: { enabled: boolean; baseUrl: string };
  /** The Chief of Staff can hand several tasks out at once. */
  fanout: boolean;
  /** Crew votes: each member answers on its own, then they rank each other's answers. */
  consensus: boolean;
  /** Outside MCP servers as tools. */
  plugins: { enabled: boolean; servers: PluginServer[] };
  /** Engineering can open pull requests (never merge) in one repository. */
  github: { enabled: boolean; repo: string };
  /** Gmail and Calendar, read only, plus Gmail drafts. */
  google: { enabled: boolean; clientId: string };
  /** Talk to crews on other computers you trust; every outgoing message needs your approval. */
  federation: { enabled: boolean; port: number; name: string };
  /** 3D deck extras. */
  tours: boolean;
  powerUp3d: boolean;
}

export interface ModelSettings {
  /** Which provider and model handles each role. */
  heavy: ModelChoice;
  cheap: ModelChoice;
  /** Tried when the main model fails (down, rate limited). Usually a different provider. */
  fallback: ModelChoice | null;
  /** Daily token budget across all agents (always on). */
  dailyTokenCap: number;
  /** A crew member's own main model, chosen with the model arena. Others use heavy. */
  agents: Partial<Record<"chief-of-staff" | "gtm" | "ops" | "code" | "research", ModelChoice>>;
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
  /** Command deck view: the 3D station or a simple list (lighter on older machines). */
  world: { view: "3d" | "brain" | "list" };
  /** Push-to-talk in the app. Speech is turned into text on this machine with whisper.cpp; audio is never kept. */
  voice: {
    enabled: boolean;
    whisperBin: string;
    modelPath: string;
    speakReplies: boolean;
    /** Hands-free: listen for the wake word, then take the request. Audio stays on this machine. */
    handsFree: boolean;
    wakeWord: string;
  };
  /** Desktop notifications when deck is in the background. */
  notifications: { enabled: boolean };
  /** How agents think: a plan step for complex work, built-in model reasoning for hard work. */
  thinking: { mode: "auto" | "always" | "off"; reasoning: "low" | "medium" | "high" };
  /** Labs: features that are off until you turn them on. Each has its own settings. */
  labs: Labs;
  /** Camera snapshots in chat. The camera is on only while you take a picture; pictures go to your chosen model and are not stored. */
  camera: { enabled: boolean };
  /** Outside tools the crew can use. Keys live in the OS keychain, never here. */
  tools: { jev: { enabled: boolean; baseUrl: string } };
  /** Telegram front door. The bot token lives in the keychain as "chat.telegram". */
  chat: { telegram: { enabled: boolean; ownerChatIds: number[] } };
  general: { startAtLogin: boolean; runInBackground: boolean };
  vaultproof: VaultProofSettings;
  boot: { animation: "full" | "quick" | "off"; sound: boolean; narration: boolean };
}

export const DEFAULTS: Settings = {
  version: 1,
  storage: { engine: "sqlite" },
  models: { heavy: { provider: "anthropic", model: "claude-sonnet-5" }, cheap: { provider: "anthropic", model: "claude-haiku-4-5-20251001" }, fallback: null, dailyTokenCap: 2_000_000, agents: {} },
  embeddings: { provider: "local" },
  preset: "balanced",
  onboarding: { done: false },
  world: { view: "3d" },
  voice: { enabled: false, whisperBin: "", modelPath: "", speakReplies: false, handsFree: false, wakeWord: "deck" },
  notifications: { enabled: true },
  thinking: { mode: "auto", reasoning: "medium" },
  labs: {
    routing: false,
    ollama: { enabled: false, baseUrl: "http://localhost:11434" },
    fanout: false,
    consensus: false,
    plugins: { enabled: false, servers: [] },
    github: { enabled: false, repo: "" },
    google: { enabled: false, clientId: "" },
    federation: { enabled: false, port: 7787, name: "" },
    tours: false,
    powerUp3d: false,
  },
  camera: { enabled: false },
  tools: { jev: { enabled: false, baseUrl: "" } },
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

/** Accepts {provider, model}, or an old plain model id (treated as Anthropic). */
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/;
function applyLabs(cur: Labs, p: DeepPartial<Labs>): Labs {
  const n: Labs = JSON.parse(JSON.stringify(cur));
  for (const k of ["routing", "fanout", "consensus", "tours", "powerUp3d"] as const) if (p[k] !== undefined) n[k] = !!p[k];
  if (p.ollama) {
    if (p.ollama.baseUrl !== undefined) {
      const u = String(p.ollama.baseUrl).trim().replace(/\/+$/, "");
      if (!LOCAL_HTTP.test(u) && !/^https:\/\/[^\s@/]+(\/\S*)?$/.test(u)) throw new SettingsError("labs.ollama.baseUrl", "Use http://localhost:11434 or an https address.");
      n.ollama.baseUrl = u;
    }
    if (p.ollama.enabled !== undefined) n.ollama.enabled = !!p.ollama.enabled;
  }
  if (p.plugins) {
    if (p.plugins.enabled !== undefined) n.plugins.enabled = !!p.plugins.enabled;
    if (p.plugins.servers !== undefined) {
      const list = (p.plugins.servers as PluginServer[]).slice(0, 12).map((x) => {
        const url = String(x.url ?? "").trim();
        if (!LOCAL_HTTP.test(url) && !/^https:\/\/[^\s@/]+(\/\S*)?$/.test(url)) throw new SettingsError("labs.plugins", `${x.name || "A plugin"}: use an https address, or http on this machine.`);
        const name = String(x.name ?? "").trim().slice(0, 40);
        if (!name) throw new SettingsError("labs.plugins", "Every plugin needs a name.");
        const id = String(x.id || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "plugin";
        return { id, name, url, enabled: !!x.enabled, trustReadOnly: !!x.trustReadOnly };
      });
      if (new Set(list.map((x) => x.id)).size !== list.length) throw new SettingsError("labs.plugins", "Two plugins have the same name.");
      n.plugins.servers = list;
    }
  }
  if (p.github) {
    if (p.github.repo !== undefined) {
      const r = String(p.github.repo).trim();
      if (r && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new SettingsError("labs.github.repo", "Use owner/name, like vaultproof/deck.");
      n.github.repo = r;
    }
    if (p.github.enabled !== undefined) n.github.enabled = !!p.github.enabled;
  }
  if (p.google) {
    if (p.google.clientId !== undefined) {
      const c = String(p.google.clientId).trim();
      if (c && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(c)) throw new SettingsError("labs.google.clientId", "Paste the client id that ends in .apps.googleusercontent.com.");
      n.google.clientId = c;
    }
    if (p.google.enabled !== undefined) n.google.enabled = !!p.google.enabled;
  }
  if (p.federation) {
    if (p.federation.port !== undefined) {
      const port = Number(p.federation.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new SettingsError("labs.federation.port", "Use a port between 1024 and 65535.");
      n.federation.port = port;
    }
    if (p.federation.name !== undefined) n.federation.name = String(p.federation.name).trim().slice(0, 40);
    if (p.federation.enabled !== undefined) n.federation.enabled = !!p.federation.enabled;
  }
  return n;
}

function toChoice(v: unknown, field: string): ModelChoice {
  const c = typeof v === "string" ? { provider: "anthropic", model: v } : (v as Partial<ModelChoice>);
  if (!c || !PROVIDERS.includes(c.provider as Provider)) throw new SettingsError(field, "Choose Anthropic, OpenAI, Gemini, OpenRouter or Ollama.");
  const model = String(c.model ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{1,120}$/.test(model)) throw new SettingsError(field, "Pick a model from the list, or type its exact id.");
  return { provider: c.provider as Provider, model };
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
    const m = patch.models as DeepPartial<ModelSettings> & { heavy?: unknown; cheap?: unknown; fallback?: unknown };
    for (const k of ["heavy", "cheap", "fallback"] as const) {
      if (m[k] === undefined) continue;
      if (k === "fallback" && m[k] === null) {
        next.models.fallback = null;
        continue;
      }
      next.models[k] = toChoice(m[k], `models.${k}`);
    }
    if (m.agents !== undefined) {
      const out: ModelSettings["agents"] = { ...next.models.agents };
      for (const [agent, choice] of Object.entries(m.agents ?? {})) {
        if (!["chief-of-staff", "gtm", "ops", "code", "research"].includes(agent)) throw new SettingsError("models.agents", `Unknown agent ${agent}.`);
        if (choice === null) delete out[agent as keyof typeof out];
        else out[agent as keyof typeof out] = toChoice(choice, `models.agents.${agent}`);
      }
      next.models.agents = out;
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
  if (patch.voice) {
    for (const k of ["whisperBin", "modelPath"] as const) if (patch.voice[k] !== undefined) next.voice[k] = String(patch.voice[k]).trim();
    if (patch.voice.enabled !== undefined) next.voice.enabled = !!patch.voice.enabled;
    if (patch.voice.speakReplies !== undefined) next.voice.speakReplies = !!patch.voice.speakReplies;
    if (patch.voice.handsFree !== undefined) next.voice.handsFree = !!patch.voice.handsFree;
    if (patch.voice.wakeWord !== undefined) {
      const w = String(patch.voice.wakeWord).trim().toLowerCase();
      if (!/^[a-z][a-z ]{1,19}$/.test(w)) throw new SettingsError("voice.wakeWord", "Use a short word or two, letters only.");
      next.voice.wakeWord = w;
    }
    if (next.voice.handsFree && !next.voice.enabled) throw new SettingsError("voice", "Turn on push-to-talk first; hands-free uses the same speech setup.");
    if (next.voice.enabled && (!next.voice.whisperBin || !next.voice.modelPath)) throw new SettingsError("voice", "Set the whisper.cpp program and model file before turning voice on.");
  }
  if (patch.camera?.enabled !== undefined) next.camera.enabled = !!patch.camera.enabled;
  if (patch.notifications?.enabled !== undefined) next.notifications.enabled = !!patch.notifications.enabled;
  if (patch.labs) next.labs = applyLabs(next.labs, patch.labs as DeepPartial<Labs>);
  if (patch.thinking) {
    const t = patch.thinking;
    if (t.mode !== undefined) {
      if (!["auto", "always", "off"].includes(t.mode)) throw new SettingsError("thinking.mode", "Choose auto, always or off.");
      next.thinking.mode = t.mode;
    }
    if (t.reasoning !== undefined) {
      if (!["low", "medium", "high"].includes(t.reasoning)) throw new SettingsError("thinking.reasoning", "Choose low, medium or high.");
      next.thinking.reasoning = t.reasoning;
    }
  }
  if (patch.tools?.jev) {
    const j = patch.tools.jev;
    if (j.baseUrl !== undefined) {
      const u = String(j.baseUrl).trim();
      if (u && !/^https:\/\/[^\s/@]+(\/[^\s]*)?$/.test(u)) throw new SettingsError("tools.jev.baseUrl", "Use an https address, without a username or password.");
      next.tools.jev.baseUrl = u;
    }
    if (j.enabled !== undefined) next.tools.jev.enabled = !!j.enabled;
  }
  if (patch.world?.view !== undefined) {
    if (!["3d", "brain", "list"].includes(patch.world.view)) throw new SettingsError("world.view", "Choose 3d, brain or list.");
    next.world.view = patch.world.view;
  }
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
  const usesOllama = [next.models.heavy, next.models.cheap, next.models.fallback, ...Object.values(next.models.agents ?? {})].some((m) => m?.provider === "ollama");
  if (usesOllama && !next.labs.ollama.enabled) throw new SettingsError("models", "Turn on local models (Ollama) in Settings, Labs first.");
  return next;
}

/** Load stored JSON safely: anything missing or invalid falls back to defaults. */
export function parseSettings(json: string | null | undefined): Settings {
  if (!json) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(json) as DeepPartial<Settings>;
    // Apply each section on its own so one bad section falls back to defaults without losing the rest.
    let out = structuredClone(DEFAULTS);
    for (const key of ["storage", "models", "embeddings", "preset", "onboarding", "world", "voice", "camera", "tools", "notifications", "labs", "thinking", "general", "boot", "vaultproof", "chat"] as const) {
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
