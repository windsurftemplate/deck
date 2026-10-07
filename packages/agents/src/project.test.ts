import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChatResponse } from "@deck/models";
import { commandsFromGuide, commandsFromManifests, formatProjectGuide, loadProjectGuide, testEvidence, testRunIn, verifyWork, type ActionRecord, type ProjectFiles } from "./index.js";

/** A project held in memory: path -> text. Folders are derived from the paths. */
const project = (files: Record<string, string>): ProjectFiles => ({
  read: async (p) => files[p] ?? null,
  list: async (d) => [...new Set(Object.keys(files).filter((p) => (d ? p.startsWith(`${d}/`) : true)).map((p) => (d ? p.slice(d.length + 1) : p)).map((r) => (r.includes("/") ? `${r.split("/")[0]}/` : r)))],
});

const sh = (command: string, exitCode: number | null, risk: "read" | "write" | "network" = "write", timedOut = false): ActionRecord => ({ tool: risk === "read" ? "shell_read" : "shell_run", summary: `Run in the sandbox: ${command}`, status: "done", result: `exit ${exitCode}`, shell: { command, risk, exitCode, timedOut } });

describe("project guide", () => {
  it("states this repository's own test command and conventions without being told", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const real: ProjectFiles = {
      read: async (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null),
      list: async () => [],
    };
    const g = await loadProjectGuide(real);
    expect(g.commands.test).toBe("pnpm check");
    expect(g.commandSources.test).toBe("AGENTS.md");
    expect(g.files[0]!.path).toBe("AGENTS.md");
    expect(g.files.some((f) => f.path === "CLAUDE.md")).toBe(false); // it only points at AGENTS.md
    expect(formatProjectGuide(g)).toContain("Conventional commits");
  });

  it("prefers the guide over build files, falls back to build files, and lists decision records", async () => {
    const g = await loadProjectGuide(
      project({
        "README.md": "# Tool\n\nRun the suite:\n\n```bash\n$ make test  # all of it\npnpm install\n```\n",
        "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "tsc", lint: "eslint ." } }),
        "pnpm-lock.yaml": "lockfileVersion: 9",
        "docs/adr/0001-use-sqlite.md": "# Use SQLite",
        "docs/adr/template.md": "# Template",
      }),
    );
    expect(g.commands).toEqual({ test: "make test", build: "pnpm build", lint: "pnpm lint" });
    expect(g.commandSources).toEqual({ test: "README.md", build: "package.json", lint: "package.json" });
    expect(g.decisions).toEqual(["docs/adr/0001-use-sqlite.md"]);
  });

  it("reads commands from common build files", () => {
    expect(commandsFromManifests({ "Cargo.toml": "[package]" }).commands.test).toBe("cargo test");
    expect(commandsFromManifests({ "go.mod": "module x" }).commands.test).toBe("go test ./...");
    expect(commandsFromManifests({ "pyproject.toml": "[project]" }).commands.test).toBe("pytest");
    expect(commandsFromManifests({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }).commands.test).toBeUndefined();
    expect(commandsFromManifests({ "package.json": JSON.stringify({ scripts: { test: "jest" } }) }).commands.test).toBe("npm test");
    expect(commandsFromManifests({ Makefile: "build:\n\tcc\ncheck:\n\t./t\n" }).commands).toEqual({ test: "make check", build: "make build" });
  });

  it("ignores install and release commands and picks the plainest build", () => {
    const c = commandsFromGuide("```\npnpm install\npnpm --filter @x/app build -- --config a.json\npnpm build\nnpm publish\n```");
    expect(c).toEqual({ build: "pnpm build" });
  });

  it("cuts long guides to the budget and says so", async () => {
    const note = "\n[... cut; read the full file if needed]".length;
    const g = await loadProjectGuide(project({ "AGENTS.md": "a".repeat(5000), "CONTRIBUTING.md": "c".repeat(300), "README.md": "b".repeat(5000) }), 4000);
    // The agent guide comes first and keeps the most; each later file keeps at least its reserve.
    expect(g.files.map((f) => [f.path, f.text.length])).toEqual([["AGENTS.md", 2400 + note], ["CONTRIBUTING.md", 300], ["README.md", 1300 + note]]);
  });
});

