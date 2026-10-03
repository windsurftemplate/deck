import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPack, getPack, listPacks, type Pack } from "./index.js";

describe("workspace packs", () => {
  it("ships valid packs with blank last", () => {
    const ids = listPacks().map((p) => p.id);
    expect(ids).toEqual(["freelancer", "founder", "student", "vaultproof", "blank"].sort((a, b) => (a === "blank" ? 1 : b === "blank" ? -1 : getPack(a)!.name.localeCompare(getPack(b)!.name))));
    expect(ids.at(-1)).toBe("blank");
    for (const p of listPacks()) expect(checkPack(p)).toEqual([]);
  });

  it("refuses packs that would loosen safety", () => {
    const bad = { ...getPack("blank")!, id: "bad", tools: { gtm: { "gmail.send": "allowed" } } } as unknown as Pack;
    expect(checkPack(bad)).toEqual(['gtm gmail.send: packs may only set "ask" or "off"']);
    const dir = mkdtempSync(join(tmpdir(), "packs-"));
    mkdirSync(join(dir, "bad"));
    writeFileSync(join(dir, "bad", "pack.json"), JSON.stringify(bad));
    expect(() => listPacks(dir)).toThrow(/packs may only set/);
  });
});
