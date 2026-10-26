import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve("src/sim/engine");
const facade = resolve("src/sim/engine.ts");
const model = resolve(root, "model.ts");

/** Include type imports, re-exports and dynamic imports: none may hide a back-edge. */
function imports(source: string): string[] {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) ||
      (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    ) {
      const value = ts.isImportTypeNode(node)
        ? (node.argument as ts.LiteralTypeNode).literal
        : (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
      if (value && ts.isStringLiteral(value)) found.push(value.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function violations(entries: string[], read: (file: string) => string, find: (file: string) => string): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    const seen = new Set<string>();
    function visit(file: string, chain: string[]): void {
      if (seen.has(file)) return;
      seen.add(file);
      for (const specifier of imports(read(file))) {
        if (!specifier.startsWith(".")) continue;
        const next = find(resolve(dirname(file), specifier));
        const path = [...chain, next];
        const internal = relative(root, next);
        if (next === facade || (!internal.startsWith("..") && !isAbsolute(internal) && next !== model))
          errors.push(path.map((part) => relative(root, part)).join(" -> "));
        else visit(next, path);
      }
    }
    visit(entry, [entry]);
  }
  return errors;
}

describe("engine import boundaries", () => {
  it("keeps every internal module independent of phases and the facade, transitively including types", () => {
    const entries = readdirSync(root, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => resolve(root, file));
    expect(entries).toContain(model);
    expect(entries).toContain(resolve(root, "checkpoint.ts"));
    const find = (file: string) => {
      const found = [file, `${file}.ts`, `${file}.tsx`, resolve(file, "index.ts")].find(
        (candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate),
      );
      if (!found) throw new Error(`Cannot resolve ${file}`);
      return found;
    };
    expect(violations(entries, (file) => readFileSync(file, "utf8"), find)).toEqual([]);
  });

  it.each([
    ['import type { Work } from "../engine";', ""],
    ['export { run } from "./calls";', ""],
    ['import "../helper";', 'export type Work = import("./engine").Work;'],
    ['import "../helper";', 'export const load = () => import("./engine/calls");'],
    ['import "../helper";', 'const engine = require("./engine");'],
  ])("rejects direct and transitive boundary violations: %s %s", (phase, helper) => {
    const entry = resolve(root, "accounting.ts");
    const sources = new Map([
      [entry, phase],
      [resolve("src/sim/helper.ts"), helper],
    ]);
    expect(
      violations(
        [entry],
        (file) => sources.get(file) ?? "",
        (file) => `${file}.ts`,
      ),
    ).toHaveLength(1);
  });
});
