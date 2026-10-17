import { currentDiagram, savedDiagram } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { customColoursFixture } from "../../src/lab/customColoursFixture";
import { test, expect, gotoCanvas, gotoLab, waitForStableViewport, STORAGE_KEYS, expectNoErrors } from "./fixtures";

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const MOD = "ControlOrMeta";

async function seed(page: Page, theme = "light") {
  await page.addInitScript(
    ([key, diagram, theme]) => {
      if (!sessionStorage.getItem("colour-seeded")) {
        localStorage.setItem(key, diagram);
        sessionStorage.setItem("colour-seeded", "1");
      }
      localStorage.setItem("diagrams.theme", theme);
    },
    [KEY, JSON.stringify(customColoursFixture), theme],
  );
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
}

async function colours(page: Page) {
  const d = await savedDiagram(page);
  return {
    color: d.color,
    annotations: d.annotations?.map((a) => [a.id, a.color]).sort(([a], [b]) => (a ?? "").localeCompare(b ?? "")),
  };
}

async function dismiss(page: Page, how: string) {
  if (how === "Escape") await page.keyboard.press("Escape");
  else if (how === "outside") await page.getByTestId("color-picker-backdrop").click({ position: { x: 4, y: 4 } });
  else await page.getByTestId("color-picker-close").click();
  await expect(page.getByTestId("color-picker-modal")).toHaveCount(0);
}

for (const how of ["Escape", "outside", "close"]) {
  test(`dismissing an untouched mixed-color picker preserves each annotation: ${how}`, async ({ page }) => {
    await seed(page);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.getByTestId("inspector-color-custom-btn")).toBeVisible();
    const before = await colours(page);
    await page.getByTestId("inspector-color-custom-btn").click();
    await expect(page.getByTestId("color-picker-hex-input")).toBeFocused();
    if (how === "Escape") await page.screenshot({ path: test.info().outputPath("colour-picker.png") });
    await dismiss(page, how);
    await expect(page.getByTestId("inspector-color-custom-btn")).toBeFocused();
    expect(await colours(page)).toEqual(before);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
  });

  test(`dismissing the background picker preserves an unset color: ${how}`, async ({ page }) => {
    await seed(page);
    await page.getByTestId("inspector-toggle").click();
    const before = await colours(page);
    await page.getByTestId("inspector-diagram-color-custom-btn").click();
    await dismiss(page, how);
    expect(await colours(page)).toEqual(before);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
  });
}

test("picking, hash-prefixed hex and resetting a mixed selection each undo in one step", async ({
  page,
  consoleErrors,
}) => {
  await seed(page);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press(`${MOD}+a`);
  const before = await colours(page);
  await page.getByTestId("inspector-color-custom-btn").click();
  await page.getByTestId("color-swatch-spectrum-#EF4444").click();
  await page.getByTestId("color-picker-hex-input").fill("#ABC");
  await page.getByTestId("color-picker-hex-input").fill("#ABCDEF80");
  await page.getByTestId("color-picker-close").click();
  await expect
    .poll(() => colours(page))
    .toEqual({
      color: undefined,
      annotations: customColoursFixture.annotations
        .map((a): [string, string] => [a.id, "#ABCDEF80"])
        .sort(([a], [b]) => a.localeCompare(b)),
    });
  await page.getByTestId("undo-button").click();
  await expect.poll(() => colours(page)).toEqual(before);
  await page.getByTestId("inspector-color-custom-btn").click();
  await page.getByTestId("color-picker-reset").click();
  await expect
    .poll(() => colours(page))
    .toEqual({
      color: undefined,
      annotations: customColoursFixture.annotations
        .map((a): [string, undefined] => [a.id, undefined])
        .sort(([a], [b]) => a.localeCompare(b)),
    });
  await page.getByTestId("undo-button").click();
  await expect.poll(() => colours(page)).toEqual(before);
  expectNoErrors(consoleErrors);
});

