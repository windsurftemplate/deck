import { describe, expect, it } from "vitest";
import { isTestFile, resolveImport } from "./index.js";

describe("code graph", () => {
  const files = new Set(["src/a.ts", "src/b/index.tsx", "src/c.js", "app/models.py", "app/sub/__init__.py", "pkg/util/util.go", "src/main/java/com/x/Y.java", "src/net/http.rs", "src/net/mod.rs"]);
  const dirs = new Set([...files].map((f) => f.slice(0, f.lastIndexOf("/"))));
  it("resolves imports to project files in each language", () => {
    expect(resolveImport("src/x.ts", "./a.js", files, dirs)).toBe("src/a.ts");
    expect(resolveImport("src/x.ts", "./b", files, dirs)).toBe("src/b/index.tsx");
    expect(resolveImport("src/x.ts", "./c", files, dirs)).toBe("src/c.js");
    expect(resolveImport("src/x.ts", "react", files, dirs)).toBeNull();
    expect(resolveImport("app/sub/views.py", "..models", files, dirs)).toBe("app/models.py");
    expect(resolveImport("app/views.py", "app.sub", files, dirs)).toBe("app/sub/__init__.py");
    expect(resolveImport("cmd/main.go", "example.com/me/pkg/util", files, dirs)).toBe("pkg/util/");
    expect(resolveImport("src/main/java/com/x/Z.java", "com.x.Y", files, dirs)).toBe("src/main/java/com/x/Y.java");
    expect(resolveImport("src/main.rs", "crate::net::http::Client", files, dirs)).toBe("src/net/http.rs");
  });
  it("knows test files by convention", () => {
    for (const p of ["src/a.test.ts", "src/a.spec.js", "tests/test_a.py", "a_test.go", "__tests__/x.js", "src/test/java/FooTest.java", "spec/models/user_spec.rb"]) expect(isTestFile(p)).toBe(true);
    for (const p of ["src/a.ts", "src/testing.ts", "src/contest.py"]) expect(isTestFile(p)).toBe(false);
  });
});
