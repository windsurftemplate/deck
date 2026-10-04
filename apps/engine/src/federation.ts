import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { DB } from "@deck/memory";

/**
 * Federation (Labs): talk to crews on other computers you trust.
 * - Identity: an ed25519 key to sign and an x25519 key to encrypt, made once and kept in the keychain.
 * - Peers are added only by exchanging invite codes; there is no discovery and no open door.
 * - Every message is encrypted (AES-256-GCM, key from X25519 + HKDF) and signed; stale, replayed, unsigned or
 *   unknown-sender messages are dropped.
 */
export interface Identity {
  signPriv: KeyObject;
  signPub: Buffer;
  boxPriv: KeyObject;
  boxPub: Buffer;
}
export interface Peer {
  id: string;
  name: string;
  addr: string;
  signPub: string;
  boxPub: string;
  addedAt: string;
}
export interface Plain {
  kind: "ask" | "answer" | "note";
  text: string;
  replyTo?: string;
  id: string;
}

const raw = (k: KeyObject) => Buffer.from(k.export({ format: "jwk" }).x as string, "base64url");
const fromRaw = (type: "ed25519" | "x25519", b: Buffer) => createPublicKey({ key: { kty: "OKP", crv: type === "ed25519" ? "Ed25519" : "X25519", x: b.toString("base64url") }, format: "jwk" });
export const fingerprint = (signPub: Buffer) => createHash("sha256").update(signPub).digest("hex").slice(0, 16);

export function newIdentity(): { identity: Identity; secret: string } {
  const s = generateKeyPairSync("ed25519"), b = generateKeyPairSync("x25519");
  const secret = JSON.stringify({ s: s.privateKey.export({ format: "pem", type: "pkcs8" }), b: b.privateKey.export({ format: "pem", type: "pkcs8" }) });
  return { identity: loadIdentity(secret), secret };
}
export function loadIdentity(secret: string): Identity {
  const j = JSON.parse(secret) as { s: string; b: string };
  const signPriv = createPrivateKey(j.s), boxPriv = createPrivateKey(j.b);
  return { signPriv, signPub: raw(createPublicKey(signPriv)), boxPriv, boxPub: raw(createPublicKey(boxPriv)) };
}

export function makeInvite(me: Identity, name: string, addr: string): string {
  return `deck-invite:${Buffer.from(JSON.stringify({ v: 1, name, addr, s: me.signPub.toString("base64url"), b: me.boxPub.toString("base64url") })).toString("base64url")}`;
}
export function readInvite(code: string): Omit<Peer, "addedAt"> {
  const m = code.trim().match(/^deck-invite:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("That is not a deck invite code.");
  const j = JSON.parse(Buffer.from(m[1]!, "base64url").toString()) as { name: string; addr: string; s: string; b: string };
  if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(j.addr ?? "")) throw new Error("The invite has no valid address.");
  const signPub = Buffer.from(j.s, "base64url");
  if (signPub.length !== 32 || Buffer.from(j.b, "base64url").length !== 32) throw new Error("The invite keys are damaged.");
  return { id: fingerprint(signPub), name: String(j.name || "Unnamed crew").slice(0, 40), addr: j.addr, signPub: j.s, boxPub: j.b };
}

const key = (me: Identity, peerBox: string, nonce: Buffer) => Buffer.from(hkdfSync("sha256", diffieHellman({ privateKey: me.boxPriv, publicKey: fromRaw("x25519", Buffer.from(peerBox, "base64url")) }), nonce, "deck-federation-v1", 32));

export function seal(me: Identity, peer: Peer, msg: Plain, now = Date.now()) {
  const nonce = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(me, peer.boxPub, nonce), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(msg)), c.final()]);
  const env = { from: fingerprint(me.signPub), to: peer.id, ts: now, nonce: nonce.toString("base64url"), iv: iv.toString("base64url"), ct: ct.toString("base64url"), tag: c.getAuthTag().toString("base64url") };
  const sig = sign(null, Buffer.from(`${env.from}.${env.to}.${env.ts}.${env.nonce}.${env.iv}.${env.ct}.${env.tag}`), me.signPriv).toString("base64url");
  return { ...env, sig };
}
export type Envelope = ReturnType<typeof seal>;

export function open(me: Identity, peers: Peer[], env: Envelope, seen: Set<string>, now = Date.now()): { peer: Peer; msg: Plain } {
  const peer = peers.find((p) => p.id === env.from);
  if (!peer) throw new Error("unknown sender");
  if (env.to !== fingerprint(me.signPub)) throw new Error("not for us");
  if (Math.abs(now - env.ts) > 5 * 60_000) throw new Error("stale");
  if (seen.has(env.nonce)) throw new Error("replayed");
  const ok = verify(null, Buffer.from(`${env.from}.${env.to}.${env.ts}.${env.nonce}.${env.iv}.${env.ct}.${env.tag}`), fromRaw("ed25519", Buffer.from(peer.signPub, "base64url")), Buffer.from(env.sig, "base64url"));
  if (!ok) throw new Error("bad signature");
  const d = createDecipheriv("aes-256-gcm", key(me, peer.boxPub, Buffer.from(env.nonce, "base64url")), Buffer.from(env.iv, "base64url"));
  d.setAuthTag(Buffer.from(env.tag, "base64url"));
  const msg = JSON.parse(Buffer.concat([d.update(Buffer.from(env.ct, "base64url")), d.final()]).toString()) as Plain;
  seen.add(env.nonce);
  if (seen.size > 5000) seen.clear();
  if (!["ask", "answer", "note"].includes(msg.kind) || typeof msg.text !== "string") throw new Error("bad message");
  return { peer, msg: { ...msg, text: msg.text.slice(0, 8000) } };
}

export class PeerStore {
  constructor(private db: DB) {
    db.exec("CREATE TABLE IF NOT EXISTS federation_peers (id TEXT PRIMARY KEY, name TEXT NOT NULL, addr TEXT NOT NULL, sign_pub TEXT NOT NULL, box_pub TEXT NOT NULL, added_at TEXT NOT NULL)");
  }
  list(): Peer[] {
    return (this.db.prepare("SELECT id, name, addr, sign_pub AS signPub, box_pub AS boxPub, added_at AS addedAt FROM federation_peers ORDER BY added_at").all() as Peer[]);
  }
  add(p: Omit<Peer, "addedAt">, at: string) {
    this.db.prepare("INSERT OR REPLACE INTO federation_peers (id, name, addr, sign_pub, box_pub, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(p.id, p.name, p.addr, p.signPub, p.boxPub, at);
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM federation_peers WHERE id = ?").run(id);
  }
}

/** The listening side: one POST endpoint, small bodies only. */
export function listen(port: number, onEnvelope: (e: Envelope) => Promise<void>): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/federation") return void res.writeHead(404).end();
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c;
      if (body.length > 65_536) req.destroy();
    });
    req.on("end", () => {
      let env: Envelope;
      try {
        env = JSON.parse(body) as Envelope;
      } catch {
        return void res.writeHead(400).end();
      }
      onEnvelope(env).then(
        () => res.writeHead(202).end(),
        () => res.writeHead(403).end(),
      );
    });
  });
  return new Promise((r, j) => server.once("error", j).listen(port, "0.0.0.0", () => r(server)));
}
