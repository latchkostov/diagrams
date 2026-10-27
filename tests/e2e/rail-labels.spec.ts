import { readdirSync, readFileSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect, gotoCanvas, waitForChecks } from "./fixtures";
import en from "../../src/i18n/en";
import { format, parse, textOf } from "../../src/i18n/icu";
import { pseudoLocalize } from "../../src/i18n/pseudo";

const codes = readdirSync("src/i18n/locales")
  .filter((file) => file.endsWith(".json") && !file.endsWith(".meta.json"))
  .map((file) => file.slice(0, -5));
const keys = ["select", "add", "annotate", "checks", "stencils", "tutorials", "shortcuts", "ai", "diagram"];

async function expectLabelInName(rail: Locator) {
  const buttons = rail.getByTestId(
    /^(rail-(select|add|annotate)|checks-count|view-(gallery|tutorials|canvas)|shortcuts-button|ai-rail-open)$/,
  );
  for (const button of await buttons.all()) {
    const label = (await button.getByTestId("rail-label").innerText()).trim();
    expect(label).not.toBe("");
    await expect(button).toHaveAccessibleName(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
}

// Measure real glyphs, not just the span: clipping/line-clamping must not conceal a regression.
async function labelProblems(rail: Locator, labels = rail.getByTestId("rail-label")) {
  return labels.evaluateAll(async (labels) => {
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
      if (innerWidth >= 1100 && (box.top < rail.top || box.bottom > rail.bottom || box.bottom > innerHeight))
        problems.push("outside visible rail height");
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

for (const code of ["es", "fr"])
  test(`${code}: short captions retain full accessible names and tooltips`, async ({ page }) => {
    const messages: Record<string, string> = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8"));
    await page.addInitScript((code) => localStorage.setItem("diagrams.locale", code), code);
    await gotoCanvas(page, "retry-storm");
    await waitForChecks(page);
    const badge = page.getByTestId("checks-warning-badge");
    const count = (await badge.count()) ? Number(await badge.innerText()) : 0;
    const warnings = format(messages["workbench.warnings"], code, { count });
    const descriptions = {
      "rail-select": messages["workbench.select"],
      "rail-annotate": messages["menu.annotate"],
      "checks-count": format(messages["workbench.checksName"], code, { warnings }),
      "view-gallery": messages["topbar.stencils"],
      "view-tutorials": messages["tutorials.section"],
      "shortcuts-button": messages["workbench.shortcuts"],
      "ai-rail-open": messages["ai.aIPanel"],
    };
    for (const [id, full] of Object.entries(descriptions)) {
      const button = page.getByTestId(id);
      const label = (await button.getByTestId("rail-label").innerText()).trim();
      await expect(button).toHaveAccessibleName(full.startsWith(label) ? full : `${label}, ${full}`);
      if (id === "ai-rail-open") expect(await button.getAttribute("title")).toContain(full);
      else await expect(button).toHaveAttribute("title", full);
    }
    await expect(page.getByTestId("checks-warning-text")).toHaveText(warnings);
    await page.getByTestId("view-gallery").click();
    const diagram = page.getByTestId("view-canvas");
    const label = messages["rail.diagram"];
    const full = messages["topbar.diagram"];
    await expect(diagram).toHaveAccessibleName(full.startsWith(label) ? full : `${label}, ${full}`);
    await expect(diagram).toHaveAttribute("title", full);
  });

test("short desktop rail keeps every label reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  await gotoCanvas(page, "retry-storm");
  const rail = page.getByTestId("tool-rail");
  for (const gallery of [false, true]) {
    if (gallery) await page.getByTestId("view-gallery").click();
    for (const label of await rail.getByTestId("rail-label").all()) {
      await label.scrollIntoViewIfNeeded();
      await expect.poll(() => labelProblems(rail, label)).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
});

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
        await expectLabelInName(rail);
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
        await expectLabelInName(rail);
      });
  });

test("clicking the Diagram label restores Select focus and the rail tab stop", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-gallery").click();
  await page.getByTestId("view-canvas").getByTestId("rail-label").click();
  await expect(page.getByTestId("rail-select")).toBeEnabled();
  await expect(page.getByTestId("rail-select")).toBeFocused();
  await expect(page.getByTestId("rail-select")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("view-gallery")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-wrap")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
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
