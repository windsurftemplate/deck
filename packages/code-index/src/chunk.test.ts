import { describe, expect, it } from "vitest";
import { analyzeFile, chunkFile, identifierWords, isCode } from "./chunk.js";
const samples: Record<string, string> = {
  "a.ts": "import x from 'y';\nexport class Store {\n  save(a: number) { return a }\n  private load() {}\n}\nexport function helper() {}\nexport const arrow = async () => 1;\nconst k = 3;\ninterface Shape { a: string }\nexport type T = number;\nenum E { A }\nnamespace NS { export function inner() {} }\n",
  "a.tsx": "export function App() { return <div/> }\n",
  "a.py": "import os\n@dec\ndef f(x):\n    return x\nclass C:\n    def m(self):\n        pass\n    @property\n    def p(self): return 1\n",
  "a.go": "package main\nfunc F() {}\nfunc (s *Server) Serve() error { return nil }\ntype Server struct { a int }\ntype (\n  I interface{ M() }\n  N int\n)\n",
  "a.rs": "fn f() {}\nstruct S { a: i32 }\nimpl S { fn new() -> S { S{a:1} } }\nimpl Display for S { fn fmt(&self) {} }\ntrait T { fn t(&self); }\nenum E { A }\nmod m { pub fn g() {} }\n",
  "A.java": "package x;\npublic class A { public A() {} void m() {} interface I {} }\n",
  "a.cs": "namespace N { public class C { public void M() {} } struct S {} }\n",
  "a.cpp": "int f(int a) { return a; }\nclass K { public: void m() {} };\nvoid K::n() {}\nnamespace ns { struct P { int x; }; }\n",
  "a.rb": "module M\n  class C\n    def m; end\n    def self.s; end\n  end\nend\n",
  "a.php": "<?php\nfunction f() {}\nclass C { public function m() {} }\n",
  "a.sh": "f() { echo 1; }\nfunction g { echo 2; }\n",
};
const shape = async (p: string) => (await chunkFile(p, samples[p]!)).slice(1).map((c) => `${c.kind}:${c.qualified}@${c.startLine}-${c.endLine}`);

describe("chunking at real boundaries", () => {
  it("splits each language into named functions, methods, classes and types", async () => {
    expect(await shape("a.ts")).toEqual(["class:Store@2-5", "method:Store.save@3-3", "method:Store.load@4-4", "function:helper@6-6", "function:arrow@7-7", "interface:Shape@9-9", "type:T@10-10", "enum:E@11-11", "module:NS@12-12", "function:NS.inner@12-12"]);
    expect(await shape("a.tsx")).toEqual(["function:App@1-1"]);
    expect(await shape("a.py")).toEqual(["function:f@2-4", "class:C@5-9", "method:C.m@6-7", "method:C.p@8-9"]); // decorators belong to their function
    expect(await shape("a.go")).toEqual(["function:F@2-2", "method:Server.Serve@3-3", "struct:Server@4-4", "interface:I@6-6", "type:N@7-7"]);
    expect(await shape("a.rs")).toEqual(["function:f@1-1", "struct:S@2-2", "impl:S@3-3", "method:S.new@3-3", "impl:S as Display@4-4", "method:S.fmt@4-4", "trait:T@5-5", "enum:E@6-6", "module:m@7-7", "function:m.g@7-7"]);
    expect(await shape("A.java")).toEqual(["class:A@2-2", "method:A.A@2-2", "method:A.m@2-2", "interface:A.I@2-2"]);
    expect(await shape("a.cs")).toEqual(["class:C@1-1", "method:C.M@1-1", "struct:S@1-1"]);
    expect(await shape("a.cpp")).toEqual(["function:f@1-1", "class:K@2-2", "method:K.m@2-2", "function:K::n@3-3", "struct:P@4-4"]);
    expect(await shape("a.rb")).toEqual(["module:M@1-6", "class:M.C@2-5", "method:M.C.m@3-3", "method:M.C.s@4-4"]);
    expect(await shape("a.php")).toEqual(["function:f@2-2", "class:C@3-3", "method:C.m@3-3"]);
    expect(await shape("a.sh")).toEqual(["function:f@1-1", "function:g@2-2"]);
  }, 30_000); // the first use loads 11 grammars

  it("keeps the file head, signatures and text, and windows code without a grammar", async () => {
    const ts = await chunkFile("a.ts", samples["a.ts"]!);
    expect(ts[0]).toMatchObject({ kind: "file", name: "a.ts", startLine: 1 });
    expect(ts[0]!.text).toContain("import x from 'y';");
    expect(ts.find((c) => c.name === "Store")!.signature).toBe("class Store");
    const kt = await chunkFile("Main.kt", Array.from({ length: 200 }, (_, k) => `val x${k} = ${k}`).join("\n"));
    expect(kt.slice(1).map((c) => c.qualified)).toEqual(["Main.kt#L1-80", "Main.kt#L81-160", "Main.kt#L161-200"]);
    expect(isCode("a.kt") && isCode("b.TS") && !isCode("README.md") && !isCode("package.json")).toBe(true);
  });

  it("splits identifiers into words", () => {
    expect(identifierWords("getHTTPResponse_code")).toBe("get http response code");
    expect(identifierWords("Store.save")).toBe("store save");
  });

  it("records imports, and the calls and types inside each definition", async () => {
    const ts = await analyzeFile("src/cart.ts", "import { price } from './price.js';\nimport type { Item } from \"../types\";\nconst fs = require('node:fs');\nexport class Cart {\n  total(items: Item[]): number { return items.reduce((s, i) => s + price(i), 0); }\n}\nexport function checkout(c: Cart) { return c.total([]); }\nsetup();\n");
    const by = (k: string) => ts.edges.filter((e) => e.kind === k).map((e) => `${e.from}>${e.name}`);
    expect(by("import")).toEqual(["src/cart.ts>./price.js", "src/cart.ts>../types", "src/cart.ts>node:fs"]);
    expect(by("call")).toEqual(["Cart.total>reduce", "Cart.total>price", "checkout>total", "src/cart.ts>setup"]);
    expect(by("type")).toEqual(["Cart.total>Item", "checkout>Cart"]);
    const py = await analyzeFile("app/views.py", "from .models import Order\nimport os.path\ndef show(r):\n    return render(Order.objects.get(id=1))\n");
    expect(py.edges.filter((e) => e.kind === "import").map((e) => e.name)).toEqual([".models", "os.path"]);
    expect(py.edges.filter((e) => e.kind === "call").map((e) => `${e.from}>${e.name}`)).toEqual(["show>render", "show>get"]);
    const go = await analyzeFile("cmd/main.go", "package main\nimport (\n  \"example.com/app/internal/db\"\n)\nfunc main() { db.Open() }\n");
    expect(go.edges.map((e) => `${e.kind}:${e.from}>${e.name}`)).toEqual(["import:cmd/main.go>example.com/app/internal/db", "call:main>Open"]);
  });
});
