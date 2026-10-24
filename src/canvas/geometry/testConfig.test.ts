import { readdirSync, readFileSync } from "node:fs";
import { getParsedCommandLineOfConfigFile, sys } from "typescript";
import { expect, it } from "vitest";

it("keeps Node test roots out of the browser compilation and typechecks them separately", () => {
  const host = { ...sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
  const app = getParsedCommandLineOfConfigFile("tsconfig.json", {}, host)!;
  const tests = getParsedCommandLineOfConfigFile("tsconfig.node.json", {}, host)!;
  expect(app.errors).toEqual([]);
  expect(tests.errors).toEqual([]);
  expect(app.options.types).toEqual(["vite/client"]);
  expect(app.fileNames.filter((p) => /\.test\.tsx?$/.test(p))).toEqual([]);
  expect(tests.options.types).toContain("node");
  expect(tests.fileNames.some((p) => p.endsWith("/src/styles/tokens.test.ts"))).toBe(true);
  const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  expect(scripts.typecheck).toContain("tsc --noEmit -p tsconfig.node.json");
  expect(tests.fileNames.some((p) => p.endsWith("/vitest.config.ts"))).toBe(true);
});

it("limits development layout audits to public fixtures instead of picker enumeration", () => {
  const spec = readFileSync("tests/e2e/layout.spec.ts", "utf8");
  expect(spec).not.toContain("pickerSlugs");
  expect(spec).not.toContain("HTMLSelectElement");
  // The audits walk the public fixtures, all at once or in parts.
  expect(spec).toMatch(/of publicExamples|publicExamples\.filter\(/);
  // The production subpath spec verifies the build's public-only picker; it never visits dev.
  for (const file of readdirSync("tests/e2e").filter((f) => f.endsWith(".spec.ts") && f !== "subpath.spec.ts")) {
    const source = readFileSync(`tests/e2e/${file}`, "utf8");
    expect(source, file).not.toMatch(/HTMLSelectElement\)\.options/);
    expect(source, file).not.toMatch(/getByTestId\(["']example-picker["']\)\s*\.evaluate(?:All)?\(/);
  }
});
