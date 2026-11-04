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
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-source").getAttribute("data-processed")))
      .toBeGreaterThan(0);
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
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText(
    "Requests answered there will no longer reach",
  );
  await expect(page.getByTestId("cache-upgrade-details-body")).not.toBeVisible();
  await expect(page.getByTestId("planning-capacity-changes")).not.toContainText("Unknown");
  await expect(page.getByTestId("planning-upgrade")).toHaveText("Enable caching");
  await page.getByTestId("planning-upgrade").focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w3");
  await expect(page.getByTestId("planning-model-summary")).toBeFocused();
  await expect(page.getByTestId("toast")).toContainText("Enabled caching");
  await page.getByTestId("planning-preview").click();
  await expect(page.getByTestId("planning-legacy-preview")).toContainText(
    "In the older file, every request reaches the origin; cache rules won't run.",
  );
  await expect(page.getByTestId("planning-legacy-preview")).toContainText("Your diagram keeps its current behaviour.");
  await expect(page.getByTestId("planning-legacy-details-body")).not.toBeVisible();
  await page.getByTestId("cache-upgrade-undo").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w2");
  expect((await savedDiagram(page)).nodes[1].props?.cache).toEqual(d.nodes[1].props?.cache);
});
