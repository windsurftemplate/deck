/**
 * Skills in the open Agent Skills format (agentskills.io): a folder with a SKILL.md file, YAML front matter with
 * a name and a description, then Markdown instructions. deck reads and writes the core of the format; extra
 * files and scripts in a skill folder are not imported or run.
 */
export interface SkillMd {
  name: string;
  description: string;
  body: string;
}

/** Skill names in the standard: lowercase letters, numbers and hyphens, 64 characters at most. */
export const skillSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill";

const unquote = (v: string) => {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return String(JSON.parse(t)).trim();
    } catch {
      /* not JSON-style; fall through */
    }
  }
  return t.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
};

export function parseSkillMd(text: string): SkillMd {
  const m = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("A SKILL.md starts with front matter between --- lines.");
  const fm = m[1]!;
  const field = (k: string) => {
    const line = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"));
    if (!line) return "";
    const v = line[1]!.trim();
    // Folded or literal block (description: > or |): take the indented lines that follow.
    if (v === ">" || v === "|" || v === ">-" || v === "|-") {
      const after = fm.slice(fm.indexOf(line[0]) + line[0].length).split(/\r?\n/);
      const block: string[] = [];
      for (const l of after.slice(1)) {
        if (/^\s+\S/.test(l)) block.push(l.trim());
        else if (l.trim()) break;
      }
      return block.join(v.startsWith(">") ? " " : "\n");
    }
    return unquote(v);
  };
  const name = field("name");
  const description = field("description");
  if (!name) throw new Error("The SKILL.md has no name.");
  if (!description) throw new Error(`${name}: the SKILL.md has no description.`);
  if (description.length > 1024) throw new Error(`${name}: the description is over 1,024 characters.`);
  const body = m[2]!.trim();
  if (!body) throw new Error(`${name}: the SKILL.md has no instructions.`);
  if (body.length > 12_000) throw new Error(`${name}: the instructions are too long for deck (over 12,000 characters).`);
  return { name: skillSlug(name), description, body };
}

export function toSkillMd(s: SkillMd & { successes?: number; failures?: number }): string {
  const esc = (v: string) => (/[:#\n"']/.test(v) ? JSON.stringify(v) : v);
  return `---\nname: ${skillSlug(s.name)}\ndescription: ${esc(s.description.replace(/\s+/g, " ").trim())}\nmetadata:\n  source: deck\n  successes: ${s.successes ?? 0}\n  failures: ${s.failures ?? 0}\n---\n\n${s.body.trim()}\n`;
}
