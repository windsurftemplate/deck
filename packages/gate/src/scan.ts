/**
 * Input scanner. Looks at text from outside (web pages, documents, emails) for signs that it is trying to
 * steer the crew, strips invisible characters that can hide instructions, and finds personal data.
 * It only advises; the action gate and approvals still decide what may happen.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

const SIGNALS: [string, RegExp, number][] = [
  ["tells the reader to ignore earlier instructions", /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,20}\b(instructions?|rules|prompts?|guidelines)/i, 0.6],
  ["claims to be a system or developer message", /(^|\n)\s*(system|developer|assistant)\s*(prompt|message)?\s*:|<\/?(system|instructions?|untrusted)\b[^>]*>|\[\/?(INST|SYS)\]/i, 0.5],
  ["tries to change who the AI is", /\b(you are now|act as|pretend to be|from now on you|new persona|developer mode|jailbreak|DAN)\b/i, 0.4],
  ["asks for secrets or keys", /\b(reveal|print|show|send|share|leak|output)\b[^.\n]{0,40}\b(api[ _-]?keys?|passwords?|secrets?|tokens?|system prompt|credentials?|admin code)\b/i, 0.5],
  ["asks to send or forward something", /\b(send|forward|email|post|upload|exfiltrate)\b[^.\n]{0,40}\b(to|at)\b[^.\n]{0,40}(@|https?:\/\/)/i, 0.35],
  ["asks to hide something from the owner", /\b(do not|don't|never)\b[^.\n]{0,30}\b(tell|inform|mention|show)\b[^.\n]{0,20}\b(user|owner|anyone|human)\b/i, 0.5],
  ["image link that carries data out", /!\[[^\]]*\]\(https?:\/\/[^)]*[?&][^)]*=/i, 0.35],
  ["long encoded block", /[A-Za-z0-9+/]{120,}={0,2}/, 0.15],
];

export interface ScanResult {
  /** 0 to 1; 0.5 or more is treated as a likely injection attempt. */
  score: number;
  signals: string[];
  /** The text with invisible characters removed. */
  clean: string;
  invisible: number;
}

export function scanInjection(text: string): ScanResult {
  const invisible = (text.match(INVISIBLE) ?? []).length;
  const clean = text.replace(INVISIBLE, "");
  const signals: string[] = [];
  let score = invisible > 3 ? 0.3 : 0;
  if (invisible > 3) signals.push(`hides ${invisible} invisible characters`);
  for (const [label, re, w] of SIGNALS)
    if (re.test(clean)) {
      signals.push(label);
      score += w;
    }
  return { score: Math.min(1, Math.round(score * 100) / 100), signals, clean, invisible };
}

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) (d *= 2), d > 9 && (d -= 9);
    sum += d;
  }
  return sum % 10 === 0;
};

const PII: [string, RegExp, (m: string) => boolean][] = [
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => true],
  ["card", /\b(?:\d[ -]?){13,19}\b/g, (m) => luhn(m.replace(/\D/g, ""))],
  ["ssn", /\b\d{3}-\d{2}-\d{4}\b/g, () => true],
  ["iban", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, () => true],
  ["phone", /(?<!\w)\+?\d{1,3}?[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\w)/g, () => true],
  ["ip", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => m.split(".").every((x) => Number(x) <= 255)],
];

export function findPII(text: string): { type: string; match: string }[] {
  const out: { type: string; match: string }[] = [];
  for (const [type, re, ok] of PII) for (const m of text.match(re) ?? []) if (ok(m) && !out.some((o) => o.match.includes(m.trim()))) out.push({ type, match: m.trim() });
  return out;
}

/** Replaces personal data with a label like [email], for text about to leave the machine. */
export function redactPII(text: string): { text: string; removed: string[] } {
  let t = text;
  const removed: string[] = [];
  for (const p of findPII(text)) {
    t = t.split(p.match).join(`[${p.type}]`);
    removed.push(p.type);
  }
  return { text: t, removed };
}
