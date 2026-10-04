import { randomBytes } from "node:crypto";
import type { DB } from "@deck/memory";

export interface WorkflowStep {
  agent: string;
  instruction: string;
}
export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  createdAt: string;
  lastRun?: string;
  lastResult?: string;
}

/** Starting points you can add with one click. {input} is filled in when you run it. */
export const WORKFLOW_TEMPLATES: { name: string; steps: WorkflowStep[] }[] = [
  {
    name: "Account research to outreach",
    steps: [
      { agent: "research", instruction: "Research {input}: what they do, recent news, likely priorities and who leads security, with sources." },
      { agent: "gtm", instruction: "Using the research, draft a first outreach email to {input} that leads with their most likely problem and makes one small ask." },
    ],
  },
  {
    name: "Weekly review",
    steps: [
      { agent: "ops", instruction: "Review the tracker: list overdue and stale issues, and tidy labels and priorities." },
      { agent: "code", instruction: "Summarize engineering status: what moved this week, what is blocked, and decisions needed." },
      { agent: "chief-of-staff", instruction: "Combine the reports into a one-screen weekly review: wins, risks, and the three priorities for next week." },
    ],
  },
  {
    name: "Breach to content",
    steps: [
      { agent: "research", instruction: "Find the most notable recent breach involving leaked API keys or tokens, with sources: what happened and how. Focus: {input}." },
      { agent: "gtm", instruction: "Draft a short LinkedIn post explaining the lesson from that breach in plain words. No claims beyond the sources." },
    ],
  },
];

export function checkWorkflow(w: { name?: string; steps?: WorkflowStep[] }, agents: string[]): string | null {
  if (!w.name?.trim() || w.name.length > 80) return "Give the workflow a name (80 characters at most).";
  if (!Array.isArray(w.steps) || w.steps.length < 2 || w.steps.length > 6) return "A workflow has 2 to 6 steps.";
  for (const [i, s] of w.steps.entries()) {
    if (!agents.includes(s.agent)) return `Step ${i + 1}: pick who does it.`;
    if (!s.instruction?.trim() || s.instruction.length > 1500) return `Step ${i + 1}: say what to do (1,500 characters at most).`;
  }
  if (w.steps[0]!.agent === "chief-of-staff") return "Start with a crew member; the Chief of Staff can combine results at the end.";
  return null;
}

/** Multi-step jobs: each step's result is handed to the next. */
export class Workflows {
  constructor(private db: DB, private clock: () => Date = () => new Date()) {
    db.exec("CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, steps TEXT NOT NULL, created_at TEXT NOT NULL, last_run TEXT, last_result TEXT)");
  }
  private row = (r: Record<string, string | null>): Workflow => ({ id: r.id!, name: r.name!, steps: JSON.parse(r.steps!), createdAt: r.created_at!, ...(r.last_run ? { lastRun: r.last_run } : {}), ...(r.last_result ? { lastResult: r.last_result } : {}) });
  list() {
    return (this.db.prepare("SELECT * FROM workflows ORDER BY created_at").all() as Record<string, string | null>[]).map(this.row);
  }
  get(id: string) {
    const r = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as Record<string, string | null> | undefined;
    return r && this.row(r);
  }
  save(w: { id?: string; name: string; steps: WorkflowStep[] }): Workflow {
    const id = w.id ?? randomBytes(4).toString("hex");
    if (w.id && this.get(w.id)) this.db.prepare("UPDATE workflows SET name = ?, steps = ? WHERE id = ?").run(w.name.trim(), JSON.stringify(w.steps), id);
    else this.db.prepare("INSERT INTO workflows (id, name, steps, created_at) VALUES (?, ?, ?, ?)").run(id, w.name.trim(), JSON.stringify(w.steps), this.clock().toISOString());
    return this.get(id)!;
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  }
  markRun(id: string, result: string) {
    this.db.prepare("UPDATE workflows SET last_run = ?, last_result = ? WHERE id = ?").run(this.clock().toISOString(), result.slice(0, 8000), id);
  }
}