describe("tests as ground truth", () => {
  it("knows when a command line's exit code is the tests' exit code", () => {
    expect(testRunIn("pnpm check", "pnpm check")).toBe("proof");
    expect(testRunIn("CI=1 pnpm check --reporter=dot", "pnpm check")).toBe("proof");
    expect(testRunIn("pnpm build && pnpm check", "pnpm check")).toBe("proof");
    expect(testRunIn("pnpm check | tail -20", "pnpm check")).toBe("hidden");
    expect(testRunIn("pnpm check || true", "pnpm check")).toBe("hidden");
    expect(testRunIn("pnpm check; echo done", "pnpm check")).toBe("hidden");
    expect(testRunIn("pnpm --filter x test", "pnpm check")).toBeNull(); // not the project's command
    expect(testRunIn("echo pnpm check", "pnpm check")).toBeNull();
    expect(testRunIn("npx vitest run")).toBe("proof"); // no known command: any test runner
    expect(testRunIn("cat test.txt")).toBeNull();
  });

  it("a change with a passing run afterwards is proven; reads alone need nothing", () => {
    expect(testEvidence([sh("cat a.ts", 0, "read")])).toEqual({ changed: false, missing: [] });
    const ok = testEvidence([sh("sed -i s/a/b/ a.ts", 0), sh("pnpm check", 0)], "pnpm check");
    expect(ok.missing).toEqual([]);
    expect(ok.run).toMatchObject({ passed: true });
  });

  it("a change that breaks a test is not finished, whatever the agent says", () => {
    expect(testEvidence([sh("sed -i s/a/b/ a.ts", 0), sh("pnpm check", 1)], "pnpm check").missing[0]).toMatch(/must pass after the last change.*exited 1/);
    // Tests passed, then another change: the earlier run proves nothing.
    expect(testEvidence([sh("sed -i s/a/b/ a.ts", 0), sh("pnpm check", 0), sh("mv a.ts b.ts", 0)], "pnpm check").missing[0]).toMatch(/No test run after the last change/);
    expect(testEvidence([sh("touch a.ts", 0), sh("pnpm check | tail", 0)], "pnpm check").missing[0]).toMatch(/exit code was hidden/);
    expect(testEvidence([sh("touch a.ts", 0), sh("pnpm check", null, "write", true)], "pnpm check").missing[0]).toMatch(/timed out/);
    // A pull request proposed without any test run is not finished either.
    expect(testEvidence([{ tool: "repo_propose", summary: "Open a pull request", status: "waiting" }]).missing).toHaveLength(1);
  });

  it("without a known project a run is not required, but a failing one still fails", () => {
    expect(testEvidence([sh("touch notes.txt", 0)], undefined, false).missing).toEqual([]);
    expect(testEvidence([sh("touch a.js", 0), sh("npm test", 1)], undefined, false).missing).toHaveLength(1);
  });

  it("the verifier fails unproven code changes even when the checker model and judge say it is done", async () => {
    const yes = async (): Promise<ChatResponse> => ({ text: '{"missing": []}', model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const actions = [sh("sed -i s/a/b/ a.ts", 0), sh("pnpm check", 1)];
    const v = await verifyWork({ goal: "Fix the bug", doneWhen: ["the bug is fixed"], report: "Fixed and all tests pass.", actions, chat: yes, judge: async () => ({ passed: true, missing: [], checked: true }), requireTests: { command: "pnpm check" } });
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toMatch(/exited 1/);
    const fine = await verifyWork({ goal: "Fix the bug", doneWhen: ["the bug is fixed"], report: "Fixed.", actions: [...actions, sh("pnpm check", 0)], chat: yes, requireTests: { command: "pnpm check" } });
    expect(fine).toEqual({ passed: true, missing: [], checked: true });
  });
});

describe("tests as ground truth in the agent loop", () => {
  it("an agent that says done without running tests is sent back, and finishes once they pass", async () => {
    const { ApprovalQueue } = await import("@deck/gate");
    const { runAgent } = await import("./index.js");
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const exit = { "pnpm check": 0 } as Record<string, number>;
    const shell = {
      spec: { name: "shell_run", description: "Run", parameters: { type: "object" as const, properties: { command: { type: "string" } }, required: ["command"] } },
      scope: "shell.run",
      kind: "write" as const,
      describe: (i: Record<string, unknown>) => `Run ${String(i.command)}`,
      // The model is told exit 0 in the text for every command; only the structured fact counts.
      run: async (i: Record<string, unknown>) => ({ text: "exit 0", shell: { command: String(i.command), risk: "write" as const, exitCode: exit[String(i.command)] ?? 0, timedOut: false } }),
    };
    const turns: ChatResponse[] = [
      { text: "", toolCalls: [{ type: "tool_call", id: "1", name: "shell_run", input: { command: "sed -i s/a/b/ a.ts" } }], model: "m", stopReason: "tool_use", usage },
      { text: "Fixed; tests pass.", model: "m", stopReason: "end_turn", usage },
      { text: "", toolCalls: [{ type: "tool_call", id: "2", name: "shell_run", input: { command: "pnpm check" } }], model: "m", stopReason: "tool_use", usage },
      { text: "Fixed; pnpm check passes.", model: "m", stopReason: "end_turn", usage },
    ];
    const seen: string[] = [];
    const out = await runAgent({
      agent: "code",
      chat: async (req) => (seen.push(JSON.stringify(req.messages)), turns.shift() ?? { text: '{"missing": []}', model: "m", stopReason: "end_turn", usage }),
      system: [{ type: "text", text: "rules" }],
      messages: [{ role: "user", content: "fix it" }],
      tools: [shell],
      policy: { agent: "code", allow: ["shell.run"], requiresApproval: [], deny: [] },
      taskScopes: ["shell.run"],
      preset: "balanced",
      approvals: new ApprovalQueue(),
      maxTurns: 8,
      verify: { goal: "Fix the bug", doneWhen: ["the bug is fixed"], chat: async () => ({ text: '{"missing": []}', model: "m", stopReason: "end_turn", usage }), requireTests: { command: "pnpm check" } },
    });
    expect(seen.some((s) => s.includes("No test run after the last change"))).toBe(true);
    expect(out.verdict).toEqual({ passed: true, missing: [], checked: true });
    expect(out.actions.map((a) => a.shell?.command)).toEqual(["sed -i s/a/b/ a.ts", "pnpm check"]);
  });
});
