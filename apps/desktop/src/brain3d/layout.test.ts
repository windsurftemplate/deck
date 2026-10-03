import { describe, expect, it } from "vitest";
import { layout3d } from "./layout";

describe("brain layout", () => {
  it("places linked nodes closer than unlinked ones, deterministically", () => {
    const ids = ["a", "b", "c", "d"].map((id) => ({ id, size: 1 }));
    const nodes = layout3d(ids, [{ source: "a", target: "b" }, { source: "c", target: "d" }]);
    const p = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const dist = (x: string, y: string) => Math.hypot(p[x]!.x - p[y]!.x, p[x]!.y - p[y]!.y, p[x]!.z - p[y]!.z);
    expect(dist("a", "b")).toBeLessThan(dist("a", "c"));
    expect(layout3d(ids, [])[0]).toEqual(layout3d(ids, [])[0]);
    expect(nodes.every((n) => Number.isFinite(n.x + n.y + n.z))).toBe(true);
  });
});
