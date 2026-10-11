import { expect, it } from "vitest";
import { exampleTestLabel } from "./exampleLabels";
import { readFileSync } from "node:fs";

it("anonymizes local paths and excludes local files from the normal reporting suite", () => {
  expect(exampleTestLabel("../examples/private/synthetic-confidential.json", 0)).toBe("local example #1");
  expect(exampleTestLabel("..\\examples\\private\\synthetic-confidential.json", 1)).toBe("local example #2");
  const suite = readFileSync(new URL("./examples.test.ts", import.meta.url), "utf8");
  expect(suite.includes('"../examples/private/*.json"')).toBe(false);
  // A recursive glob would silently include local files, even without naming the directory.
  expect(suite).toMatch(/import\.meta\.glob<DiagramFile>\("\.\.\/examples\/\*\.json"/);
});
