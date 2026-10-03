import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { checkUrl, extractFile, fetchPage, htmlToText, parseMarkdown, readAppleNotes, readNotionZip } from "./index.js";

describe("ingest", () => {
  it("reads Markdown notes with front matter and wikilinks", () => {
    const n = parseMarkdown("vault/Acme.md", "---\ntags: [client]\n---\n# Acme Corp\nCISO is [[Dana Wright|Dana]]. See [[Pricing#Q1]] and [[Dana Wright]].");
    expect(n).toEqual({ title: "Acme Corp", text: "# Acme Corp\nCISO is [[Dana Wright|Dana]]. See [[Pricing#Q1]] and [[Dana Wright]].", links: ["Dana Wright", "Pricing"] });
  });

  it("turns HTML into readable text without scripts or navigation", () => {
    const h = htmlToText("<html><head><title>Breach report</title><script>alert(1)</script></head><body><nav>Home | About</nav><article><h1>Keys leaked</h1><p>An API key was found in a public repo.</p></article><footer>©</footer></body></html>");
    expect(h.title).toBe("Breach report");
    expect(h.text).toContain("An API key was found in a public repo.");
    expect(h.text).not.toMatch(/alert|Home \| About|©/);
  });

  it("reads text, Word and PDF files and refuses unknown types", async () => {
    expect(await extractFile("notes.txt", strToU8("plain words"))).toEqual({ title: "notes", text: "plain words", links: [] });
    await expect(extractFile("photo.heic", new Uint8Array(3))).rejects.toThrow(/use PDF, Word/);
    const pdf = strToU8(MINI_PDF);
    expect((await extractFile("memo.pdf", pdf)).text).toContain("Hello deck");
  });

  it("blocks links to this machine or private networks", () => {
    for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.5/admin", "http://10.0.0.1", "file:///etc/passwd", "https://u:p@example.com", "http://[::1]/"]) expect(() => checkUrl(bad)).toThrow();
    expect(checkUrl("https://example.com/a").hostname).toBe("example.com");
  });

  it("fetches a page and keeps its final address", async () => {
    const f = (async () => {
      const r = new Response("<html><title>Pricing</title><body><main><p>Plans start at 2k.</p></main></body></html>", { headers: { "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: "https://example.com/pricing" });
      return r;
    }) as unknown as typeof fetch;
    const p = await fetchPage("https://example.com/p", f);
    expect(p).toMatchObject({ title: "Pricing", url: "https://example.com/pricing" });
    expect(p.text).toContain("Plans start at 2k.");
  });

  it("reads a Notion export and an Apple Notes listing", async () => {
    const zip = zipSync({ "Export/Acme 0123456789abcdef0123456789abcdef.md": strToU8("# Acme\nSee [Pricing](Pricing%20fedcba9876543210fedcba9876543210.md)"), "Export/Pricing fedcba9876543210fedcba9876543210.md": strToU8("# Pricing\n2k per month"), "Export/table.csv": strToU8("a,b") });
    const notes = readNotionZip(zip);
    expect(notes.map((n) => n.title).sort()).toEqual(["Acme", "Pricing"]);
    expect(notes.find((n) => n.title === "Acme")!.links).toEqual(["Pricing"]);
    const apple = await readAppleNotes(async () => JSON.stringify([{ name: "Ideas", body: "<div>Ship the MCP server</div>" }, { name: "Empty", body: "" }]));
    expect(apple).toEqual([{ title: "Ideas", text: "Ship the MCP server", links: [] }]);
  });
});

// A tiny valid PDF with the text "Hello deck".
const MINI_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 41>>stream
BT /F1 18 Tf 20 40 Td (Hello deck) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
