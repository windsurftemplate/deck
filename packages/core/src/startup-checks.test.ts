import { describe, expect, it } from "vitest";
import { CHECKS, clockProbe, diskProbe, runStartupChecks, summarize, type Probe } from "./index.js";

const ok: Probe = async () => ({ status: "ok", message: "fine" });
const allOk = Object.fromEntries(CHECKS.map((c) => [c.id, ok]));

describe("startup checks", () => {
  it("reports every check in display order", async () => {
    const r = await runStartupChecks(allOk);
    expect(r.map((x) => x.id)).toEqual(CHECKS.map((c) => c.id));
    expect(summarize(r).canStart).toBe(true);
  });

  it("a failed gateway holds models, decision models and connectors", async () => {
    const r = await runStartupChecks({ ...allOk, gateway: async () => ({ status: "blocking", message: "Attestation failed.", fix: "Retry attestation" }) });
    const by = Object.fromEntries(r.map((x) => [x.id, x.status]));
    expect(by).toMatchObject({ gateway: "blocking", models: "waiting", decision: "waiting", connectors: "waiting", skills: "ok" });
    expect(r.find((x) => x.id === "models")!.message).toBe("Waiting on VaultProof.");
    expect(summarize(r)).toMatchObject({ canStart: false, blocking: [{ id: "gateway" }] });
  });

  it("runs keychain before memory and reports a crashed probe as blocking", async () => {
    const order: string[] = [];
    const track = (id: string): Probe => async () => (order.push(id), { status: "ok", message: "" });
    await runStartupChecks({ ...allOk, memory: track("memory"), keychain: track("keychain") });
    expect(order).toEqual(["keychain", "memory"]);
    const r = await runStartupChecks({ ...allOk, skills: async () => { throw new Error("bad signature file"); } });
    expect(r.find((x) => x.id === "skills")).toMatchObject({ status: "blocking", message: "Check crashed: bad signature file" });
  });

  it("first launch: no model yet means the core waits, not an error", async () => {
    const r = await runStartupChecks({ ...allOk, models: async () => ({ status: "waiting", message: "Connect an LLM to ignite the core." }) });
    expect(r.find((x) => x.id === "decision")!.status).toBe("waiting");
    expect(summarize(r).canStart).toBe(true);
  });

  it("features that are switched off show as off", async () => {
    const { voice, ...rest } = allOk;
    void voice;
    expect((await runStartupChecks(rest)).find((x) => x.id === "voice")!.status).toBe("off");
  });

  it("clock and disk probes", async () => {
    const now = () => new Date("2026-10-02T10:00:00Z");
    expect((await clockProbe(async () => new Date("2026-10-02T10:01:00Z"), now)()).status).toBe("ok");
    expect(await clockProbe(async () => new Date("2026-10-02T10:10:00Z"), now)()).toMatchObject({ status: "blocking", message: "Clock is off by 600 seconds." });
    expect((await diskProbe(async () => 41e9)()).message).toBe("41.0 GB free.");
    expect((await diskProbe(async () => 2e8)()).status).toBe("degraded");
  });
});
