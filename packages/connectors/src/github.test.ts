import { describe, expect, it } from "vitest";
import { GitHubRepo } from "./index.js";

describe("GitHub proposals", () => {
  it("branches, commits, opens a labelled pull request, and never touches the default branch", async () => {
    const calls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      const m = init?.method ?? "GET";
      const path = u.replace("https://api.github.com/repos/vp/deck", "");
      calls.push(`${m} ${path}`);
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (m === "GET" && path === "") return j({ default_branch: "main" });
      if (m === "GET" && path === "/git/ref/heads/main") return j({ object: { sha: "abc" } });
      if (m === "POST" && path === "/git/refs") return j({}, 201);
      if (m === "GET" && path.startsWith("/contents/README.md")) return j({ sha: "f1" });
      if (m === "GET" && path.startsWith("/contents/")) return j({}, 404);
      if (m === "PUT") return j({}, 201);
      if (m === "POST" && path === "/pulls") return j({ html_url: "https://github.com/vp/deck/pull/7", number: 7 }, 201);
      if (m === "POST" && path === "/issues/7/labels") return j([]);
      return j({}, 500);
    }) as unknown as typeof fetch;
    const gh = new GitHubRepo("vp/deck", "t", f);
    const r = await gh.propose({ title: "Add SSO notes", body: "Why", files: [{ path: "README.md", content: "x" }, { path: "docs/sso.md", content: "y" }] });
    expect(r.url).toBe("https://github.com/vp/deck/pull/7");
    expect(r.branch).toMatch(/^agent\/add-sso-notes-/);
    expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(2);
    expect(calls.some((c) => c.includes("merge"))).toBe(false);
    expect(calls).toContain("POST /issues/7/labels");
    await expect(gh.read("../secrets")).rejects.toThrow(/not allowed/);
    expect(() => new GitHubRepo("bad repo", "t")).toThrow(/owner\/name/);
  });
});
