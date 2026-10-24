import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import ts from "typescript";

/** Parse syntax, so comments and strings do not count and bracket/optional access cannot bypass the guard. */
export function timeoutReferences(source, file = "test.ts") {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines = [];
  const visit = (node) => {
    const property = ts.isPropertyAccessExpression(node)
      ? node.name
      : ts.isElementAccessExpression(node)
        ? node.argumentExpression
        : undefined;
    if (property && (ts.isIdentifier(property) || ts.isStringLiteral(property)) && property.text === "waitForTimeout")
      lines.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return lines;
}

export function checkWaits(root) {
  const allowlist = JSON.parse(readFileSync(resolve(root, "tests/e2e/wait-for-timeout-allowlist.json"), "utf8"));
  for (const entry of allowlist)
    if (!entry.file?.startsWith("tests/e2e/") || !Number.isInteger(entry.line) || !entry.reason?.trim())
      throw new Error("Each timed-wait exception needs an exact file, line and reason");
  const unused = new Set(allowlist);
  const errors = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const file = relative(root, path).replaceAll("\\", "/");
        for (const line of timeoutReferences(readFileSync(path, "utf8"), file)) {
          const allowed = allowlist.find((entry) => entry.file === file && entry.line === line);
          if (allowed) unused.delete(allowed);
          else errors.push(`${file}:${line}: waitForTimeout is forbidden; wait on state or use page.clock`);
        }
      }
    }
  }
  scan(resolve(root, "tests/e2e"));
  for (const entry of unused) errors.push(`${entry.file}:${entry.line}: remove the unused timed-wait exception`);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkWaits(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("E2E waits: no unapproved timed waits");
}
