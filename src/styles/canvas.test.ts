import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

function expand(file: string): string {
  return readFileSync(file, "utf8").replace(/^@import "([^"]+)";$/gm, (_, path: string) =>
    expand(resolve(dirname(file), path)),
  );
}

function check(css?: string) {
  const dir = mkdtempSync(join(tmpdir(), "canvas-css-"));
  try {
    const file = join(dir, "canvas.css");
    if (css !== undefined) writeFileSync(file, css);
    return execFileSync(process.execPath, ["scripts/check-canvas-css.mjs", ...(css === undefined ? [] : [file])], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, GIT_DIR: join(dir, "no-repository") },
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
}

it("preserves the original canvas cascade across concept imports", () => {
  expect(check()).toContain("563 rules unchanged");
}, 30_000);

it("rejects changed declarations and media conditions", () => {
  const css = expand(resolve("src/styles/canvas.css"));
  expect(() => check(css.replace("overflow: clip !important", "overflow: hidden !important"))).toThrow();
  expect(() => check(css.replace("max-width: 1100px", "max-width: 1099px"))).toThrow();
}, 30_000);

it("rejects reordering equal-specificity overrides of the same element", () => {
  const css = expand(resolve("src/styles/canvas.css"));
  const headers = css.match(/\.palette-sec-head \{[^}]+\}/g)!;
  expect(headers).toHaveLength(2);
  const swapped = css
    .replace(headers[0], "CANVAS_CSS_SWAP")
    .replace(headers[1], headers[0])
    .replace("CANVAS_CSS_SWAP", headers[1]);
  expect(() => check(swapped)).toThrow();
}, 30_000);

it("recognizes different selectors that share the stencil drag preview", () => {
  const css = expand(resolve("src/styles/canvas.css"));
  const node = /^\.dn \{[^}]+\}/m.exec(css)![0];
  const preview = /^\.stencil-drag-preview \{[^}]+\}/m.exec(css)![0];
  const swapped = css.replace(node, "CANVAS_CSS_SWAP").replace(preview, node).replace("CANVAS_CSS_SWAP", preview);
  expect(() => check(swapped)).toThrow();
}, 30_000);

it("keeps the generic settings-card bridge after the more specific pip bridge", () => {
  const css = expand(resolve("src/styles/canvas.css"));
  const base = /^\.fe-card::after \{[^}]+\}/m.exec(css)![0];
  const pip = /^\.fe-card\.dn-pip-card::after \{[^}]+\}/m.exec(css)![0];
  const moved = css.replace(base, "").replace(pip, `${base}\n\n${pip}`);
  expect(() => check(moved)).toThrow();
}, 30_000);
