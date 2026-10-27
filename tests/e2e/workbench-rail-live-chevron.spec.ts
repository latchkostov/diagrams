import { readFileSync } from "node:fs";
import { test, expect, gotoCanvas, openLibrary } from "./fixtures";
import en from "../../src/i18n/en";
import { pseudoLocalize } from "../../src/i18n/pseudo";
import { parse, textOf } from "../../src/i18n/icu";

const catalog = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8"));

test("Live closes the Add flyout and disables editing tools until Back to editing", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await openLibrary(page);
  await expect(page.getByTestId("palette-search")).toBeVisible();
  // Use the shortcut while the library is open: an outside click would close it by itself.
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("l");
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
  for (const [id, hint] of [
    ["rail-add", "Back to editing to add parts"],
    ["rail-annotate", "Back to editing to add notes"],
  ]) {
    const button = page.getByTestId(id);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", hint);
    await expect(button).toHaveAccessibleDescription(hint);
    await expect(button).toHaveAttribute("tabindex", "-1");
  }
  await page.getByTestId("rail-select").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("view-gallery")).toBeFocused();
  await page.getByTestId("mode-edit").click();
  await expect(page.getByTestId("rail-add")).toBeEnabled();
  await expect(page.getByTestId("rail-annotate")).toBeEnabled();
  await openLibrary(page);
  await expect(page.getByTestId("palette-search")).toBeVisible();
});

for (const locale of ["en", "ar", "en-XA"]) {
  test(`rail editing hints and zoom actions translate and mirror in ${locale}`, async ({ page }) => {
    await page.addInitScript((code) => localStorage.setItem("diagrams.locale", code), locale);
    await gotoCanvas(page, "kafka-order-pipeline");
    const messages = locale === "ar" ? catalog("ar") : en;
    const translated = (key: keyof typeof en) =>
      locale === "en-XA" ? textOf(pseudoLocalize(parse(en[key]))) : messages[key];
    const button = page.getByTestId("collapse-toolbar-button");
    const chevron = page.getByTestId("zoom-controls-chevron");
    const glyph = () => chevron.evaluate((el) => el.firstElementChild?.firstElementChild?.getAttribute("d"));
    const mirrored = locale === "ar" ? "matrix(-1, 0, 0, 1, 0, 0)" : "none";
    await expect(page.getByTestId("canvas-controls")).toHaveCSS("direction", locale === "ar" ? "rtl" : "ltr");
    const toggleBox = await button.boundingBox();
    const zoomBox = await page.getByTestId("zoom-in-button").boundingBox();
    if (!toggleBox || !zoomBox) throw new Error("Missing zoom controls");
    expect(toggleBox.x < zoomBox.x).toBe(locale === "ar");
    await expect(button).toHaveAttribute("aria-label", translated("chrome.hideZoomControls"));
    await expect(button).toHaveAttribute("title", translated("chrome.hideZoomControls"));
    expect(await glyph()).toBe("M3.5 4 7.5 8l-4 4M8.5 4l4 4-4 4");
    await expect(chevron).toHaveCSS("transform", mirrored);
    await button.click();
    await expect(button).toHaveAttribute("aria-label", translated("chrome.showZoomControls"));
    await expect(button).toHaveAttribute("title", translated("chrome.showZoomControls"));
    expect(await glyph()).toBe("M7.5 4 3.5 8l4 4M12.5 4l-4 4 4 4");
    await expect(chevron).toHaveCSS("transform", mirrored);
    await button.click();
    await expect(page.getByTestId("zoom-in-button")).toBeVisible();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    for (const [id, hint] of [
      ["rail-add", translated("workbench.addInLive")],
      ["rail-annotate", translated("workbench.annotateInLive")],
    ]) {
      await expect(page.getByTestId(id)).toBeDisabled();
      await expect(page.getByTestId(id)).toHaveAttribute("title", hint);
      await expect(page.getByTestId(id)).toHaveAccessibleDescription(hint);
    }
  });
}
