import { readdirSync, readFileSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect, gotoCanvas } from "./fixtures";
import en from "../../src/i18n/en";
import { parse, textOf } from "../../src/i18n/icu";
import { pseudoLocalize } from "../../src/i18n/pseudo";

const codes = readdirSync("src/i18n/locales")
  .filter((file) => file.endsWith(".json") && !file.endsWith(".meta.json"))
  .map((file) => file.slice(0, -5));
const keys = ["select", "add", "annotate", "checks", "stencils", "tutorials", "shortcuts", "ai", "diagram"];

// Measure real glyphs, not just the span: clipping/line-clamping must not conceal a regression.
async function labelProblems(rail: Locator) {
  return rail.getByTestId("rail-label").evaluateAll(async (labels) => {
    await document.fonts.ready;
    return labels.flatMap((label) => {
      if (!label.getClientRects().length) return ["hidden label"];
      const style = getComputedStyle(label);
      const box = label.getBoundingClientRect();
      const parent = label.parentElement;
      const toolbar = label.closest('[data-testid="tool-rail"]');
      if (!parent || !toolbar) throw new Error("A rail label must belong to a rail button");
      const button = parent.getBoundingClientRect();
      const rail = toolbar.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const glyphs = [...range.getClientRects()];
      const lines = new Set(glyphs.map((rect) => Math.round(rect.top)));
      const problems = [];
      if (parseFloat(style.fontSize) < 10.5) problems.push("font below 10.5px");
      if (box.height > parseFloat(style.lineHeight) * 2 + 1 || lines.size > 2) problems.push("more than 2 lines");
      if (box.left < rail.left || box.right > rail.right) problems.push("outside rail width");
      if (box.left < button.left || box.right > button.right || box.top < button.top || box.bottom > button.bottom)
        problems.push("outside button");
      if (
        glyphs.some(
          (rect) =>
            rect.left < box.left - 1 ||
            rect.right > box.right + 1 ||
            rect.top < button.top ||
            rect.bottom > button.bottom,
        ) ||
        label.scrollWidth > label.clientWidth ||
        // Font ascenders/descenders can exceed a line box without clipping (overflow is visible).
        (style.overflowY === "hidden" && label.scrollHeight > label.clientHeight)
      )
        problems.push("clipped or overflowing text");
      if (style.overflowWrap !== "anywhere" || style.hyphens !== "auto") problems.push("missing wrapping safety net");
      return problems.map((problem) => `${label.textContent}: ${problem}`);
    });
  });
}

for (const width of [1280, 320])
  test.describe(`${width}px rail`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const code of ["en", ...codes, "en-XA"])
      test(`${code}: every short label fits with real fonts`, async ({ page }) => {
        const messages: Record<string, string> =
          code === "en" || code === "en-XA" ? en : JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8"));
        await page.addInitScript((code) => localStorage.setItem("diagrams.locale", code), code);
        await gotoCanvas(page, "retry-storm");
        await expect(page.getByTestId("tool-rail")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);
        if (width === 320) await page.getByTestId("rail-more").click();
        const rail = page.getByTestId("tool-rail");
        const expected = keys.slice(0, -1).map((key) => {
          const text = messages[`rail.${key}`];
          expect(text, `${code}: rail.${key} is translated`).toBeTruthy();
          return code === "en-XA" ? textOf(pseudoLocalize(parse(text))) : text;
        });
        await expect(rail.getByTestId("rail-label")).toHaveText(expected);
        await expect.poll(() => labelProblems(rail)).toEqual([]);
        if (code === "es") {
          await expect(page.getByTestId("rail-add")).toHaveAccessibleName(messages["rail.add"]);
          await expect(page.getByTestId("checks-count")).toHaveAttribute("title", /Comprobaciones/);
          await expect(page.getByTestId("checks-count")).toHaveAccessibleName(/Comprobaciones/);
        }
        await page.getByTestId("view-gallery").click();
        await expect(page.getByTestId("view-canvas").getByTestId("rail-label")).toHaveText(
          code === "en-XA" ? textOf(pseudoLocalize(parse(messages["rail.diagram"]))) : messages["rail.diagram"],
        );
        await expect.poll(() => labelProblems(rail)).toEqual([]);
      });
  });

test("the measurement guard rejects a long label even if clipped", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  const rail = page.getByTestId("tool-rail");
  await expect.poll(() => labelProblems(rail)).toEqual([]);
  const label = page.getByTestId("rail-add").getByTestId("rail-label");
  const text = await label.textContent();
  await label.evaluate((el) => {
    el.textContent = "AnUnreasonablyLongUnbrokenRailLabel".repeat(8);
    el.style.maxHeight = "24px";
    el.style.overflow = "hidden";
  });
  expect(await labelProblems(rail)).not.toEqual([]);
  await label.evaluate((el, text) => {
    el.textContent = text;
    el.style.removeProperty("max-height");
    el.style.removeProperty("overflow");
  }, text);
  await expect.poll(() => labelProblems(rail)).toEqual([]);
});
