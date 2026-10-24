import ts from "typescript";
import MagicString from "magic-string";
import type { Plugin } from "vite";

/**
 * Inject at actual loop bodies and function/callback entries, including scans added by a regression.
 * This plugin is loaded by vitest.config.ts only. It never changes a shipped bundle. Native regex
 * backtracking is opaque to JS probes and keeps separate timing checks in the Benchmarks workflow.
 */
export function operationProbes(): Plugin {
  let root = "";
  return {
    name: "test-operation-probes",
    enforce: "pre",
    configResolved(config) {
      root = config.root.replaceAll("\\", "/").replace(/\/$/, "") + "/";
    },
    transform(code, id) {
      const file = id.replaceAll("\\", "/").split("?")[0];
      if (
        !file.startsWith(root + "src/") ||
        !/\.tsx?$/.test(file) ||
        /\.(?:test|bench)\./.test(file) ||
        (/\/src\/(?:examples|lab|test)\//.test(file) && !file.endsWith("/opCounterFixture.ts"))
      )
        return;
      const source = file.slice(root.length);
      const hit = `globalThis.__ldOpCounter?.add(1,${JSON.stringify(source)});`;
      const tree = ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const out = new MagicString(code);
      const body = (node: ts.Statement) => {
        if (ts.isBlock(node)) out.appendRight(node.getStart(tree) + 1, hit);
        else {
          out.appendRight(node.getStart(tree), `{${hit}`);
          out.appendLeft(node.end, "}");
        }
      };
      const visit = (node: ts.Node) => {
        if (
          ts.isForStatement(node) ||
          ts.isForOfStatement(node) ||
          ts.isForInStatement(node) ||
          ts.isWhileStatement(node) ||
          ts.isDoStatement(node)
        )
          body(node.statement);
        if (ts.isFunctionLike(node) && "body" in node && node.body) {
          const b = node.body as ts.ConciseBody;
          if (ts.isBlock(b)) out.appendRight(b.getStart(tree) + 1, hit);
          else {
            out.appendRight(b.getStart(tree), `(${hit.slice(0, -1)},`);
            out.appendLeft(b.end, ")");
          }
        }
        // Serialization and copying are native loops too. Count emitted characters/elements, so repeated
        // JSON.stringify(prefix) or slice(prefix) cannot masquerade as one constant-time function call.
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          !node.questionDotToken &&
          !node.expression.questionDotToken &&
          (node.flags & ts.NodeFlags.OptionalChain) === 0 &&
          (/^(slice|join|concat)$/.test(node.expression.name.text) ||
            (ts.isIdentifier(node.expression.expression) &&
              node.expression.expression.text === "JSON" &&
              node.expression.name.text === "stringify"))
        ) {
          out.appendRight(
            node.getStart(tree),
            `((__ldResult)=>(globalThis.__ldOpCounter?.add(__ldResult?.length ?? 0,${JSON.stringify(source)}),__ldResult))(`,
          );
          out.appendLeft(node.end, ")");
        }
        // A bounded slice before trim must stay bounded: function/loop counts cannot see native string scans.
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          /^(trim|trimStart|trimEnd)$/.test(node.expression.name.text) &&
          !node.arguments.length &&
          !node.questionDotToken &&
          !node.expression.questionDotToken &&
          (node.flags & ts.NodeFlags.OptionalChain) === 0
        ) {
          const receiver = node.expression.expression;
          out.appendRight(
            receiver.getStart(tree),
            "((__ldText)=>(globalThis.__ldOpCounter?.add(__ldText.length," +
              JSON.stringify(source) +
              "),__ldText." +
              node.expression.name.text +
              "()))(",
          );
          out.remove(receiver.end, node.end);
          out.appendLeft(node.end, ")");
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
      return { code: out.toString(), map: out.generateMap({ source: file, includeContent: true, hires: true }) };
    },
  };
}
