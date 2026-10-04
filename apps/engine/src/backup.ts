import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encrypted backups. A backup holds the workspace file (already encrypted with the memory key), the memory key,
 * and your settings, all sealed again with a passphrase you choose (scrypt + AES-256-GCM). Restoring needs only
 * the file and the passphrase, so it works on a new computer. Without the passphrase it cannot be opened.
 */
const MAGIC = Buffer.from("DECKBAK1");
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface BackupContents {
  createdAt: string;
  workspace: Buffer;
  memoryKey: string;
  settings: string;
}

export function checkPassphrase(p: string): string | null {
  if (p.length < 12) return "Use a passphrase of at least 12 characters.";
  if (/^(.)\1+$/.test(p)) return "That passphrase is too simple.";
  return null;
}

export function sealBackup(c: BackupContents, passphrase: string): Buffer {
  const err = checkPassphrase(passphrase);
  if (err) throw new Error(err);
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, KDF);
  const head = Buffer.from(JSON.stringify({ createdAt: c.createdAt, memoryKey: c.memoryKey, settings: c.settings, workspaceBytes: c.workspace.length }));
  const plain = Buffer.concat([Buffer.alloc(4), head, c.workspace]);
  plain.writeUInt32BE(head.length, 0);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function openBackup(file: Buffer, passphrase: string): BackupContents {
  if (file.length < 60 || !file.subarray(0, 8).equals(MAGIC)) throw new Error("That is not a deck backup file.");
  const salt = file.subarray(8, 24), iv = file.subarray(24, 36), tag = file.subarray(36, 52);
  const key = scryptSync(passphrase, salt, 32, KDF);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([d.update(file.subarray(52)), d.final()]);
  } catch {
    throw new Error("Wrong passphrase, or the file was changed.");
  }
  const n = plain.readUInt32BE(0);
  const head = JSON.parse(plain.subarray(4, 4 + n).toString()) as { createdAt: string; memoryKey: string; settings: string; workspaceBytes: number };
  const workspace = plain.subarray(4 + n);
  if (workspace.length !== head.workspaceBytes) throw new Error("The backup is incomplete.");
  return { createdAt: head.createdAt, memoryKey: head.memoryKey, settings: head.settings, workspace };
}
