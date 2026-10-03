import { describe, expect, it } from "vitest";
import { arcPath, coreLit } from "./checks";

describe("power-up ring", () => {
  it("draws arcs that start at the top and stay on the ring", () => {
    expect(arcPath(0, 10)).toMatch(/^M185\.2 30\.1 A150 150 0 0 1/);
  });
  it("lights the core only when models are up and nothing blocks", () => {
    expect(coreLit([{ id: "models", name: "Models", status: "ok", message: "" }])).toBe(true);
    expect(coreLit([{ id: "models", name: "Models", status: "waiting", message: "" }])).toBe(false);
    expect(coreLit([{ id: "models", name: "Models", status: "ok", message: "" }, { id: "gateway", name: "Gateway", status: "blocking", message: "" }])).toBe(false);
  });
});
