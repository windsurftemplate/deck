import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";

/**
 * Sandboxed shell. Commands run inside the operating system's sandbox (sandbox-exec on macOS, bubblewrap on
 * Linux), can only write inside one workspace folder, have no network unless a command is approved for it, and
 * get a clean environment with no keys or tokens. Without a sandbox available, nothing runs.
 */
export type ShellRisk = "read" | "write" | "network" | "blocked";

const READ = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "sort", "uniq", "diff", "pwd", "echo", "stat", "file", "tree", "du", "jq", "which", "date", "basename", "dirname", "realpath", "cut", "tr", "nl", "column"]);
const WRITE = new Set(["mkdir", "touch", "cp", "mv", "rm", "sed", "awk", "tee", "node", "python3", "python", "make", "tsc", "pytest", "go", "cargo", "rustc", "deno", "bun", "ruby", "patch", "tar", "unzip", "zip", "gzip", "gunzip", "chmod", "ln"]);
const NETWORK_TOOLS = new Set(["curl", "wget", "pip", "pip3", "npm", "pnpm", "yarn", "npx", "brew", "gem", "bundle", "apt", "apt-get"]);
const GIT_READ = new Set(["status", "log", "diff", "show", "branch", "blame", "ls-files", "rev-parse", "grep", "remote", "describe", "shortlog"]);
const GIT_NETWORK = new Set(["clone", "fetch", "pull", "push", "submodule", "ls-remote"]);
const BLOCKED: [RegExp, string][] = [
  [/\bsudo\b|\bsu\s|\bdoas\b/, "runs as administrator"],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/, "pipes a download into a shell"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/i, "deletes the home or root folder"],
  [/\b(security|osascript|launchctl|crontab|systemctl|defaults\s+write|scutil|networksetup|pmset|diskutil|dscl|spctl|csrutil|xattr)\b/, "changes system settings or the keychain"],
  [/\b(ssh|scp|sftp|nc|ncat|netcat|telnet|socat)\b/, "opens a remote connection"],
  [/\bchmod\s+[0-7]*[4-7][0-7]{3}\b|\bchmod\s+[ug]\+s\b/, "sets special permissions"],
  [/(^|[\s;&|])(\.\/)?[^\s]*\.(command|app)\b|\bopen\s/, "launches an app"],
  [/\beval\b|\bbase64\s+(-d|--decode)|`|\$\(/, "builds commands at run time"],
  [/>\s*\/(etc|usr|bin|sbin|System|Library)\b|~\/\.(ssh|aws|gnupg|zshrc|bashrc|profile)|\/\.ssh\b|Library\/Keychains/, "touches system or credential files"],
];

/** Classifies a command line by its riskiest part. Pipes, &&, || and ; are checked part by part. */
export function classifyCommand(cmd: string): { risk: ShellRisk; reason: string } {
  const c = cmd.trim();
  if (!c) return { risk: "blocked", reason: "empty command" };
  if (c.length > 2000) return { risk: "blocked", reason: "command is too long" };
  for (const [re, why] of BLOCKED) if (re.test(c)) return { risk: "blocked", reason: why };
  let risk: ShellRisk = "read";
  const rank = { read: 0, write: 1, network: 2, blocked: 3 } as const;
  const raise = (r: ShellRisk) => (rank[r] > rank[risk] ? (risk = r) : risk);
  if (/(^|[^>])>{1,2}(?!&)/.test(c.replace(/2>&1|>\s*\/dev\/null/g, ""))) raise("write");
  for (const part of c.split(/\|\||&&|[|;]/)) {
    const words = part.trim().split(/\s+/).filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
    const head = (words[0] ?? "").replace(/^.*\//, "");
    if (!head) continue;
    if (head === "git") {
      const sub = words.find((w, i) => i > 0 && !w.startsWith("-")) ?? "";
      raise(GIT_READ.has(sub) ? "read" : GIT_NETWORK.has(sub) ? "network" : "write");
    } else if (READ.has(head)) {
      if (head === "find" && /\s-(delete|exec)\b/.test(part)) raise("write");
    } else if (WRITE.has(head)) raise("write");
    else if (NETWORK_TOOLS.has(head)) {
      if ((head === "npm" || head === "pnpm" || head === "yarn") && /\s(test|run|exec|ls|list|why|outdated)\b/.test(part) && !/\s(install|add|i|ci|update|upgrade|publish)\b/.test(part)) raise("write");
      else raise("network");
    } else return { risk: "blocked", reason: `"${head}" is not on the allowed command list` };
  }
  return { risk, reason: risk === "read" ? "reads only" : risk === "write" ? "changes files in the workspace" : "uses the network" };
}

/** The macOS sandbox profile: read the system, write only the workspace, no network unless allowed. */
export function sandboxProfile(workspace: string, allowNetwork: boolean): string {
  const ws = workspace.replace(/"/g, "");
  const home = homedir().replace(/"/g, "");
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec process-fork signal)",
    "(allow sysctl-read mach-lookup ipc-posix-shm)",
    "(allow file-read*)",
    // The home folder is not readable except the workspace: no keys, mail, keychains or browser data.
    `(deny file-read* (subpath "${home}"))`,
    `(allow file-read* (subpath "${ws}"))`,
    `(allow file-read* (subpath "${home}/.deck-tools") (subpath "${home}/.nvm") (subpath "${home}/.cargo") (subpath "${home}/.rustup") (literal "${home}"))`,
    `(allow file-write* (subpath "${ws}") (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty"))`,
    allowNetwork ? "(allow network-outbound) (allow network-inbound (local ip))" : "(deny network*)",
  ].join("\n");
}

/** bubblewrap arguments for Linux: read-only system, writable workspace, private /tmp, empty home, no network unless allowed. */
export function bwrapArgs(workspace: string, allowNetwork: boolean): string[] {
  return ["--ro-bind", "/usr", "/usr", "--ro-bind-try", "/bin", "/bin", "--ro-bind-try", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64", "--ro-bind-try", "/etc/alternatives", "/etc/alternatives", "--ro-bind-try", "/etc/ssl", "/etc/ssl", "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf", "--ro-bind-try", "/opt", "/opt", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/home", "--bind", workspace, workspace, "--setenv", "HOME", workspace, "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--new-session", ...(allowNetwork ? [] : ["--unshare-net"])];
}

export function sandboxAvailable(): "macos" | "linux" | null {
  if (platform() === "darwin" && existsSync("/usr/bin/sandbox-exec")) return "macos";
  if (platform() === "linux" && ["/usr/bin/bwrap", "/bin/bwrap"].some(existsSync)) return "linux";
  return null;
}

/** Environment for sandboxed commands: a minimal PATH and locale, nothing that looks like a key or token. */
export function cleanEnv(workspace: string, src: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const keep = ["PATH", "LANG", "LC_ALL", "TERM", "TZ"];
  const env: Record<string, string> = { HOME: workspace, TMPDIR: "/tmp" };
  for (const k of keep) if (src[k]) env[k] = String(src[k]);
  return env;
}

export interface ShellResult {
  code: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  ms: number;
}

/** Runs one command in the sandbox. Callers decide approval from classifyCommand first. */
export function runSandboxed(o: { command: string; workspace: string; cwd?: string; allowNetwork?: boolean; timeoutMs?: number; maxOutput?: number; spawnImpl?: typeof spawn }): Promise<ShellResult> {
  const kind = sandboxAvailable();
  if (!kind) return Promise.reject(new Error("No sandbox is available on this computer (needs macOS sandbox-exec or Linux bubblewrap), so commands do not run."));
  mkdirSync(o.workspace, { recursive: true });
  const ws = realpathSync(o.workspace);
  const cwd = resolve(ws, o.cwd ?? ".");
  if (cwd !== ws && !cwd.startsWith(ws + "/")) return Promise.reject(new Error("The working folder must be inside the workspace."));
  const net = !!o.allowNetwork;
  const [bin, args] = kind === "macos" ? ["/usr/bin/sandbox-exec", ["-p", sandboxProfile(ws, net), "/bin/sh", "-c", o.command]] : ["bwrap", [...bwrapArgs(ws, net), "--chdir", cwd, "/bin/sh", "-c", o.command]];
  const max = o.maxOutput ?? 100_000;
  const t0 = Date.now();
  return new Promise((done) => {
    const p = (o.spawnImpl ?? spawn)(bin as string, args as string[], { cwd, env: cleanEnv(ws), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let truncated = false;
    let timedOut = false;
    const take = (d: Buffer) => {
      if (out.length >= max) return void (truncated = true);
      out += d.toString("utf8");
      if (out.length > max) (out = out.slice(0, max)), (truncated = true);
    };
    p.stdout?.on("data", take);
    p.stderr?.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, o.timeoutMs ?? 60_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      done({ code, output: out, truncated, timedOut, ms: Date.now() - t0 });
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      done({ code: null, output: `Could not start the sandbox: ${e.message}`, truncated: false, timedOut: false, ms: Date.now() - t0 });
    });
  });
}
