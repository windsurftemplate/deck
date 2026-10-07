import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import type * as TS from "@vscode/tree-sitter-wasm";

/**
 * Splits source files at real boundaries (functions, methods, classes, types) with tree-sitter, so each piece of
 * the index is one thing with a name. Grammars are WebAssembly: no compiler or native module on any platform.
 * Languages without a grammar are split into line windows.
 */

export type ChunkKind = "file" | "function" | "method" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "impl" | "module" | "lines";

export interface CodeChunk {
  path: string;
  /** The name as written, e.g. "save". */
  name: string;
  /** With its containers, e.g. "Store.save". */
  qualified: string;
  kind: ChunkKind;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** First line of the definition, trimmed. */
  signature: string;
  /** Source text, cut at MAX_TEXT. */
  text: string;
}

const MAX_TEXT = 6000;
const WINDOW = 80;
const HEAD_LINES = 60;

const GRAMMAR: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".cs": "c-sharp",
  ".c": "cpp", ".h": "cpp", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".rb": "ruby", ".php": "php", ".sh": "bash", ".bash": "bash",
};
/** Code without a grammar here: indexed as line windows so keyword and meaning search still find it. */
const WINDOWED = new Set([".kt", ".kts", ".swift", ".scala", ".lua", ".dart", ".ex", ".exs", ".m", ".mm", ".vue", ".svelte", ".sql", ".zig", ".r", ".jl", ".clj", ".hs", ".ml", ".fs", ".ps1", ".pl", ".erl", ".groovy", ".gradle", ".proto", ".graphql", ".tf"]);

/** Whether a file is source code the index covers. */
export const isCode = (path: string) => {
  const e = extname(path).toLowerCase();
  return e in GRAMMAR || WINDOWED.has(e);
};

/* ---------- grammars ---------- */

type Lib = typeof TS;
let lib: Promise<{ ts: Lib; dir: string }> | null = null;
const languages = new Map<string, Promise<TS.Language>>();

function load(): Promise<{ ts: Lib; dir: string }> {
  lib ??= (async () => {
    const require = createRequire(import.meta.url);
    const dir = join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
    const ts = require("@vscode/tree-sitter-wasm") as Lib;
    await ts.Parser.init({ locateFile: (f: string) => join(dir, f) });
    return { ts, dir };
  })();
  return lib;
}

async function parserFor(grammar: string): Promise<TS.Parser> {
  const { ts, dir } = await load();
  if (!languages.has(grammar)) languages.set(grammar, ts.Language.load(join(dir, `tree-sitter-${grammar}.wasm`)));
  const p = new ts.Parser();
  p.setLanguage(await languages.get(grammar)!);
  return p;
}

/* ---------- definitions per language ---------- */

/** Node type -> kind. "container" kinds are also searched inside for members. */
const DEFS: Record<string, Record<string, ChunkKind>> = {
  typescript: { function_declaration: "function", generator_function_declaration: "function", class_declaration: "class", abstract_class_declaration: "class", method_definition: "method", abstract_method_signature: "method", interface_declaration: "interface", type_alias_declaration: "type", enum_declaration: "enum", internal_module: "module" },
  javascript: { function_declaration: "function", generator_function_declaration: "function", class_declaration: "class", method_definition: "method" },
  python: { function_definition: "function", class_definition: "class" },
  go: { function_declaration: "function", method_declaration: "method", type_spec: "type" },
  rust: { function_item: "function", struct_item: "struct", enum_item: "enum", trait_item: "trait", type_item: "type", impl_item: "impl", mod_item: "module", macro_definition: "function" },
  java: { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "class", annotation_type_declaration: "interface", method_declaration: "method", constructor_declaration: "method" },
  "c-sharp": { class_declaration: "class", interface_declaration: "interface", struct_declaration: "struct", enum_declaration: "enum", record_declaration: "class", method_declaration: "method", constructor_declaration: "method" },
  cpp: { function_definition: "function", class_specifier: "class", struct_specifier: "struct", enum_specifier: "enum" },
  ruby: { method: "method", singleton_method: "method", class: "class", module: "module" },
  php: { function_definition: "function", class_declaration: "class", interface_declaration: "interface", trait_declaration: "trait", enum_declaration: "enum", method_declaration: "method" },
  bash: { function_definition: "function" },
};
DEFS.tsx = DEFS.typescript!;
const CONTAINERS = new Set<ChunkKind>(["class", "interface", "impl", "module", "trait", "struct", "enum"]);
/** Variable declarations whose value is a function or class count as definitions (const f = () => ...). */
const DECLARATIONS = new Set(["lexical_declaration", "variable_declaration"]);
const FUNCTION_VALUES: Record<string, ChunkKind> = { arrow_function: "function", function_expression: "function", function: "function", generator_function: "function", class: "class" };
/** Scopes that hold definitions without being one (namespaces, declaration lists). Walked through. */
const PASS_THROUGH = new Set(["program", "source_file", "module", "translation_unit", "export_statement", "declaration_list", "namespace_declaration", "file_scoped_namespace_declaration", "namespace_definition", "class_body", "class_declaration_body", "body_statement", "block", "statement_block", "field_declaration_list", "type_declaration", "decorated_definition", "ambient_declaration", "interface_body", "enum_body", "compilation_unit", "php_tag", "program_body", "expression_statement"]);

