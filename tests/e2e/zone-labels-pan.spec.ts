import type { Page } from "@playwright/test";
import diagram from "../../src/examples/black-friday-commerce.json" with { type: "json" };
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  viewportTransform,
  waitForCameraIdle,
  waitForStableViewport,
} from "./fixtures";

/** Sample every title and boundary together, before the held gesture can settle. */
async function sample(page: Page) {
  return page.getByTestId("canvas-wrap").evaluate((root) => {
    return [...root.querySelectorAll<HTMLElement>('[data-testid^="zone-focus-"]')].flatMap((chip) => {
      const id = (chip.dataset.testid ?? "").slice("zone-focus-".length);
      const boundary = root.querySelector(`[data-testid="group-${id}"]`);
      if (!boundary) return [];
      const a = chip.getBoundingClientRect();
      const b = boundary.getBoundingClientRect();
      return [{ id, x: b.x, y: b.y, dx: a.x - b.x, dy: a.y - b.y, width: a.width, height: a.height, band: b.width }];
    });
  });
}

for (const live of [false, true])
  test(`zone titles track every frame of a held pan and wheel zoom (${live ? "Live" : "Edit"})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.install();
    if (live) await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&paused=1");
    else await gotoCanvas(page, "black-friday-commerce");
    await waitForCameraIdle(page);
    await page.keyboard.press("Shift+1");
    await waitForCameraIdle(page);
    await expect(page.getByTestId("zone-focus-aws")).toBeVisible();
    await pauseClock(page);
    const before = await sample(page);
    expect(before.map((s) => s.id).sort()).toEqual(diagram.groups.map((g) => g.id).sort());
    for (const value of before) expect(value.height, `${value.id} stays on one line`).toBeCloseTo(18, 1);
    const check = async (zooming = false, reference = before) => {
      const current = await sample(page);
      expect(current).toHaveLength(before.length);
      for (const value of current) {
        const initial = reference.find((s) => s.id === value.id);
        if (!initial) throw new Error(`Missing initial title ${value.id}`);
        // A pan keeps the exact band anchor. Zoom may choose another free place
        // above the boundary as screen-sized ink meets different cards/routes.
        if (!zooming) {
          expect(Math.abs(value.dx - initial.dx), `${value.id} horizontal anchor`).toBeLessThanOrEqual(2);
          expect(Math.abs(value.dy - initial.dy), `${value.id} vertical anchor`).toBeLessThanOrEqual(2);
        }
        expect(value.dy + value.height, `${value.id} above the content`).toBeLessThanOrEqual(-2);
        expect(value.dx + value.width, `${value.id} attached to the top edge`).toBeGreaterThanOrEqual(0);
        expect(value.dx, `${value.id} attached to the top edge`).toBeLessThanOrEqual(value.band);
        expect(Math.abs(value.width - initial.width), `${value.id} readable width`).toBeLessThanOrEqual(1);
        expect(Math.abs(value.height - initial.height), `${value.id} readable height`).toBeLessThanOrEqual(1);
      }
      return current;
    };
    const pane = page.getByTestId("canvas-pane");
    const bounds = await pane.boundingBox();
    if (!bounds) throw new Error("Missing canvas pane");
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(start.x, start.y);
    // Edit reserves the primary button for selection; Live supports drag-to-pan.
    await page.mouse.down({ button: live ? "left" : "middle" });
    try {
      for (let step = 1; step <= 4; step++) {
        await page.mouse.move(start.x + step * 18, start.y + step * 12);
        await page.clock.runFor(16);
        const current = await check();
        expect(Math.abs(current[0].x - before[0].x)).toBeGreaterThan(step * 10);
        expect(Math.abs(current[0].y - before[0].y)).toBeGreaterThan(step * 6);
      }
      const factor = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 0.02 : 0.002));
      for (const target of [0.24, 0.15, 0.75, 0.5]) {
        const zoom = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
        await pane.dispatchEvent("wheel", {
          deltaY: Math.log2(zoom / target) / factor,
          ctrlKey: true,
          clientX: start.x,
          clientY: start.y,
          bubbles: true,
        });
        await page.clock.runFor(16);
        await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-viewport-moving", "");
        expect(Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1])).toBeCloseTo(target, 3);
        await check(true);
      }
    } finally {
      await page.mouse.up({ button: live ? "left" : "middle" });
    }
    await page.clock.resume();
    await waitForCameraIdle(page);
    await check(true);
    await waitForStableViewport(page);
    // A settled tier (chips below 60%) may choose another free band. Panning must keep that anchor too.
    const settled = await sample(page);
    await pane.dispatchEvent("wheel", { deltaX: 24, deltaY: 20, bubbles: true });
    await waitForStableViewport(page);
    await check(false, settled);
    // The portal retains the existing focus action after moving.
    await page.keyboard.press("Shift+1");
    await waitForCameraIdle(page);
    await page
      .getByTestId(/^zone-focus-/)
      .first()
      .click();
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", "focus");
  });
