import { describe, expect, it } from "vitest";
import { matchWake } from "./wake";

describe("wake word", () => {
  it("wakes on the word at the start, with or without a greeting", () => {
    expect(matchWake("Deck, what's on today?", "deck")).toEqual({ woke: true, request: "what's on today?" });
    expect(matchWake("Hey deck. Draft a follow-up to Dana.", "deck")).toEqual({ woke: true, request: "Draft a follow-up to Dana." });
    expect(matchWake(" Okay, deck", "deck")).toEqual({ woke: true, request: "" });
    expect(matchWake("hey computer schedule it", "computer")).toEqual({ woke: true, request: "schedule it" });
  });
  it("ignores the word in the middle or inside other words", () => {
    expect(matchWake("We should update the deck tomorrow", "deck")).toMatchObject({ woke: false });
    expect(matchWake("Decked out", "deck")).toMatchObject({ woke: false });
  });
});
