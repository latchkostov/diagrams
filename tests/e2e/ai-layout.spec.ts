import { waitForStableViewport } from "./fixtures";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas } from "./fixtures";
import { SLUG, callTool, installFakeModelContext, must, openAdvanced, settle, toolNames } from "./ai-helpers";

// Nothing overlaps by default: toasts stack above the canvas's bottom bars, the first-run hint never cuts
// a word, and opening, closing or resizing the AI panel keeps the diagram in view.

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const box = async (page: Page, testId: string) => must(await page.getByTestId(testId).boundingBox(), testId);

/** Every node box lies inside the canvas (1 px of rounding). */
async function allNodesInView(page: Page) {
  const wrap = await box(page, "canvas-wrap");
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-)/);
  const n = await nodes.count();
  for (let i = 0; i < n; i++) {
    const b = await nodes.nth(i).boundingBox();
    if (!b) continue;
    if (b.x < wrap.x - 1 || b.y < wrap.y - 1 || b.x + b.width > wrap.x + wrap.width + 1) return false;
    if (b.y + b.height > wrap.y + wrap.height + 1) return false;
  }
  return n > 0;
}

/** The hint's words all fit: no part of it is clipped or scrolled. */
const hintFits = (page: Page) =>
  page
    .getByTestId("first-run-hint")
    .evaluate((el) => [el, ...el.children].every((c) => c.scrollWidth <= c.clientWidth + 1));

/** A toast from Copy for AI on a node (a right-click, so not while the first-run hint should stay). */
async function showToast(page: Page) {
  // Entering live view fits the diagram with an animation: a right-click during it can miss the moving
  // node, or the fit can close the menu before the item is chosen. Wait for the fit before opening the menu.
  await waitForStableViewport(page);
  await page.getByTestId("node-payments").click({ button: "right" });
  await page.getByTestId("context-menu-item-item.copy-for-ai").click();
  await expect(page.getByTestId("toast")).toBeVisible();
}

for (const width of [1024, 1440]) {
  test(`at ${width}px a toast never covers the hint or the live bar, and the hint never clips`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("first-run-hint")).toBeVisible();
    expect(await hintFits(page)).toBe(true);

    await openAdvanced(page);
    await settle(page);
    await expect.poll(() => hintFits(page)).toBe(true);
    // An agent's change while the panel is folded: its toast (with Undo) stacks above the hint.
    await page.getByTestId("ai-collapse").click();
    await expect.poll(async () => (await toolNames(page)).length).toBe(7);
    await callTool(page, "edit_diagram", { ops: [{ op: "add_node", kind: "Redis cache", label: "cache" }] });
    await expect(page.getByTestId("toast")).toBeVisible();
    await expect.poll(async () => apart(await box(page, "toast"), await box(page, "first-run-hint"))).toBe(true);

    // Live view: the toast stacks above the live bar.
    await page.getByTestId("toast-dismiss").click();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await showToast(page);
    await expect.poll(async () => apart(await box(page, "toast"), await box(page, "live-controls"))).toBe(true);
  });
}

test("the hint keeps whole words on a narrow pane (one hint, then wrapping)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("first-run-hint")).toBeVisible();
  // The widest dock leaves the narrowest pane.
  await openAdvanced(page);
  for (let i = 0; i < 10; i++) await page.getByTestId("ai-resize").press("ArrowLeft");
  await expect.poll(() => hintFits(page)).toBe(true);
  await expect(page.getByTestId("first-run-hint")).toContainText("Go live");
});

test("opening, closing and resizing the dock refits the diagram at 1024", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoCanvas(page, SLUG);
  await settle(page);
  expect(await allNodesInView(page)).toBe(true);

  await openAdvanced(page);
  await settle(page);
  await expect.poll(() => allNodesInView(page)).toBe(true);

  for (let i = 0; i < 4; i++) await page.getByTestId("ai-resize").press("ArrowLeft");
  await settle(page);
  await expect.poll(() => allNodesInView(page)).toBe(true);

  await page.getByTestId("ai-collapse").click();
  await settle(page);
  await expect.poll(() => allNodesInView(page)).toBe(true);
});

test("after a pan by hand, opening the dock keeps the selection in view instead of refitting", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoCanvas(page, SLUG);
  await settle(page);
  // Pan the view (middle-drag the empty pane) so the right of the diagram sits near the right edge.
  const wrap = await box(page, "canvas-wrap");
  await page.mouse.move(wrap.x + 200, wrap.y + wrap.height - 120);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(wrap.x + 330, wrap.y + wrap.height - 120, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await settle(page);
  const before = await box(page, "node-payments");
  await page.getByTestId("node-notifications").click();
  await openAdvanced(page);
  await settle(page);
  const sel = await box(page, "node-notifications");
  const pane = await box(page, "canvas-wrap");
  expect(sel.x).toBeGreaterThanOrEqual(pane.x);
  expect(sel.x + sel.width).toBeLessThanOrEqual(pane.x + pane.width);
  // A pan, not a refit: the zoom stayed (node sizes unchanged).
  const after = await box(page, "node-payments");
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
});
