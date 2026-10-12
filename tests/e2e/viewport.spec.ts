import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas } from "./fixtures";

// Opening or closing a side panel refits the diagram only while the whole of it is in view (a fit).
// A view the person zoomed or panned, by hand or by command (Shift+0), stays where they put it.
// Timers are driven by the test clock, so the refit (and its animation) has run when we measure.

const KAFKA = "kafka-order-pipeline";
const NODES = ["shopper", "gateway", "orders", "payments", "payment-db", "order-events"];

type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (page: Page, testId: string): Promise<Box> => {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
};
/** Where each node's top-left sits on screen, and its height: these move only with the viewport (a
 * node's width can still settle as its label's font loads). */
const boxes = async (page: Page) =>
  (await Promise.all(NODES.map((id) => boxOf(page, `node-${id}`)))).map((b) => ({
    x: Math.round(b.x),
    y: Math.round(b.y),
    height: Math.round(b.height),
  }));
const settle = (page: Page) => page.clock.runFor(1500);

async function openFitted(page: Page) {
  await page.clock.install();
  await gotoCanvas(page, KAFKA);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await settle(page);
}

async function toggleInspector(page: Page) {
  await page.getByTestId("inspector-toggle").click();
  await settle(page);
}

test.describe("side panels and the camera", () => {
  test("opening a side panel keeps a fitted diagram clear of it", async ({ page }) => {
    await openFitted(page);
    await toggleInspector(page);
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
    const panel = await boxOf(page, "inspector");
    for (const id of NODES) {
      const b = await boxOf(page, `node-${id}`);
      expect(b.x + b.width).toBeLessThanOrEqual(panel.x + 1);
    }
  });

  test("panel toggles keep a viewport zoomed by hand", async ({ page }) => {
    await openFitted(page);
    const pane = await boxOf(page, "canvas-wrap");
    await page.mouse.move(pane.x + pane.width / 3, pane.y + pane.height / 2);
    // Ctrl+wheel zooms (the wheel alone pans).
    await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
    await settle(page);
    const before = await boxes(page);
    await toggleInspector(page);
    expect(await boxes(page)).toEqual(before);
    await toggleInspector(page);
    expect(await boxes(page)).toEqual(before);
  });

  test("panel toggles keep a viewport set by Shift+0 (zoom to 100%)", async ({ page }) => {
    await openFitted(page);
    const fitted = await boxes(page);
    // No click first: pressing on the pane is a (tiny) pan, which would mark the view as the user's anyway.
    await page.keyboard.press("Shift+Digit0");
    await settle(page);
    const zoomed = await boxes(page);
    expect(zoomed[0].height).not.toBe(fitted[0].height);
    await toggleInspector(page);
    expect(await boxes(page)).toEqual(zoomed);
  });
});
