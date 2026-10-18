import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { ESLint } from "eslint";
import refresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { expect, it } from "vitest";

it.each(["DiagramPanel", "AnnotationPanel"])(
  "%s does not acquire the bulk/edge panel implementation graph",
  (panel) => {
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const code = readFileSync(path, "utf8");
      for (const match of code.matchAll(/from "(\.\/[^"\n]+)"/g)) {
        const target = [".ts", ".tsx"].map((ext) => resolve(dirname(path), match[1] + ext)).find(existsSync);
        if (target) visit(target);
      }
    };
    visit(resolve(`src/canvas/inspector/${panel}.tsx`));
    expect([...seen].map((path) => basename(path))).not.toEqual(expect.arrayContaining(["MultiPanel.tsx"]));
    expect([...seen].map((path) => basename(path))).not.toEqual(expect.arrayContaining(["EdgePanel.tsx"]));
    expect([...seen].map((path) => basename(path))).not.toEqual(expect.arrayContaining(["SimulationFields.tsx"]));
  },
);

it("keeps every inspector component module compatible with Fast Refresh", async () => {
  const lint = new ESLint({
    overrideConfigFile: true,
    allowInlineConfig: false,
    overrideConfig: [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser: tseslint.parser },
        plugins: { "react-refresh": refresh },
        rules: { "react-refresh/only-export-components": ["error", { allowConstantExport: true }] },
      },
    ],
  });
  const results = await lint.lintFiles(["src/canvas/inspector/*.tsx"]);
  expect(
    results.flatMap((result) => result.messages.map((message) => `${basename(result.filePath)}: ${message.message}`)),
  ).toEqual([]);
});
