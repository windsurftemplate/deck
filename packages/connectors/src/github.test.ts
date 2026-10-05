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

describe("pull requests for the brief", () => {
  it("lists open, non-draft pull requests with their check status", async () => {
    const f = (async (url: string) => {
      if (url.includes("/pulls?")) return new Response(JSON.stringify([{ number: 7, title: "Add CISO", draft: false, head: { sha: "a1" } }, { number: 8, title: "WIP", draft: true, head: { sha: "b2" } }, { number: 9, title: "Fix bundle", draft: false, head: { sha: "c3" } }]));
      if (url.endsWith("/commits/a1/status")) return new Response(JSON.stringify({ state: "success", total_count: 2 }));
      if (url.endsWith("/commits/c3/status")) return new Response(JSON.stringify({ state: "failure", total_count: 1 }));
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const prs = await new GitHubRepo("windsurftemplate/deck", "t", f).awaitingReview();
    expect(prs).toEqual([
      { repo: "windsurftemplate/deck", number: 7, title: "Add CISO", checks: "passing" },
      { repo: "windsurftemplate/deck", number: 9, title: "Fix bundle", checks: "failing" },
    ]);
  });
});