/** The name of a C or C++ declarator: the innermost identifier, keeping a qualified name (A::b) whole. */
function declaratorName(n: TS.Node | null): string {
  for (let d = n; d; d = d.childForFieldName("declarator")) {
    if (["identifier", "field_identifier", "qualified_identifier", "destructor_name", "operator_name", "type_identifier"].includes(d.type)) return d.text;
  }
  return "";
}

function nameOf(n: TS.Node, grammar: string): string {
  if (grammar === "cpp" && n.type === "function_definition") return declaratorName(n.childForFieldName("declarator"));
  if (n.type === "impl_item") {
    const trait = n.childForFieldName("trait")?.text;
    const type = n.childForFieldName("type")?.text ?? "";
    return trait ? `${type} as ${trait}` : type;
  }
  return n.childForFieldName("name")?.text ?? "";
}

/** Go types: the kind follows what the type is. */
const goKind = (n: TS.Node): ChunkKind => {
  const t = n.childForFieldName("type")?.type;
  return t === "struct_type" ? "struct" : t === "interface_type" ? "interface" : "type";
};

const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim().replace(/\s*\{$/, "").slice(0, 200);
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…` : s);

/** Splits one file into chunks. Always returns a "file" chunk (its head: imports, header comment) first. */
export async function chunkFile(path: string, source: string): Promise<CodeChunk[]> {
  const lines = source.split("\n");
  const head: CodeChunk = { path, name: basename(path), qualified: path, kind: "file", startLine: 1, endLine: Math.min(lines.length, HEAD_LINES), signature: path, text: cut(lines.slice(0, HEAD_LINES).join("\n")) };
  const grammar = GRAMMAR[extname(path).toLowerCase()];
  if (!grammar) return [head, ...windows(path, lines)];
  const parser = await parserFor(grammar);
  const tree = parser.parse(source);
  if (!tree) return [head, ...windows(path, lines)];
  const defs = DEFS[grammar]!;
  const out: CodeChunk[] = [head];
  // inType: directly inside a class, impl, trait or similar, where functions are methods (not inside a module).
  const emit = (n: TS.Node, range: TS.Node, kind: ChunkKind, name: string, scope: string[], inType: boolean) => {
    if (!name) return;
    out.push({ path, name, qualified: [...scope, name].join("."), kind: inType && kind === "function" ? "method" : kind, startLine: range.startPosition.row + 1, endLine: range.endPosition.row + 1, signature: firstLine(n.text), text: cut(range.text) });
  };
  const walk = (n: TS.Node, scope: string[], inType: boolean, range: TS.Node = n): void => {
    // Python decorators and TypeScript exports belong to the definition they wrap.
    if (n.type === "decorated_definition") {
      const inner = n.childForFieldName("definition");
      if (inner) return walk(inner, scope, inType, n);
    }
    if (n.type === "export_statement") {
      const inner = n.childForFieldName("declaration");
      if (inner) return walk(inner, scope, inType, n);
    }
    const kind = n.type === "type_spec" ? goKind(n) : defs[n.type];
    if (kind) {
      let name = nameOf(n, grammar);
      if (grammar === "go" && n.type === "method_declaration") {
        const recv = n.childForFieldName("receiver")?.text.match(/(\w+)\s*\)$/)?.[1];
        if (recv) return emit(n, range, "method", name, [...scope, recv], true);
      }
      if (n.type === "type_spec" && n.parent?.namedChildCount === 1) range = n.parent;
      emit(n, range, kind, name, scope, inType);
      if (CONTAINERS.has(kind) && name) for (const c of n.namedChildren) if (c) walk(c, [...scope, name.replace(/ as .*$/, "")], kind !== "module");
      return;
    }
    if (DECLARATIONS.has(n.type)) {
      for (const d of n.namedChildren) {
        const value = d?.childForFieldName("value");
        const k = value && FUNCTION_VALUES[value.type];
        if (d && k) emit(value!, n.namedChildCount === 1 ? range : d, k, d.childForFieldName("name")?.text ?? "", scope, inType);
      }
      return;
    }
    if (PASS_THROUGH.has(n.type) || n.parent === null) for (const c of n.namedChildren) if (c) walk(c, scope, inType);
  };
  walk(tree.rootNode, [], false);
  tree.delete();
  parser.delete();
  return out;
}

/** Line windows for code without a grammar (and files that fail to parse). */
function windows(path: string, lines: string[]): CodeChunk[] {
  if (lines.length <= HEAD_LINES) return [];
  const out: CodeChunk[] = [];
  for (let s = 0; s < lines.length; s += WINDOW) {
    const e = Math.min(lines.length, s + WINDOW);
    out.push({ path, name: `${basename(path)}#L${s + 1}-${e}`, qualified: `${path}#L${s + 1}-${e}`, kind: "lines", startLine: s + 1, endLine: e, signature: firstLine(lines.slice(s, e).join("\n")), text: cut(lines.slice(s, e).join("\n")) });
  }
  return out;
}

/** Splits identifiers into words for keyword search: getUserName, get_user_name -> get user name. */
export function identifierWords(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}
