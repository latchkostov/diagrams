import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, viewportTransform, waitForStableViewport } from "./fixtures";

// Polish and reliability: the selection stays in view when the inspector opens, the live bar
// names the simulation being edited, edge labels sit under particles while live, viewport
// animations respect reduced motion, and React Flow's credit never sits under the live bar or hint.

const KAFKA = "kafka-order-pipeline";
const SIM = "black-friday";

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
};
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Distinct viewport transforms seen over half a second after `act` (1 or 2 = it jumped, more = it animated). */
async function transformsAfter(page: Page, testId: string) {
  return page.getByTestId("canvas-wrap").evaluate(async (wrap, id) => {
    const viewport = wrap.querySelector<HTMLElement>(".react-flow__viewport");
    const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!viewport || !button) throw new Error("missing viewport or button");
    const seen = new Set([viewport.style.transform]);
    button.click();
    const end = performance.now() + 500;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      seen.add(viewport.style.transform);
    }
    return seen.size;
  }, testId);
}

async function panAway(page: Page) {
  // The opening fit must land first: a fit that finishes after the drag would undo it.
  await waitForStableViewport(page);
  const fitted = await viewportTransform(page);
  const wrap = await box(page.getByTestId("canvas-wrap"));
  // The top strip of the pane is empty after a fit (it keeps clear of the title card).
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + 70);
  await page.mouse.down();
  await page.mouse.move(wrap.x + wrap.width / 2 - 260, wrap.y + 140, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => viewportTransform(page)).not.toBe(fitted);
  await waitForStableViewport(page);
}

test.describe("polish", () => {
  test("opening the inspector on a selection keeps the selection in view", async ({ page }) => {
    // 1440px: below 1680 the inspector waits for a selection, then narrows the canvas.
    await gotoCanvas(page, KAFKA);
    const node = page.getByTestId("node-dashboard"); // the rightmost column
    await expect(node).toBeVisible();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    const wrapBefore = await box(page.getByTestId("canvas-wrap"));
    const before = await box(node);
    // Precondition: the inspector's extra width would cover it.
    expect(before.x + before.width).toBeGreaterThan(wrapBefore.x + wrapBefore.width - 244);
    await node.click();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
    await expect
      .poll(async () => {
        const wrap = await box(page.getByTestId("canvas-wrap"));
        const b = await box(node);
        return b.x >= wrap.x && b.x + b.width <= wrap.x + wrap.width;
      })
      .toBe(true);
  });

  test("the live bar shows the simulation open in the editor, not free play", async ({ page }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await expect(page.getByTestId("live-sim-picker")).toHaveValue("");
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await page.getByTestId(`sim-panel-edit-${SIM}`).click();
    await expect(page.getByTestId("sim-panel-title")).toBeVisible();
    await expect(page.getByTestId("live-sim-picker")).toHaveValue(SIM);
    // Its timeline section says what it is.
    await expect(page.getByTestId("sim-panel-section-timeline-toggle")).toContainText("Timeline");
  });

  test("edge labels draw above particles and below badges while live", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    const z = () =>
      page.getByTestId("canvas-wrap").evaluate((el) => {
        const of = (e: Element | null) => (e ? getComputedStyle(e).zIndex : "missing");
        return {
          labels: of(el.querySelector(".react-flow__edgelabel-renderer")),
          particles: of(el.querySelector('[data-testid="live-canvas"]')),
          overlay: of(el.querySelector('[data-testid="live-canvas-over"]')),
          badges: of(el.querySelector(".lv-badges")),
        };
      });
    // Editing: labels stay on top (a hovered, truncated label reads in full).
    expect((await z()).labels).toBe("1001");
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-canvas")).toBeAttached();
    // Live, in one stacking context: particles, then label pills (readable on busy edges), then the
    // overlay (dimmed dots behind a pill, the traced message), then the metric badges.
    expect(await z()).toEqual({ labels: "1", particles: "auto", overlay: "2", badges: "3" });
  });

  test("viewport animations respect prefers-reduced-motion", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await panAway(page);
    expect(await transformsAfter(page, "fit-view-button")).toBeGreaterThan(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await panAway(page);
    expect(await transformsAfter(page, "fit-view-button")).toBeLessThanOrEqual(2);
  });

  test("React Flow's credit stays visible, clear of the live bar and the first-run hint", async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoCanvas(page, KAFKA);
      const credit = page.getByTestId("canvas-attribution");
      await expect(credit).toBeVisible();
      const hint = page.getByTestId("first-run-hint");
      if (await hint.count()) expect(overlaps(await box(credit), await box(hint))).toBe(false);
      await page.keyboard.press("l");
      await expect(page.getByTestId("live-controls")).toBeVisible();
      await expect(credit).toBeVisible();
      expect(overlaps(await box(credit), await box(page.getByTestId("live-controls")))).toBe(false);
      const minimap = page.getByTestId("canvas-minimap");
      if (await minimap.isVisible()) expect(overlaps(await box(credit), await box(minimap))).toBe(false);
    }
  });

  test("Continuous traffic has one icon in the live menu and the right-click menu", async ({ page }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await page.getByTestId("live-more").click();
    const fromBar = await page
      .getByTestId("live-traffic")
      .evaluate((el) => el.querySelector("path")?.getAttribute("d"));
    await page.keyboard.press("Escape");
    const wrap = await box(page.getByTestId("canvas-wrap"));
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: wrap.width / 2, y: 70 } });
    const item = page.getByTestId("context-menu-item-sim.traffic");
    await expect(item).toBeVisible();
    const fromMenu = await item.evaluate((el) => el.querySelector("path")?.getAttribute("d"));
    expect(fromBar).toBeTruthy();
    expect(fromMenu).toBe(fromBar);
  });
});
