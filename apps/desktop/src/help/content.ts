/// <reference types="vite/client" />
/** The manual and course, bundled from the repo's docs folder at build time. */
const files = import.meta.glob("../../../../docs/{manual,course}/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Doc {
  id: string;
  section: "manual" | "course";
  order: number;
  title: string;
  body: string;
  /** Plain text for search. */
  text: string;
}

export interface Quiz {
  question: string;
  options: { text: string; correct: boolean }[];
  explain: string;
}

/**
 * Quizzes are written in the Markdown as fenced blocks:
 * ```quiz
 * Q: question
 * - [ ] wrong answer
 * - [x] right answer
 * > why the right answer is right
 * ```
 */
export function parseQuiz(src: string): Quiz | null {
  const q = src.match(/^Q:\s*(.+)$/m)?.[1]?.trim();
  const options = [...src.matchAll(/^- \[( |x)\]\s*(.+)$/gm)].map((m) => ({ text: m[2]!.trim(), correct: m[1] === "x" }));
  const explain = [...src.matchAll(/^>\s?(.*)$/gm)].map((m) => m[1]).join(" ").trim();
  return q && options.length >= 2 && options.some((o) => o.correct) ? { question: q, options, explain } : null;
}

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const DOCS: Doc[] = Object.entries(files)
  .map(([path, body]) => {
    const file = path.split("/").pop()!.replace(/\.md$/, "");
    const section = path.includes("/course/") ? "course" : "manual";
    return { id: `${section}/${file}`, section, order: Number(file.split("-")[0]) || 0, title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file, body, text: plain(body) } as Doc;
  })
  .sort((a, b) => (a.section === b.section ? a.order - b.order : a.section === "manual" ? -1 : 1));

/** Search across every chapter; returns matches with a short snippet around the first hit. */
export function search(q: string): { doc: Doc; snippet: string; hits: number }[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const words = t.split(/\s+/);
  return DOCS.map((doc) => {
    const low = doc.text.toLowerCase();
    if (!words.every((w) => low.includes(w))) return null;
    const at = low.indexOf(words[0]!);
    const hits = words.reduce((n, w) => n + low.split(w).length - 1, 0) + (doc.title.toLowerCase().includes(t) ? 20 : 0);
    return { doc, hits, snippet: `${at > 60 ? "…" : ""}${doc.text.slice(Math.max(0, at - 60), at + 140)}…` };
  })
    .filter((x): x is { doc: Doc; snippet: string; hits: number } => !!x)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 30);
}
