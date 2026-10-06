// Points Git at the repo's hooks (the pre-commit secret scan) when this is a Git checkout and Git is installed.
// Installing from a downloaded zip, or without Git, is fine: this step is skipped quietly on every platform.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  const r = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore", shell: false });
  if (r.error || r.status !== 0) console.log("Git hooks not set up (Git not found). That is fine for installing.");
}
