import { test, expect, gotoCanvas } from "./fixtures";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const STENCILS = chunk("Palette", "src/canvas/Palette.tsx");

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