test("blur and close emit no redundant colour writes, and dialog contains keyboard focus", async ({ page }) => {
  await gotoLab(page, "colour-picker");
  await page.getByTestId("colour-lab-open").click();
  await page.getByTestId("color-picker-hex-input").fill("ABCDEF80");
  await expect(page.getByTestId("colour-lab-writes")).toHaveText("1");
  await page.getByTestId("color-picker-close").focus();
  await expect(page.getByTestId("colour-lab-writes")).toHaveText("1");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("color-swatch-spectrum-#831843")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("color-picker-close")).toBeFocused();
  const suppressed = await page
    .getByTestId("color-picker-modal")
    .evaluate((el) => !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(suppressed).toBe(true);
  await page.getByTestId("color-picker-close").click();
  await expect(page.getByTestId("colour-lab-open")).toBeFocused();
  await expect(page.getByTestId("colour-lab-writes")).toHaveText("1");
  await page.getByTestId("colour-lab-open").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("colour-lab-writes")).toHaveText("1");
});

for (const theme of ["light", "dark"]) {
  test(`background tint is undoable and survives presentation in ${theme}`, async ({ page, consoleErrors }) => {
    await seed(page, theme);
    const canvas = page.getByTestId("canvas-wrap");
    const background = () => canvas.evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = await background();
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("inspector-diagram-color-custom-btn").click();
    await page.getByTestId("color-picker-hex-input").fill("#FF000080");
    await page.keyboard.press("Enter");
    await expect.poll(background).not.toBe(before);
    const tinted = await background();
    await page.getByTestId("undo-button").click();
    await expect.poll(background).toBe(before);
    await page.getByTestId("redo-button").click();
    await expect.poll(background).toBe(tinted);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.goto(`./?view=canvas&example=${await currentDiagram(page)}&present=1`);
    await expect(canvas).toBeVisible();
    await expect.poll(background).toBe(tinted);
    expectNoErrors(consoleErrors);
  });
}

for (const theme of ["light", "dark"]) {
  test(`custom caption ink has AA contrast for extreme tints in ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await page.getByTestId("annotation-text1").click();
    await page.getByTestId("inspector-color-custom-btn").click();
    for (const hex of ["#FFFFFF", "#000000", "#FFFFFF00", "#0000"]) {
      await page.getByTestId("color-picker-hex-input").fill(hex.slice(1));
      const contrast = await page.getByTestId("annotation-text-text1").evaluate((el) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No colour canvas context");
        function luminance(color: string) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
        }
        const fg = luminance(getComputedStyle(el).color);
        const wrap = document.querySelector('[data-testid="canvas-wrap"]');
        if (!wrap) throw new Error("No canvas wrapper");
        const bg = luminance(getComputedStyle(wrap).backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const locale of ["ar", "en-XA"]) {
  test(`picker labels and short viewport layout in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await gotoLab(page, "colour-picker");
    await page.getByTestId("colour-lab-open").click();
    const modal = page.getByTestId("color-picker-modal");
    const hex = page.getByTestId("color-picker-hex-input");
    if (locale === "ar") {
      const catalog = JSON.parse(readFileSync("src/i18n/locales/ar.json", "utf8"));
      await expect(hex).toHaveAttribute("aria-label", catalog["chrome.hexColour"]);
      await expect(page.getByTestId("color-picker-reset")).toHaveAttribute("title", catalog["chrome.resetColour"]);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    } else {
      await expect(hex).toHaveAttribute("aria-label", /^\[/);
      await expect(modal).toHaveAttribute("aria-label", /^\[/);
    }
    const box = await modal.boundingBox();
    if (!box) throw new Error("No picker box");
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(480);
    await page.getByTestId("color-swatch-spectrum-#831843").click();
    await expect(page.getByTestId("colour-lab-value")).toHaveText("#831843");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("colour-lab-open")).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`colour-lab-${locale}.png`) });
  });
}
