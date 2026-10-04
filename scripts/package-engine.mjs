#!/usr/bin/env node
/**
 * Packages the agent engine to ship inside the desktop app:
 *   1. builds the engine and the packages it uses
 *   2. copies it with production dependencies only into src-tauri/resources/engine (flat node_modules, no symlinks)
 *   3. copies this machine's Node runtime to src-tauri/binaries/deck-node-<target triple> (a Tauri sidecar)
 * Run it on each platform you ship (macOS, Windows, Linux); native modules are platform specific.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(root, "apps/desktop/src-tauri");
const out = join(tauri, "resources/engine");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32", ...opts });

console.log("1/3 building the engine");
run("pnpm", ["turbo", "run", "build", "--filter=@deck/engine..."]);

console.log("2/3 copying the engine with production dependencies");
rmSync(out, { recursive: true, force: true });
run("pnpm", ["--filter", "@deck/engine", "deploy", "--prod", "--config.node-linker=hoisted", out]);
// Keep only what runs: drop sources, tests and type maps.
for (const junk of ["src", "tsconfig.json"]) rmSync(join(out, junk), { recursive: true, force: true });
prune(join(out, "node_modules"));

/** Removes files the engine never loads at runtime, and native binaries for other platforms. */
function prune(nm) {
  const os = { darwin: "darwin", win32: "win32", linux: "linux" }[process.platform];
  // onnxruntime ships every platform; keep this one.
  const ortBin = join(nm, "onnxruntime-node/bin/napi-v3");
  if (existsSync(ortBin)) {
    for (const plat of readdirSync(ortBin)) {
      if (plat !== os) rmSync(join(ortBin, plat), { recursive: true, force: true });
      else for (const arch of readdirSync(join(ortBin, plat))) if (arch !== process.arch) rmSync(join(ortBin, plat, arch), { recursive: true, force: true });
    }
  }
  // GPU providers (CUDA, TensorRT) are huge and unused: embeddings run on the CPU.
  const here = join(ortBin, os ?? "", process.arch);
  if (existsSync(here)) for (const f of readdirSync(here)) if (/providers_(cuda|tensorrt)|\.so\.\d+\.\d+\.\d+$/.test(f)) rmSync(join(here, f), { force: true });
  // Browser-only runtimes.
  for (const d of ["onnxruntime-web"]) rmSync(join(nm, d), { recursive: true, force: true });
  // Build sources for native modules are not needed once compiled.
  for (const d of ["better-sqlite3-multiple-ciphers/deps", "better-sqlite3-multiple-ciphers/src"]) rmSync(join(nm, d), { recursive: true, force: true });
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (p === join(nm, "@deck")) continue; // our own packages: prompts are Markdown and must ship
        if (["test", "tests", "__tests__", "docs", "example", "examples", ".github"].includes(e.name)) rmSync(p, { recursive: true, force: true });
        else walk(p);
      } else if (/\.(map|md|markdown|d\.ts|d\.mts|d\.cts|ts\.map)$/i.test(e.name) && !/^license/i.test(e.name)) rmSync(p, { force: true });
    }
  };
  walk(nm);
}

console.log("3/3 copying the Node runtime as a sidecar");
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)[1].trim();
const ext = process.platform === "win32" ? ".exe" : "";
mkdirSync(join(tauri, "binaries"), { recursive: true });
const sidecar = join(tauri, "binaries", `deck-node-${triple}${ext}`);
copyFileSync(process.execPath, sidecar);
chmodSync(sidecar, 0o755);

const size = (p) => {
  const st = statSync(p);
  return st.isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : st.size;
};
console.log(`done: engine ${(size(out) / 1e6).toFixed(0)} MB, node ${(size(sidecar) / 1e6).toFixed(0)} MB (${triple})`);
if (!existsSync(join(out, "dist/main.js"))) throw new Error("engine entry missing after deploy");
// Every crew role must ship with its prompt and tools, or the agents check fails at start-up.
const agentsDir = join(out, "node_modules/@deck/agents");
for (const role of ["chief-of-staff", "gtm", "ops", "code", "research", "ciso"])
  for (const f of ["prompt.md", "tools.json"]) if (!existsSync(join(agentsDir, role, f))) throw new Error(`missing ${role}/${f} in the engine bundle; add "${role}" to packages/agents/package.json files`);
if (!existsSync(join(agentsDir, "core-rules.md"))) throw new Error("missing core-rules.md in the engine bundle");
