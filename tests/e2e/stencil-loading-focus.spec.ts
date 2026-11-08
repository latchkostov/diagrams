import { test, expect, gotoCanvas } from "./fixtures";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const STENCILS = chunk("Palette", "src/canvas/Palette.tsx");

for (const owner of ["palette-toggle", "palette-search", "file-button"]) {
  test(`the held library preserves ${owner} ownership when its chunk arrives`, async ({ page }) => {
    const held = await holdChunk(page, STENCILS);
    try {
      await gotoCanvas(page, "kafka-order-pipeline");
      await page.getByTestId("rail-add").click();
      await expect.poll(held.requested).toBe(true);
      await expect(page.getByTestId("palette-loading")).toBeVisible();
      await page.getByTestId("palette-search").fill("redis");
      const control = page.getByTestId(owner);
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).not.toHaveCSS("cursor", "progress");
      // Stencils are screen-only: holding their chunk must not hold a visual export.
      expect(await page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBe(0);
      await releaseAndEvaluate(page, STENCILS, held.release);
      await expect(page.getByTestId("palette-loading")).toHaveCount(0);
      await expect(control).toBeFocused();
      await expect(page.getByTestId("palette-search")).toHaveValue("redis");
      await expect(control).not.toHaveCSS("cursor", "progress");
      expect(await page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBe(0);
      if (owner === "palette-toggle") {
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
      }
    } finally {
      held.release();
    }
  });
}

test("a loading library keeps the command palette's return target when its chunk arrives", async ({ page }) => {
  const held = await holdChunk(page, STENCILS);
  try {
    await page.addInitScript(() => {
      const key = "diagrams.settings.v1";
      localStorage.setItem(
        key,
        JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), libraryPinned: true }),
      );
    });
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect.poll(held.requested).toBe(true);
    const search = page.getByTestId("palette-search");
    await search.focus();
    await search.fill("redis");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-input")).toBeFocused();
    await releaseAndEvaluate(page, STENCILS, held.release);
    await expect(page.getByTestId("command-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-input")).toHaveCount(0);
    await expect(page.getByTestId("palette-loading")).toHaveCount(0);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("redis");
    await search.press("x");
    await expect(search).toHaveValue("redisx");
  } finally {
    held.release();
  }
});
