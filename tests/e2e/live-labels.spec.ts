import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, livePaint } from "./fixtures";

// While live, edge label pills sit above the particles: busy edges stay readable. A dot passing
// behind a pill is drawn dimmed on the overlay canvas, never at full strength over the text.
//
// The particle canvas ignores the pointer, so elementFromPoint can't see it; instead this compares
// pixels. With the simulation paused while the particle canvas has paint under a pill, the pill
// must look exactly the same with that canvas hidden. (The canvas is usually drawn in a worker, so
// its pixels are read through the renderer: `livePaint`.)

const SLUG = "kafka-order-pipeline";
const EDGE = "shopper-to-gateway"; // "HTTPS": the entry edge, always busy

/** Opaque particle-canvas pixels under the pill's rect. */
async function paintUnderPill(page: Page): Promise<number> {
  const pill = await page.getByTestId(`edge-label-${EDGE}`).boundingBox();
  return pill ? livePaint(page, "base", pill) : 0;
}

/** The pill's inside (clear of its anti-aliased border and shadow), as PNG bytes. */
async function pillShot(page: Page): Promise<Buffer> {
  const box = await page.getByTestId(`edge-label-${EDGE}`).boundingBox();
  if (!box) throw new Error("no pill");
  const inset = 3;
  return page.screenshot({
    clip: { x: box.x + inset, y: box.y + inset, width: box.width - 2 * inset, height: box.height - 2 * inset },
    animations: "disabled",
  });
}

test("edge label pills stay on top of the particles while live", async ({ page, consoleErrors }, testInfo) => {
  await page.goto(`./?view=canvas&example=${SLUG}&live=1`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId(`edge-label-${EDGE}`)).toBeVisible();
  const play = page.getByTestId("live-play");

  // Pause at a moment when the particle canvas has paint (a dot's trail or glow) under the pill.
  let found = false;
  for (let attempt = 0; attempt < 30 && !found; attempt++) {
    await page.waitForTimeout(150);
    await play.click();
    found = (await paintUnderPill(page)) > 0;
    if (!found) await play.click();
  }
  expect(found, "no particle passed under the label while sampling").toBe(true);

  // The overlay (dimmed dots over the pill) is out of scope here: hide it for both shots, so the only
  // difference left would be the particle canvas painting over the pill.
  await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('[data-testid="live-canvas-over"]');
    if (overlay) overlay.style.visibility = "hidden";
  });
  // Under load, fonts can still be swapping in: wait until the pill looks the same twice in a row.
  await page.evaluate(() => document.fonts.ready);
  let withParticles = await pillShot(page);
  for (let i = 0; i < 10; i++) {
    const again = await pillShot(page);
    if (again.equals(withParticles)) break;
    withParticles = again;
  }
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="live-canvas"]');
    if (canvas) canvas.style.visibility = "hidden";
  });
  const without = await pillShot(page);
  if (!withParticles.equals(without)) {
    await testInfo.attach("pill-with-particles", { body: withParticles, contentType: "image/png" });
    await testInfo.attach("pill-without-particles", { body: without, contentType: "image/png" });
  }
  expect(withParticles.equals(without), "the particle canvas draws over the label pill").toBe(true);
  expectNoErrors(consoleErrors);
});
