import type { BriefSources, CalendarEvent, EmailSummary, Issue, PullRequest } from "@deck/connectors";
import type { ChatRequest, ChatResponse } from "@deck/models";
import { buildPrompt, untrusted } from "./prompt-builder.js";
import { loadCoreRules, loadRole } from "./load.js";

export interface BriefInput {
  sources: BriefSources;
  /** Usually router.chat bound to role "heavy" and agent "chief-of-staff". */
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  userModel: string;
  memories?: string;
  needsYou?: string[];
  timeZone?: string;
}

export interface Brief {
  text: string;
  /** Sources that could not be read, shown to the owner instead of silently skipped. */
  unavailable: string[];
  /** True when the model failed and a plain list was produced instead. */
  fallback: boolean;
}

type Gathered = { events: CalendarEvent[]; emails: EmailSummary[]; issues: Issue[]; prs: PullRequest[] };

async function gather(s: BriefSources): Promise<{ data: Gathered; unavailable: string[] }> {
  const unavailable: string[] = [];
  const safe = async <T>(name: string, fn: (() => Promise<T[]>) | undefined): Promise<T[]> => {
    if (!fn) return [];
    try {
      return await fn();
    } catch {
      unavailable.push(name);
      return [];
    }
  };
  const [events, emails, issues, prs] = await Promise.all([
    safe("Calendar", s.calendar && (() => s.calendar!.today())),
    safe("Email", s.email && (() => s.email!.needsReply())),
    safe("Issues", s.issues && (() => s.issues!.open())),
    safe("Pull requests", s.code && (() => s.code!.awaitingReview())),
  ]);
  return { data: { events, emails, issues, prs }, unavailable };
}

function render(d: Gathered, tz?: string): string {
  const time = (iso: string) => (/T/.test(iso) ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }) : "All day");
  const parts: string[] = [];
  parts.push("Meetings today:\n" + (d.events.length ? d.events.map((e) => `- ${time(e.start)} ${e.title}`).join("\n") : "- none"));
  parts.push("Emails waiting:\n" + (d.emails.length ? untrusted("gmail", d.emails.map((e) => `- From ${e.from}: ${e.subject} | ${e.snippet}`).join("\n")) : "- none"));
  parts.push("Open issues:\n" + (d.issues.length ? untrusted("issues", d.issues.slice(0, 15).map((i) => `- ${i.id} ${i.title} (${i.state})`).join("\n")) : "- none"));
  parts.push("Pull requests waiting on review:\n" + (d.prs.length ? untrusted("github", d.prs.map((p) => `- ${p.repo}#${p.number} ${p.title} (checks ${p.checks})`).join("\n")) : "- none"));
  return parts.join("\n\n");
}

function plainList(d: Gathered, needsYou: string[], tz?: string): string {
  const time = (iso: string) => (/T/.test(iso) ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }) : "All day");
  const lines = [
    ...d.events.map((e) => `- ${time(e.start)} ${e.title}`),
    ...needsYou.map((n) => `- Needs you: ${n}`),
    ...(d.emails.length ? [`- ${d.emails.length} emails waiting`] : []),
    ...(d.prs.length ? [`- ${d.prs.length} PRs waiting on review`] : []),
  ];
  return lines.length ? lines.join("\n") : "- Nothing scheduled and nothing waiting.";
}

/** The morning briefing. Third-party text is wrapped as untrusted; a source failure is reported, not hidden. */
export async function composeBrief(input: BriefInput): Promise<Brief> {
  const { data, unavailable } = await gather(input.sources);
  const needsYou = input.needsYou ?? [];
  const prompt = buildPrompt({
    coreRules: loadCoreRules(),
    role: loadRole("chief-of-staff"),
    userModel: input.userModel,
    skillsIndex: [],
    task: {
      goal: "Write this morning's briefing",
      why: "The owner reads it first thing to plan the day",
      doneWhen: ["every meeting listed with its time", "items needing the owner listed", "top 3 priorities for today", "one line per item"],
      returnFormat: "A short list. No intro.",
      ...(unavailable.length ? { constraints: [`These sources could not be read; say so in one line: ${unavailable.join(", ")}`] } : {}),
    },
    memories: input.memories ?? "",
    working: [render(data, input.timeZone), needsYou.length ? "Waiting on the owner:\n" + needsYou.map((n) => `- ${n}`).join("\n") : ""].filter(Boolean).join("\n\n"),
  });
  try {
    const res = await input.chat({ system: prompt.system, messages: [{ role: "user", content: prompt.user }], maxTokens: 700, temperature: 0.2 });
    if (!res.text.trim()) throw new Error("empty briefing");
    return { text: res.text.trim(), unavailable, fallback: false };
  } catch {
    const note = unavailable.length ? `\n- Could not read: ${unavailable.join(", ")}` : "";
    return { text: plainList(data, needsYou, input.timeZone) + note, unavailable, fallback: true };
  }
}
