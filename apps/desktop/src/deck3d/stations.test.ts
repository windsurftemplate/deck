import { describe, expect, it } from "vitest";
import { STATIONS, stationForAgent, stationStatus } from "./stations";

describe("deck stations", () => {
  it("every crew member has a station", () => {
    for (const a of ["chief-of-staff", "gtm", "code", "ops", "research"]) expect(stationForAgent(a)).toBeTruthy();
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
  });
  it("approvals outrank work; a stop darkens everything", () => {
    expect(stationStatus("running", 1, false)).toBe("needs");
    expect(stationStatus("running", 0, false)).toBe("working");
    expect(stationStatus("failed", 0, false)).toBe("blocked");
    expect(stationStatus("running", 2, true)).toBe("idle");
  });
});
