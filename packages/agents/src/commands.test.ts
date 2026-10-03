import { describe, expect, it } from "vitest";
import { describeModels, parseModelCommand } from "./index.js";

describe("model commands from chat", () => {
  it("switches everything when no job is named", () => {
    expect(parseModelCommand("Switch to Gemini")).toEqual({ kind: "switch", roles: ["heavy", "cheap"], provider: "gemini", model: null });
    expect(parseModelCommand("use gpt-x-mini for everything")).toEqual({ kind: "switch", roles: ["heavy", "cheap"], provider: "openai", model: "gpt-x-mini" });
  });

  it("targets a named job and picks up an explicit model id", () => {
    expect(parseModelCommand("use claude-opus-5-5 for heavy work")).toEqual({ kind: "switch", roles: ["heavy"], provider: "anthropic", model: "claude-opus-5-5" });
    expect(parseModelCommand("set quick tasks to gemini-flash-x")).toEqual({ kind: "switch", roles: ["cheap"], provider: "gemini", model: "gemini-flash-x" });
    expect(parseModelCommand("make OpenRouter vendor/model-a the backup, use it")).toMatchObject({ roles: ["fallback"], provider: "openrouter", model: "vendor/model-a" });
  });

  it("answers what is in use and clears the backup", () => {
    expect(parseModelCommand("Which models are you using?")).toEqual({ kind: "show" });
    expect(parseModelCommand("remove the backup model")).toEqual({ kind: "clear-backup" });
  });

  it("ignores normal conversation", () => {
    expect(parseModelCommand("Draft a reply to Dana at Google about the pilot")).toBeNull();
    expect(parseModelCommand("What did Claude Shannon invent?")).toBeNull();
    expect(parseModelCommand("Prep me for the Acme call")).toBeNull();
    expect(parseModelCommand("Use Google Docs for the plan")).toBeNull();
    expect(parseModelCommand("switch to the Google model")).toMatchObject({ provider: "gemini" });
  });

  it("describes the current setup", () => {
    expect(describeModels({ heavy: { provider: "anthropic", model: "a" }, cheap: { provider: "gemini", model: "g" }, fallback: null })).toBe("Heavy work: Claude a\nQuick tasks: Gemini g\nBackup: none");
  });
});
