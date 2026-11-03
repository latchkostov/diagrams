import { test, expect, pauseClock, animationFrames } from "./fixtures";
import { holdChunk } from "./chunk";
import { openSurface, surfaceChunk } from "./lazy-surface-helpers";

test("a cache run waits for its runtime before creating a controller", async ({ page }) => {
  await page.clock.install();
  const held = await holdChunk(page, surfaceChunk("live.cache"));
  try {
    await openSurface(page, "live.cache");
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("live.cache-loading")).toBeVisible();
    await animationFrames(page);
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    held.release();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(2000);
    await expect(page.getByTestId("live-clock")).not.toHaveAttribute("data-ms", "0");
  } finally {
    held.release();
  }
});
