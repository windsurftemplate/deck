// Builds skills-hub/index.json without signatures (for CI and first setup). Signing happens in the app with your key.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifySkill } from "../packages/agents/dist/index.js";

const dir = resolve(process.argv[2] ?? "skills-hub");
const skills = [];
let blocked = 0;
for (const d of readdirSync(dir).sort()) {
  const p = join(dir, d, "SKILL.md");
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  const v = verifySkill({ skillMd: text });
  if (v.verdict === "blocked" || !v.skill) {
    blocked++;
    console.error(`blocked ${d}: ${v.checks.filter((c) => c.status === "fail").map((c) => c.detail).join("; ")}`);
    continue;
  }
  const sigPath = join(dir, d, "SKILL.sig.json");
  skills.push({ name: v.skill.name, description: v.skill.description, path: `${d}/SKILL.md`, sha256: createHash("sha256").update(text, "utf8").digest("hex"), ...(existsSync(sigPath) ? { signature: `${d}/SKILL.sig.json` } : {}) });
}
writeFileSync(join(dir, "index.json"), JSON.stringify({ name: "deck", updated: new Date().toISOString(), skills }, null, 2) + "\n");
console.log(`index.json: ${skills.length} skills${blocked ? `, ${blocked} blocked` : ""}`);
if (blocked) process.exit(1);
