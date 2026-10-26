import type { Locator } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForCameraIdle } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 } });

test("phone Edit has a bottom rail and a dock with three snap heights", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  const rail = page.getByTestId("tool-rail");
  expect((await requiredBox(rail)).y).toBeGreaterThan(700);
  await page.getByTestId("rail-more").click();
  await page.getByTestId("view-gallery").click();
  await page.getByTestId("view-canvas").click();
  await page.getByTestId("fit-view-button").click();
  await waitForCameraIdle(page);
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("dock-snap-controls")).toBeVisible();
  for (const snap of ["peek", "half", "full"]) {
    await page.getByTestId(`dock-snap-${snap}`).click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-sheet-snap", snap);
  }
});

for (const theme of ["light", "dark"])
  test(`phone Live reserves the canvas and opens its note (${theme})`, async ({ page }) => {
    await page.clock.install();
    await page.addInitScript((theme) => {
      const key = "diagrams.settings.v1";
      localStorage.setItem(
        key,
        JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), themePreference: theme }),
      );
    }, theme);
    await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
    await pauseClock(page);
    const time = page.getByTestId("live-timeline-input");
    await time.fill("159");
    await time.press("ArrowRight");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-follow").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    expect((await requiredBox(page.getByTestId("canvas-wrap"))).height / 844).toBeGreaterThanOrEqual(0.65);
    const strip = await requiredBox(page.getByTestId("live-timeline"));
    const play = await requiredBox(page.getByTestId("live-play"));
    const restart = await requiredBox(page.getByTestId("live-restart"));
    expect(strip.width).toBeGreaterThan(360);
    expect(strip.y).toBeLessThan(play.y);
    expect(play.y).toBeLessThan(restart.y);
    for (const id of [
      "live-play",
      "live-restart",
      "live-sim-picker",
      "live-view-menu",
      "live-expectations-summary",
      "live-more",
      "live-note-expand",
    ]) {
      const box = await requiredBox(page.getByTestId(id));
      expect(box.height, id).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("live-expectations-summary")).toContainText("Expectations");
    const title = page.getByTestId("node-payments").getByTestId("card-title");
    expect(
      await title.evaluate((el) => {
        const cs = getComputedStyle(el);
        return (parseFloat(cs.fontSize) * el.getBoundingClientRect().height) / parseFloat(cs.lineHeight);
      }),
    ).toBeGreaterThanOrEqual(12);
    for (const pin of await page.getByTestId(/^focus-offscreen-/).all()) {
      const box = await requiredBox(pin);
      expect(box.height).toBe(44);
      expect(box.x).toBeGreaterThanOrEqual(8);
    }

    await page.getByTestId("live-note-expand").click();
    await expect(page.getByTestId("live-note")).toHaveAttribute("data-expanded", "1");
    await expect(page.getByTestId("live-note-scrim")).toBeVisible();
    await expect(page.getByTestId("live-note-earlier")).toBeVisible();
    await page.getByTestId("live-note-close").click();
    await expect(page.getByTestId("live-note-scrim")).toHaveCount(0);
    await page.getByTestId("live-note-expand").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-note")).toHaveAttribute("data-expanded", "0");
    await page.getByTestId("live-note-details").click();
    await expect(page.getByTestId("dock-live-identity")).toBeVisible();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-sheet-snap", "half");
    await expect(page.getByTestId("live-view-menu")).toContainText("Following");
    await page.getByTestId("dock-snap-full").click();
    await page.getByTestId("inspector-toggle").click();
    await page.getByTestId("live-note-details").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-sheet-snap", "half");
  });

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected visible element");
  return box;
}
