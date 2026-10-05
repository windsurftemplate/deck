import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IsolatedBrowser, allowedUrl, elementRisk } from "./index.js";

const CHROME = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", process.env.CHROME_PATH ?? ""].find((p) => p && existsSync(p));

describe("browser rules", () => {
  it("allows only public web addresses", () => {
    for (const u of ["https://example.com", "http://news.ycombinator.com/item?id=1", "about:blank"]) expect(allowedUrl(u), u).toBe(true);
    for (const u of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.1/admin", "http://10.0.0.5", "http://[::1]/", "file:///etc/passwd", "chrome://settings", "http://router.local", "https://user:pw@example.com", "http://2130706433/"]) expect(allowedUrl(u), u).toBe(false);
  });
  it("rates elements: links read, typing write, buying and sending external, secrets refused", () => {
    expect(elementRisk({ tag: "a", role: "link", label: "Pricing" })).toBe("read");
    expect(elementRisk({ tag: "input", role: "field", label: "Search", inputType: "search" })).toBe("write");
    expect(elementRisk({ tag: "button", role: "button", label: "Buy now" })).toBe("external");
    expect(elementRisk({ tag: "button", role: "button", label: "Next", formAction: true })).toBe("external");
    expect(elementRisk({ tag: "button", role: "button", label: "Show more" })).toBe("write");
    expect(elementRisk({ tag: "input", role: "field", label: "Password", inputType: "password" })).toBe("refused");
    expect(elementRisk({ tag: "input", role: "field", label: "Card number", autocomplete: "cc-number" })).toBe("refused");
  });
});

describe.runIf(!!CHROME)("isolated browser (real Chromium)", () => {
  it("opens pages, reads them as text with numbered elements, types, clicks, refuses secrets, and blocks private requests", async () => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      if (req.url === "/two") return res.end("<title>Page two</title><h1>Pricing</h1><p>Team plan is $2,500 a month.</p>");
      res.end(`<title>Shop</title><h1>Welcome</h1><p>Hello from the test shop.</p>
        <a href="/two">Pricing</a>
        <input type="search" placeholder="Search">
        <input type="password" name="pw" placeholder="Password">
        <button>Buy now</button>
        <img src="http://192.168.1.50/tracker.png">`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const profile = mkdtempSync(join(tmpdir(), "deck-browser-"));
    const b = new IsolatedBrowser({ chromePath: CHROME!, profileDir: profile, allowHosts: ["127.0.0.1"] });
    try {
      const s = await b.open(`http://127.0.0.1:${port}/`);
      expect(s.title).toBe("Shop");
      expect(s.text).toContain("Hello from the test shop.");
      const by = (label: string) => s.elements.find((e) => e.label === label)!;
      expect(by("Pricing").risk).toBe("read");
      expect(by("Search").risk).toBe("write");
      expect(by("Password").risk).toBe("refused");
      expect(by("Buy now").risk).toBe("external");
      await expect(b.type(by("Password").id, "hunter2")).rejects.toThrow(/never types into password/);
      await b.type(by("Search").id, "team plan");
      await expect(b.click(by("Pricing").id, { url: "http://elsewhere/", label: "Pricing" })).rejects.toThrow(/page changed/);
      const two = await b.click(by("Pricing").id);
      expect(two.title).toBe("Page two");
      expect(two.text).toContain("$2,500");
      expect(b.blockedRequests().some((u) => u.startsWith("http://192.168.1.50/"))).toBe(true);
      await expect(b.open("http://192.168.1.1/admin")).rejects.toThrow(/Only public/);
    } finally {
      await b.close();
      server.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);
});
