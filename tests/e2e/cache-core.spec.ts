import { test, expect, pauseClock, animationFrames, gotoCanvas, savedDiagram, STORAGE_KEYS } from "./fixtures";
import { cacheFixture } from "../../src/lab/cacheFixture";
import { holdChunk } from "./chunk";
import { openSurface, surfaceChunk } from "./lazy-surface-helpers";

test("a cache run waits for its runtime before creating a controller", async ({ page }) => {
  await page.clock.install();
  const held = await holdChunk(page, surfaceChunk("live.cache"));
  try {
    await openSurface(page, "live.cache");
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("live.cache-loading")).toHaveAttribute("aria-busy", "true");
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["live.cache"]))
      .toEqual({ state: "loading", active: true });
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

test("W3 preview names storing caches and upgrades in one undo step", async ({ page }) => {
  const d = cacheFixture();
  d.planning = { ...d.planning, revision: "p3-w2" };
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    diagram: d,
  });
  await gotoCanvas(page, "blocking-call");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("cache-upgrade-preview").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("Edge cache");
  await page.getByTestId("planning-upgrade").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w3");
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w2");
  expect((await savedDiagram(page)).nodes[1].props?.cache).toEqual(d.nodes[1].props?.cache);
});
