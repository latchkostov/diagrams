import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps the canvas stylesheet as an ordered index of existing concept files", () => {
  const file = resolve("src/styles/canvas.css");
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = [...css.matchAll(/@import "([^"]+)";/g)];

  expect(imports.length).toBeGreaterThan(0);
  expect(css.replace(/@import "([^"]+)";/g, "").trim()).toBe("");
  const paths = imports.map((match) => resolve(dirname(file), match[1]));
  expect(new Set(paths).size).toBe(paths.length);
  for (const path of paths) expect(statSync(path).isFile()).toBe(true);
});
