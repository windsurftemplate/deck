import { describe, expect, it } from "vitest";
import { routeComplexity } from "./index.js";

describe("complexity routing", () => {
  it("sends short lookups and simple actions to the cheap model", () => {
    for (const t of ["hi", "thanks!", "Remember that Sam prefers calls on Fridays", "Create an issue to call Dana tomorrow", "What's on my calendar today?", "How many open issues?"]) expect(routeComplexity(t).level, t).toBe("simple");
  });
  it("sends thinking, writing, delegation and anything unclear to the heavy model", () => {
    for (const t of ["Research Acme's latest funding", "Draft a follow-up to Dana", "Compare Okta and Auth0 for our pilot", "Have GTM review the pipeline", "Every Monday at 9 review stale issues", "Acme", "Thoughts on the board deck structure and whether we should lead with traction or the team given the market?"]) expect(routeComplexity(t).level, t).toBe("complex");
    expect(routeComplexity("ok do it", 4).level).toBe("simple");
  });
});
