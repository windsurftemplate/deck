import { strFromU8, unzipSync } from "fflate";
import { parse } from "node-html-parser";

/** A piece of content ready for the second brain. Text from outside sources is untrusted. */
export interface Extracted {
  title: string;
  text: string;
  /** Titles this note links to (Obsidian wikilinks, Notion page links). */
  links: string[];
}

export const MAX_CHARS = 2_000_000;
export const MAX_FILE_BYTES = 25_000_000;
const clip = (t: string) => t.replace(/\u0000/g, "").slice(0, MAX_CHARS);
const stem = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

/** Readable text from HTML: drops scripts, styles, navigation and footers; prefers the article or main body. */
export function htmlToText(html: string): { title: string; text: string } {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const title = (root.querySelector("title")?.text ?? root.querySelector("h1")?.text ?? "").trim();
  for (const el of root.querySelectorAll("nav, footer, header, aside, form, svg, iframe")) el.remove();
  const main = root.querySelector("article") ?? root.querySelector("main") ?? root.querySelector("body") ?? root;
  for (const el of main.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section")) el.insertAdjacentHTML("afterend", "\n");
  const text = main.text.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return { title, text: clip(text) };
}

/** A Markdown note: strips front matter; title from the first heading or the file name; collects wikilinks. */
export function parseMarkdown(path: string, content: string): Extracted {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const links = [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
  return { title: h1 || stem(path), text: clip(body.trim()), links: [...new Set(links)] };
}

/** Text from a file, by its extension. */
export async function extractFile(name: string, bytes: Uint8Array): Promise<Extracted> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${name} is larger than 25 MB.`);
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (["md", "markdown", "txt", "text", "csv", "json", "log"].includes(ext)) {
    const content = new TextDecoder().decode(bytes);
    return ext === "md" || ext === "markdown" ? parseMarkdown(name, content) : { title: stem(name), text: clip(content), links: [] };
  }
  if (ext === "html" || ext === "htm") {
    const h = htmlToText(new TextDecoder().decode(bytes));
    return { title: h.title || stem(name), text: h.text, links: [] };
  }
  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (Array.isArray(text) ? text.join("\n\n") : text).trim();
    if (!t) throw new Error(`${name} has no text layer (it may be a scan).`);
    return { title: stem(name), text: clip(t), links: [] };
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { title: stem(name), text: clip(r.value.trim()), links: [] };
  }
  throw new Error(`${name}: use PDF, Word (.docx), Markdown, text, CSV, JSON or HTML.`);
}

/** Refuses links to this machine or a private network. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("That is not a web link.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https links can be added.");
  if (u.username || u.password) throw new Error("Remove the username or password from the link.");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || /^f[cd]/.test(h) || h.startsWith("fe80")) throw new Error("Links to this computer or a private network are not allowed.");
  return u;
}

/** Fetches a web page (5 MB, 15 s at most) and returns its readable text. */
export async function fetchPage(raw: string, f: typeof fetch = fetch): Promise<Extracted & { url: string }> {
  const u = checkUrl(raw);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await f(u.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "deck/0.1 (personal knowledge base)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } });
    if (!res.ok) throw new Error(`The page returned ${res.status}.`);
    const final = res.url ? checkUrl(res.url) : u;
    const type = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 5_000_000) throw new Error("That page is larger than 5 MB.");
    if (type.includes("pdf")) return { ...(await extractFile(`${final.pathname.split("/").pop() || "page"}.pdf`, buf)), url: final.toString() };
    const body = new TextDecoder().decode(buf);
    if (type.includes("html") || /<html/i.test(body.slice(0, 2000))) {
      const h = htmlToText(body);
      if (!h.text) throw new Error("No readable text on that page.");
      return { title: h.title || final.hostname, text: h.text, links: [], url: final.toString() };
    }
    return { title: final.hostname + final.pathname, text: clip(body), links: [], url: final.toString() };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The page took too long to load.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** A Notion export (Markdown & CSV zip): one note per page, page links kept, Notion ids removed from titles. */
export function readNotionZip(bytes: Uint8Array): Extracted[] {
  const files = unzipSync(bytes, { filter: (f) => /\.md$/i.test(f.name) && f.originalSize < MAX_FILE_BYTES });
  const clean = (s: string) => decodeURIComponent(s).replace(/\s[0-9a-f]{32}$/i, "").trim();
  return Object.entries(files).map(([path, data]) => {
    const note = parseMarkdown(clean(stem(path)), strFromU8(data));
    const links = [...note.text.matchAll(/\]\(([^)]+\.md)\)/gi)].map((m) => clean(stem(m[1]!)));
    return { ...note, title: note.title.replace(/\s[0-9a-f]{32}$/i, ""), links: [...new Set([...note.links, ...links])] };
  });
}

/** Apple Notes via AppleScript (macOS only; macOS asks the owner to allow access). */
export async function readAppleNotes(run: (script: string) => Promise<string>, limit = 2000): Promise<Extracted[]> {
  const js = `const n = Application("Notes").notes(); const out = []; for (let i = 0; i < Math.min(n.length, ${limit}); i++) { out.push({ name: n[i].name(), body: n[i].body() }); } JSON.stringify(out);`;
  const raw = await run(js);
  const notes = JSON.parse(raw) as { name: string; body: string }[];
  return notes.map((n) => ({ title: n.name || "Untitled note", text: htmlToText(`<body>${n.body}</body>`).text, links: [] })).filter((n) => n.text.trim());
}
