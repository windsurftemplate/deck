import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { redactSecrets, scanInjection } from "@deck/gate";
import { parseSkillMd, type SkillMd } from "./skill-md.js";

/**
 * Skill verification. Every skill from outside (a hub, an OpenClaw workspace, a file) is checked before it can be
 * installed. The checks target what real skill-marketplace attacks did: fake "prerequisites" to download and run,
 * piped installers, obfuscated payloads, credential and wallet theft, exfiltration endpoints, planted keys, and
 * instructions aimed at the agent. deck only ever imports the instructions; scripts in a skill folder never run.
 */
export type CheckStatus = "pass" | "warn" | "fail";
export interface SkillCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface SkillSignature {
  publisher: string;
  publicKey: string; // base64 of the raw 32-byte Ed25519 public key
  sha256: string;
  signature: string; // base64
}
export interface SkillVerification {
  verdict: "verified" | "scanned" | "blocked";
  checks: SkillCheck[];
  sha256: string;
  skill: SkillMd | null;
  publisher: string | null;
}

const DANGER: [RegExp, string][] = [
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z|k)?sh\b/i, "pipes a download straight into a shell"],
  [/\b(curl|wget)\b[^\n]{0,200}(-o|--output|>)\s*\S+[^\n]{0,120}(chmod\s+\+x|&&\s*\.\/|;\s*\.\/)/i, "downloads a file and runs it"],
  [/\bbase64\s+(-d|--decode|-D)\b|\bfrombase64string\b|\batob\(/i, "decodes a hidden payload"],
  [/\bpowershell\b[^\n]{0,80}\s-(e|enc|encodedcommand)\s/i, "runs encoded PowerShell"],
  [/\b(Invoke-Expression|IEX)\b|\beval\s*\(\s*(atob|Buffer\.from|base64)/i, "evaluates code built at run time"],
  [/\bxattr\b[^\n]{0,60}com\.apple\.quarantine|\bspctl\b[^\n]{0,40}--master-disable/i, "switches off macOS download protection"],
  [/\bdownload\b[^\n]{0,60}\b(prerequisite|helper|installer|driver|binary|agent|runtime|update)\b[^\n]{0,80}\b(run|install|open|execute)\b/i, "asks for a 'prerequisite' to be downloaded and run"],
  [/\.(dmg|pkg|exe|msi|scr|bat|cmd|command|app\.zip)\b[^\n]{0,80}\b(download|run|open|install)\b|\b(download|run|open|install)\b[^\n]{0,80}\.(dmg|pkg|exe|msi|scr|bat|command)\b/i, "tells you to fetch and open an installer"],
  [/\bsecurity\s+(find|dump)-(generic|internet)-password\b|\bdump-keychain\b|login\.keychain/i, "reads the macOS keychain"],
  [/~\/\.ssh\b|\bid_(rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.config\/gcloud|\.docker\/config\.json|\.npmrc|\.netrc/i, "reads SSH or cloud credentials"],
  [/\bwallet\.dat\b|\bseed phrase\b|\bmnemonic\b[^\n]{0,40}\b(word|phrase)|\b(metamask|phantom|exodus|electrum|ledger live)\b[^\n]{0,80}\b(folder|vault|extension data|local storage|keystore)/i, "goes after crypto wallets or seed phrases"],
  [/\b(pastebin\.com|webhook\.site|requestbin|ngrok\.io|ngrok-free\.app|pipedream\.net|discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot)\b/i, "sends data to a paste site or webhook"],
  [/https?:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?\//i, "talks to a raw IP address"],
  [/\b(disable|turn off|bypass|skip|ignore)\b[^\n]{0,30}\b(approval|approvals|confirmation|safety|sandbox|antivirus|gatekeeper|defender|guardrails?)\b/i, "tells the agent to switch off a safety check"],
  [/(\bcrontab\b|\blaunchctl\s+load\b|LaunchAgents|\bsystemctl\s+enable\b|\bschtasks\b|Startup folder|\.bashrc|\.zshrc|\.bash_profile|\.profile\b)[^\n]{0,80}\b(starts?|runs?|on login|at login|at boot|every)\b|\b(add|install|write|append|load|enable)\b[^\n]{0,80}(\bcrontab\b|LaunchAgents|\.bashrc|\.zshrc|\.bash_profile)/i, "installs itself to run at startup"],
];
const BLOB = /[A-Za-z0-9+/]{200,}={0,2}|\b[0-9a-f]{200,}\b/;
const CODE_FILE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|command|exe|dll|so|dylib|bin|jar|wasm|scpt|applescript|app)$/i;

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const ED_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // SPKI header for raw Ed25519 keys

/** A new Ed25519 signing key pair: the public key as raw base64, the private key as PKCS#8 base64. */
export function newSigningKey(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey: (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("base64"), privateKey: (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64") };
}
export function signSkill(skillMd: string, publisher: string, key: { publicKey: string; privateKey: string }): SkillSignature {
  const digest = sha(skillMd);
  const pk = createPrivateKey({ key: Buffer.from(key.privateKey, "base64"), format: "der", type: "pkcs8" });
  return { publisher, publicKey: key.publicKey, sha256: digest, signature: sign(null, Buffer.from(digest, "utf8"), pk).toString("base64") };
}
export function checkSignature(skillMd: string, s: SkillSignature): boolean {
  try {
    if (sha(skillMd) !== s.sha256) return false;
    const pub = createPublicKey({ key: Buffer.concat([ED_PREFIX, Buffer.from(s.publicKey, "base64")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(s.sha256, "utf8"), pub, Buffer.from(s.signature, "base64"));
  } catch {
    return false;
  }
}
/** A short, readable fingerprint of a publisher key. */
export const keyFingerprint = (publicKey: string) => sha(publicKey).slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");

export function verifySkill(input: { skillMd: string; files?: { path: string; size?: number }[]; signature?: SkillSignature | null; trusted?: { name: string; publicKey: string }[] }): SkillVerification {
  const checks: SkillCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });
  const digest = sha(input.skillMd);
  let skill: SkillMd | null = null;
  try {
    skill = parseSkillMd(input.skillMd);
    if (!skill.name || !skill.description) throw new Error("needs a name and a description");
    if (input.skillMd.length > 40_000) throw new Error("is longer than 40,000 characters");
    add("format", "Valid SKILL.md", "pass", `${skill.name}: ${skill.description.slice(0, 120)}`);
  } catch (e) {
    add("format", "Valid SKILL.md", "fail", `Not a valid SKILL.md: ${(e as Error).message}`);
  }
  const text = input.skillMd;
  const inj = scanInjection(text);
  add("injection", "No instructions aimed at the agent", inj.score >= 0.5 ? "fail" : inj.score > 0 ? "warn" : "pass", inj.score >= 0.5 ? `Tries to instruct the agent: ${inj.signals.join("; ")}` : inj.score > 0 ? `Mild signals: ${inj.signals.join("; ")}` : "No injection patterns.");
  const found = redactSecrets(text).findings.reduce((a, f) => a + f.count, 0);
  add("secrets", "No keys or tokens inside", found > 0 ? "fail" : "pass", found > 0 ? `Contains ${found} key or token${found > 1 ? "s" : ""}.` : "No keys or tokens.");
  const danger = DANGER.map(([re, why]) => {
    const m = text.match(re);
    return m ? `${why} ("${m[0].slice(0, 80).replace(/\s+/g, " ")}")` : null;
  }).filter((x): x is string => !!x);
  add("dangerous", "No download-and-run, theft or persistence steps", danger.length ? "fail" : "pass", danger.length ? danger.join("; ") : "None found.");
  const blob = text.match(BLOB);
  add("obfuscation", "No hidden encoded payloads", blob ? "fail" : "pass", blob ? `Contains a ${blob[0].length}-character encoded block.` : "None found.");
  const code = (input.files ?? []).filter((f) => CODE_FILE.test(f.path));
  add("code", "Instructions only", code.length ? "warn" : "pass", code.length ? `${code.length} script or binary file${code.length > 1 ? "s" : ""} in the folder (${code.slice(0, 4).map((f) => f.path).join(", ")}${code.length > 4 ? "…" : ""}). deck imports only SKILL.md; these are never copied or run.` : "Only instructions.");
  const urls = [...new Set((text.match(/https?:\/\/[^\s)\]"'>]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
  const insecure = urls.filter((u) => u.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u));
  add("links", "Links are HTTPS", insecure.length ? "warn" : "pass", urls.length ? `${urls.length} link${urls.length > 1 ? "s" : ""}${insecure.length ? `, ${insecure.length} not HTTPS` : ""}: ${urls.slice(0, 3).join(", ")}${urls.length > 3 ? "…" : ""}` : "No links.");
  let publisher: string | null = null;
  let trustedSig = false;
  if (input.signature) {
    const ok = checkSignature(text, input.signature);
    const t = (input.trusted ?? []).find((x) => x.publicKey === input.signature!.publicKey);
    publisher = input.signature.publisher;
    trustedSig = ok && !!t;
    add("signature", "Signed by a trusted publisher", !ok ? "fail" : t ? "pass" : "warn", !ok ? "The signature does not match: the skill was changed after signing." : t ? `Signed by ${t.name} (${keyFingerprint(t.publicKey)}).` : `Signed by "${input.signature.publisher}" (${keyFingerprint(input.signature.publicKey)}), who is not in your trusted publishers.`);
  } else add("signature", "Signed by a trusted publisher", "warn", "Unsigned.");
  const failed = checks.some((c) => c.status === "fail");
  return { verdict: failed ? "blocked" : trustedSig ? "verified" : "scanned", checks, sha256: digest, skill, publisher };
}
