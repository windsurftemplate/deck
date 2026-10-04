/**
 * GitHub for the Engineering agent (Labs): read files, and propose changes as a pull request on a new branch.
 * It never merges, never pushes to the default branch, and never deletes.
 */
export class GitHubRepo {
  private api = "https://api.github.com";
  constructor(
    private repo: string,
    private token: string,
    private f: typeof fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Repository must look like owner/name.");
  }
  private async call<T>(method: string, path: string, body?: unknown, okMissing = false): Promise<T | null> {
    const res = await this.f(`${this.api}/repos/${this.repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "deck" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (okMissing && res.status === 404) return null;
    if (res.status === 401) throw new Error("GitHub rejected the token. Check it in Settings, Labs.");
    if (res.status === 403) throw new Error("The GitHub token is not allowed to do that. It needs contents and pull requests access to this repository.");
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${method} ${path.split("?")[0]}.`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
  private async defaultBranch() {
    return (await this.call<{ default_branch: string }>("GET", ""))!.default_branch;
  }
  private clean(path: string) {
    const p = path.replace(/^\/+/, "");
    if (p.split("/").some((s) => s === ".." || s === ".git")) throw new Error("That path is not allowed.");
    return p.split("/").map(encodeURIComponent).join("/");
  }
  async list(path = ""): Promise<string> {
    const items = await this.call<{ name: string; type: string; size: number }[] | { name: string }>("GET", `/contents/${this.clean(path)}`, undefined, true);
    if (!items) return `Nothing at ${path || "the root"}.`;
    return Array.isArray(items) ? items.map((i) => `${i.type === "dir" ? "dir " : "file"} ${i.name}${i.type === "file" ? ` (${i.size} bytes)` : ""}`).join("\n") : `${path} is a file.`;
  }
  async read(path: string): Promise<string> {
    const f = await this.call<{ content?: string; encoding?: string; size: number }>("GET", `/contents/${this.clean(path)}`, undefined, true);
    if (!f) return `No file at ${path}.`;
    if (f.size > 200_000 || !f.content) return `${path} is too large to read here (${f.size} bytes).`;
    return Buffer.from(f.content, "base64").toString("utf8");
  }
  /** Creates a branch, commits the files to it, opens a pull request labelled agent-proposal, and returns its link. */
  async propose(p: { title: string; body: string; files: { path: string; content: string }[] }): Promise<{ url: string; number: number; branch: string }> {
    if (!p.files.length || p.files.length > 20) throw new Error("A proposal changes 1 to 20 files.");
    const base = await this.defaultBranch();
    const ref = await this.call<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(base)}`);
    const branch = `agent/${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "change"}-${Date.now().toString(36)}`;
    await this.call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: ref!.object.sha });
    for (const file of p.files) {
      const path = this.clean(file.path);
      const existing = await this.call<{ sha: string }>("GET", `/contents/${path}?ref=${encodeURIComponent(branch)}`, undefined, true);
      await this.call("PUT", `/contents/${path}`, { message: `${p.title} (${file.path})`, content: Buffer.from(file.content, "utf8").toString("base64"), branch, ...(existing ? { sha: existing.sha } : {}) });
    }
    const pr = (await this.call<{ html_url: string; number: number }>("POST", "/pulls", { title: p.title, head: branch, base, body: `${p.body}\n\n_Opened by deck's Engineering agent. Review before merging; the agent cannot merge._` }))!;
    await this.call("POST", `/issues/${pr.number}/labels`, { labels: ["agent-proposal"] }).catch(() => null);
    return { url: pr.html_url, number: pr.number, branch };
  }
}
