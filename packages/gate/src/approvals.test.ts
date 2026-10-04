import { describe, expect, it } from "vitest";

describe("approval reviews", () => {
  it("attach an advisory opinion to a pending request without deciding it", async () => {
    const { ApprovalQueue } = await import("./index.js");
    const seen: string[] = [];
    const q = new ApprovalQueue((a) => seen.push(`${a.status}:${a.review?.risk ?? "-"}`));
    const { approval } = q.request({ agent: "gtm", summary: "Send email", detail: "to x", scope: "gmail.send" });
    expect(q.setReview(approval.id, { risk: "high", text: "External recipient not in memory.", by: "ciso" })).toBe(true);
    expect(q.pending()[0]!.status).toBe("pending");
    expect(q.pending()[0]!.review?.risk).toBe("high");
    q.decide(approval.id, false);
    expect(q.setReview(approval.id, { risk: "low", text: "late", by: "ciso" })).toBe(false);
    expect(seen).toEqual(["pending:-", "pending:high", "rejected:high"]);
  });
});
