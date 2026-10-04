import { describe, expect, it } from "vitest";
import { isOpenAIReasoning, pickOpenAIModels } from "./index.js";

describe("OpenAI model auto-pick", () => {
  it("recognizes reasoning models, including future names", () => {
    for (const id of ["o3", "o4-mini", "gpt-5", "gpt-5.5", "gpt-6-astra", "gpt-10"]) expect(isOpenAIReasoning(id), id).toBe(true);
    for (const id of ["gpt-4.1", "gpt-4o", "gpt-5-chat-latest", "gpt-realtime-2", "gpt-5-search-api", "text-embedding-3-small"]) expect(isOpenAIReasoning(id), id).toBe(false);
  });
  it("picks the newest full model for heavy work and the newest mini for cheap work", () => {
    const ids = ["gpt-4o", "o3", "o3-pro", "o4-mini", "gpt-5", "gpt-5-mini", "gpt-5-2025-08-07", "gpt-5.5", "gpt-5.5-pro", "gpt-5.5-mini", "gpt-5.6-codex", "gpt-5-chat-latest", "gpt-5-nano"];
    expect(pickOpenAIModels(ids)).toEqual({ heavy: "gpt-5.5", cheap: "gpt-5.5-mini" });
    expect(pickOpenAIModels(["o3", "o4-mini", "gpt-4o"])).toEqual({ heavy: "o3", cheap: "o4-mini" });
    expect(pickOpenAIModels(["gpt-4o"])).toEqual({});
  });
});
