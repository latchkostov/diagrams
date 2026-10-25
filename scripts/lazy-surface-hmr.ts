import ts from "typescript";
import MagicString from "magic-string";
import type { Plugin } from "vite";

/** Supply the defining module's hot context without adding dev metadata to production chunks. */
export function lazySurfaceHmr(): Plugin {
  return {
    name: "lazy-surface-hmr",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (!/[/\\]src[/\\].*\.tsx?$/.test(id) || /\.test\./.test(id) || !code.includes("defineLazySurface")) return;
      const tree = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const names = new Set<string>();
      let registry = "";
      for (const node of tree.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        if (!/\/lazySurface$/.test(node.moduleSpecifier.text)) continue;
        registry = node.moduleSpecifier.text + "s";
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            if ((binding.propertyName ?? binding.name).text === "defineLazySurface") names.add(binding.name.text);
      }
      if (!names.size) return;
      const out = new MagicString(code);
      out.prepend(`import { withLazySurfaceOwner as __ldSurfaceOwner } from ${JSON.stringify(registry)};\n`);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          names.has(node.expression.text) &&
          node.arguments.length === 1
        ) {
          out.prependLeft(node.getStart(tree), "__ldSurfaceOwner(import.meta.hot, () => ");
          out.appendLeft(node.end, ")");
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
      return { code: out.toString(), map: out.generateMap({ hires: true, source: id, includeContent: true }) };
    },
  };
}
