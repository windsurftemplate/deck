import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolPolicy } from "./tools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const loadCoreRules = (): string => readFileSync(join(root, "core-rules.md"), "utf8");
export const loadRole = (agent: string): string => readFileSync(join(root, agent, "prompt.md"), "utf8");
export const loadPolicy = (agent: string): ToolPolicy => JSON.parse(readFileSync(join(root, agent, "tools.json"), "utf8")) as ToolPolicy;
