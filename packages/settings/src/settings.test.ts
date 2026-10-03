import { describe, expect, it } from "vitest";
import { DEFAULTS, applyUpdate, isVaultProofHost, parseSettings, validateMcpUrl } from "./index.js";

describe("storage setting", () => {
  it("defaults to SQLite and refuses engines that are not built yet", () => {
    expect(DEFAULTS.storage.engine).toBe("sqlite");
    expect(() => applyUpdate(DEFAULTS, { storage: { engine: "postgres" as "sqlite" } })).toThrow(/Only the SQLite/);
  });
});

describe("VaultProof setting", () => {
  it("is off by default with no URL", () => {
    expect(DEFAULTS.vaultproof).toEqual({ enabled: false, mcpUrl: "", sessionSecret: "vaultproof.session" });
  });

  it("accepts an https MCP URL and recognizes vaultproof.dev", () => {
    const s = applyUpdate(DEFAULTS, { vaultproof: { mcpUrl: "https://mcp.vaultproof.dev/mcp", enabled: true } });
    expect(s.vaultproof).toMatchObject({ enabled: true, mcpUrl: "https://mcp.vaultproof.dev/mcp" });
    expect(isVaultProofHost(s.vaultproof.mcpUrl)).toBe(true);
    expect(isVaultProofHost("https://vaultproof.dev.evil.com/mcp")).toBe(false);
  });

  it("refuses unsafe URLs", () => {
    expect(() => validateMcpUrl("http://vaultproof.dev/mcp")).toThrow(/https/);
    expect(() => validateMcpUrl("https://user:pw@vaultproof.dev/mcp")).toThrow(/username or password/);
    expect(() => validateMcpUrl("https://vaultproof.dev/mcp?token=abc")).toThrow(/tokens/);
    expect(() => validateMcpUrl("vaultproof.dev")).toThrow(/full URL/);
    expect(validateMcpUrl("http://localhost:8787/mcp")).toBe("http://localhost:8787/mcp");
  });

  it("cannot be turned on without a URL", () => {
    expect(() => applyUpdate(DEFAULTS, { vaultproof: { enabled: true } })).toThrow(/URL before turning it on/);
  });

  it("loads stored settings safely and drops a bad VaultProof entry", () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("{not json")).toEqual(DEFAULTS);
    const bad = parseSettings(JSON.stringify({ vaultproof: { enabled: true, mcpUrl: "http://evil.com" }, boot: { sound: true } }));
    expect(bad.vaultproof.enabled).toBe(false);
    expect(bad.boot.sound).toBe(true);
  });
});

describe("models, embeddings and chat settings", () => {
  it("has safe defaults", () => {
    expect(DEFAULTS.embeddings.provider).toBe("local");
    expect(DEFAULTS.chat.telegram).toEqual({ enabled: false, ownerChatIds: [] });
    expect(DEFAULTS.models.dailyTokenCap).toBe(2_000_000);
  });
  it("validates model ids, token budget, provider and chat ids", () => {
    expect(() => applyUpdate(DEFAULTS, { models: { heavy: { provider: "anthropic", model: "Claude Sonnet!" } } })).toThrow(/exact id/);
    expect(() => applyUpdate(DEFAULTS, { models: { heavy: { provider: "mistral" as "openai", model: "m" } } })).toThrow(/Choose Anthropic/);
    expect(() => applyUpdate(DEFAULTS, { models: { dailyTokenCap: 5 } })).toThrow(/between/);
    expect(() => applyUpdate(DEFAULTS, { embeddings: { provider: "cohere" as "local" } })).toThrow(/local or openai/);
    expect(() => applyUpdate(DEFAULTS, { chat: { telegram: { enabled: true } } })).toThrow(/chat id/);
    expect(() => applyUpdate(DEFAULTS, { chat: { telegram: { ownerChatIds: [1.5] } } })).toThrow(/whole numbers/);
    const s = applyUpdate(DEFAULTS, { chat: { telegram: { ownerChatIds: [42, 42], enabled: true } }, models: { heavy: { provider: "gemini", model: "gemini-x" }, fallback: { provider: "openai", model: "gpt-x" } } });
    expect(s.chat.telegram).toEqual({ enabled: true, ownerChatIds: [42] });
    expect(s.models.heavy).toEqual({ provider: "gemini", model: "gemini-x" });
    expect(s.models.fallback).toEqual({ provider: "openai", model: "gpt-x" });
    expect(applyUpdate(s, { models: { fallback: null } }).models.fallback).toBeNull();
    expect(applyUpdate(DEFAULTS, { models: { cheap: { provider: "openrouter", model: "vendor/model-name:free" } } }).models.cheap.model).toBe("vendor/model-name:free");
  });
});

it("a bad section falls back on its own", () => {
  const s = parseSettings(JSON.stringify({ chat: { telegram: { enabled: true } }, models: { heavy: "claude-opus-5-5" } }));
  expect(s.chat.telegram.enabled).toBe(false);
  expect(s.models.heavy).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
});

it("preset and onboarding", () => {
  expect(DEFAULTS.preset).toBe("balanced");
  expect(DEFAULTS.onboarding.done).toBe(false);
  expect(applyUpdate(DEFAULTS, { preset: "cautious", onboarding: { done: true } })).toMatchObject({ preset: "cautious", onboarding: { done: true } });
  expect(() => applyUpdate(DEFAULTS, { preset: "yolo" as "cautious" })).toThrow(/cautious, balanced or autonomous/);
});

it("voice is off by default and needs whisper.cpp paths to turn on", () => {
  expect(DEFAULTS.voice.enabled).toBe(false);
  expect(() => applyUpdate(DEFAULTS, { voice: { enabled: true } })).toThrow(/whisper.cpp/);
  expect(applyUpdate(DEFAULTS, { voice: { enabled: true, whisperBin: "/opt/whisper-cli", modelPath: "/opt/ggml-base.en.bin" } }).voice.enabled).toBe(true);
});
