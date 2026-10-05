/** Patterns for secrets that must never reach a model, a log, or memory. */
const RULES: { name: string; re: RegExp }[] = [
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "VaultProof token", re: /\bvp-proj-[A-Za-z0-9_-]{16,}/g },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", re: /\bxox[abprse]-[A-Za-z0-9-]{10,}/g },
  { name: "Slack app token", re: /\bxapp-\d-[A-Za-z0-9-]{20,}/g },
  { name: "Discord bot token", re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g },
  { name: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { name: "Telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "password assignment", re: /\b(?:password|passwd|pwd|secret)\s*[:=]\s*["']?[^\s"']{8,}/gi },
];

export interface ScanResult {
  clean: string;
  findings: { name: string; count: number }[];
}

/** Replaces every secret with a labeled placeholder. Runs on every outbound prompt and before anything is stored. */
export function redactSecrets(text: string): ScanResult {
  const counts = new Map<string, number>();
  let clean = text;
  for (const { name, re } of RULES) {
    clean = clean.replace(re, () => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return `[redacted ${name}]`;
    });
  }
  return { clean, findings: [...counts].map(([name, count]) => ({ name, count })) };
}
