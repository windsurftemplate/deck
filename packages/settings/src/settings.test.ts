import { describe, expect, it } from "vitest";
import { DEFAULTS, applyUpdate, isVaultProofHost, parseSettings, validateMcpUrl } from "./index.js";

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
