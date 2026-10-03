import { describe, expect, it, vi } from "vitest";
import { ApprovalQueue, Idempotent, UndoWindow, actionKey, redactSecrets } from "./index.js";

const fakeKey = (prefix: string, n: number) => prefix + "a1B2c3D4e5".repeat(Math.ceil(n / 10)).slice(0, n);

describe("secret scanner", () => {
  it("redacts each kind of secret and counts them", () => {
    const text = [
      `anthropic ${fakeKey("sk-ant-api03-", 40)}`,
      `vp ${fakeKey("vp-proj-", 24)}`,
      "aws " + "AKIA" + "ABCDEFGHIJKLMNOP",
      `gh ${fakeKey("ghp_", 36)}`,
      "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIabc\n-----END RSA " + "PRIVATE KEY-----",
      "pass" + "word: hunter2hunter2",
      ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlLXZhbHVl"].join("."),
    ].join("\n");
    const { clean, findings } = redactSecrets(text);
    expect(clean).not.toMatch(/sk-ant|vp-proj-a|AKIA|ghp_|MIIabc|hunter2|eyJhbG/);
    expect(findings.map((f) => f.name).sort()).toEqual(["AWS access key", "Anthropic key", "GitHub token", "JWT", "VaultProof token", "password assignment", "private key"].sort());
  });

  it("leaves ordinary text alone", () => {
    const s = "Meet Dana at 10:00 about the Q2 pilot. Pricing is $99 per month.";
    expect(redactSecrets(s)).toEqual({ clean: s, findings: [] });
  });
});

describe("approvals", () => {
  it("holds the action until the owner decides", async () => {
    const changes: string[] = [];
    const q = new ApprovalQueue((a) => changes.push(a.status));
    const { approval, decision } = q.request({ agent: "gtm", summary: "Send email to dana@acme.com", detail: "Hi Dana...", scope: "gmail.send" });
    expect(q.pending()).toHaveLength(1);
    q.decide(approval.id, true);
    expect((await decision).status).toBe("approved");
    expect(() => q.decide(approval.id, true)).toThrow(/already approved/);
    expect(changes).toEqual(["pending", "approved"]);
  });

  it("expires stale requests so old approvals cannot be used", () => {
    let now = 0;
    const q = new ApprovalQueue(() => {}, () => now, 1000);
    const { approval } = q.request({ agent: "gtm", summary: "s", detail: "d", scope: "gmail.send" });
    now = 5000;
    expect(q.decide(approval.id, true).status).toBe("expired");
  });

  it("kill switch rejects everything pending for an agent", () => {
    const q = new ApprovalQueue();
    q.request({ agent: "gtm", summary: "a", detail: "", scope: "x" });
    q.request({ agent: "ops", summary: "b", detail: "", scope: "x" });
    expect(q.rejectAll("gtm")).toBe(1);
    expect(q.pending().map((a) => a.agent)).toEqual(["ops"]);
  });
});

describe("undo window", () => {
  it("runs the action after the window unless undone", async () => {
    vi.useFakeTimers();
    const u = new UndoWindow(60_000);
    const send = vi.fn(async () => "sent");
    const a = u.schedule("a", send);
    const b = u.schedule("b", send);
    expect(u.undo("b")).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await a).toEqual({ status: "done", value: "sent" });
    expect(await b).toEqual({ status: "undone" });
    expect(send).toHaveBeenCalledOnce();
    expect(u.undo("a")).toBe(false);
    vi.useRealTimers();
  });
});

describe("idempotency", () => {
  it("never repeats a side effect for the same task, tool and args", async () => {
    const i = new Idempotent();
    const send = vi.fn(async () => "msg-123");
    const k = actionKey("t1", "gmail.send", { to: "a@x.com", body: "hi" });
    expect(actionKey("t1", "gmail.send", { body: "hi", to: "a@x.com" })).toBe(k);
    const [r1, r2] = await Promise.all([i.run(k, send), i.run(k, send)]);
    const r3 = await i.run(k, send);
    expect(send).toHaveBeenCalledOnce();
    expect([r1.replayed, r2.replayed, r3.replayed]).toEqual([false, true, true]);
    expect(r3.result).toBe("msg-123");
  });

  it("allows a retry after a failure", async () => {
    const i = new Idempotent();
    let n = 0;
    const flaky = async () => (++n === 1 ? Promise.reject(new Error("timeout")) : "ok");
    await expect(i.run("k", flaky)).rejects.toThrow("timeout");
    expect(await i.run("k", flaky)).toEqual({ result: "ok", replayed: false });
  });
});
