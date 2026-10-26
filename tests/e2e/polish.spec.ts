import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  viewportTransform,
  waitForStableViewport,
  gotoLive,
  pageLoadTimeout,
  cameraJournal,
  cameraJournalMark,
  interactionJournal,
  interactionJournalMark,
  waitForCameraIdle,
  waitForSelectionSettled,
} from "./fixtures";

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

/**
 * Distinct viewport transforms after clicking `testId`: from the first frame the view moves, over the 20 frames
 * after it (2 = it jumped, more = it animated). Counted in frames, not over a span of wall time, so a busy machine
 * (fewer frames a second, a late first move) doesn't change the answer.
 */
async function transformsAfter(page: Page, testId: string) {
  return page.getByTestId("canvas-wrap").evaluate(async (wrap, id) => {
    const viewport = wrap.querySelector<HTMLElement>(".react-flow__viewport");
    const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!viewport || !button) throw new Error("missing viewport or button");
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const before = viewport.style.transform;
    const seen = new Set([before]);
    button.click();
    for (let i = 0; i < 300 && viewport.style.transform === before; i++) await frame();
    for (let i = 0; i < 20; i++) {
      seen.add(viewport.style.transform);
      await frame();
    }
    seen.add(viewport.style.transform);
    return seen.size;
  }, testId);
}

async function panAway(page: Page) {
  // The opening fit must land first: a fit that finishes after the drag would undo it.
  await waitForStableViewport(page);
  const fitted = await viewportTransform(page);
  const wrap = await box(page.getByTestId("canvas-wrap"));
  // The top strip of the pane is empty after a fit (it keeps clear of the title card).
  // Middle-drag: a plain drag on the empty canvas draws a selection box.
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + 70);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(wrap.x + wrap.width / 2 - 260, wrap.y + 140, { steps: 6 });
  await page.mouse.up({ button: "middle" });
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
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
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
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
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
    expect(await transformsAfter(page, "fit-view-button")).toBe(2);
  });

  test("collapsed toolbar skips every hidden control and expansion restores zoom", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await waitForCameraIdle(page);
    const collapse = page.getByTestId("collapse-toolbar-button");
    const tools = [
      "fit-view-button",
      "view-focus",
      "zoom-out-button",
      "zoom-100",
      "zoom-in-button",
      "view-tools-menu-button",
    ];
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    const before = await viewportTransform(page);
    // Inert tools cannot receive focus even when explicitly asked. Enter cannot activate hidden zoom.
    for (const id of tools) {
      await page.getByTestId("canvas-wrap").focus();
      const tool = page.getByTestId(id);
      if (await tool.count()) await tool.evaluate((el: HTMLElement) => el.focus());
      await expect(page.getByTestId("canvas-wrap")).toBeFocused();
      if (id.startsWith("zoom-")) await page.keyboard.press("Enter");
    }
    expect(await viewportTransform(page)).toBe(before);
    for (const key of ["Tab", "Shift+Tab"]) {
      await collapse.focus();
      // Cross both ends of the toolbar: no collapsed tool is a hidden stop in either direction.
      for (let i = 0; i < tools.length + 1; i++) {
        await page.keyboard.press(key);
        const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
        expect(tools).not.toContain(focused);
      }
    }
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("zoom-out-button").click();
    await expect.poll(() => viewportTransform(page)).not.toBe(before);
    await waitForStableViewport(page);
    await collapse.click();
    await page.reload();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
  });

  test("Fit view flyout applies both camera commands and has a separate accessible target", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await waitForCameraIdle(page);
    const trigger = page.getByTestId("view-tools-menu-button");
    const fit = page.getByTestId("fit-view-button");
    const target = await box(trigger);
    expect(target.width).toBeGreaterThanOrEqual(24);
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(overlaps(target, await box(fit))).toBe(false);
    await expect(page.getByTestId("toolbar-divider-collapse")).toBeVisible();
    await expect(page.getByTestId("topbar").getByTestId("undo-button")).toBeVisible();
    await expect(page.getByTestId("topbar").getByTestId("redo-button")).toBeVisible();
    await expect(page.getByTestId("tool-rail").getByTestId("shortcuts-button")).toBeVisible();
    const menu = page.getByTestId("view-tools-menu");
    const zoom100 = page.getByTestId("context-menu-item-toolbar-view:zoom-100");
    const zoomSelection = page.getByTestId("context-menu-item-toolbar-view:zoom-selection");
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "menu-open");
    await expect(zoomSelection).toHaveAttribute("aria-disabled", "true");
    await expect(zoomSelection).toHaveAttribute("title", "Select something first");
    let mark = await cameraJournalMark(page);
    await zoom100.click();
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await cameraJournal(page, mark)).map((e) => e.command)).toContain("zoom100");
    await waitForCameraIdle(page);
    expect(await viewportTransform(page)).toMatch(/scale\(1\)/);
    // Fit again before clicking a node: 100% can put it beyond the pane.
    await fit.click();
    await waitForCameraIdle(page);
    const selected = page.getByTestId("node-dashboard");
    await selected.click();
    await waitForSelectionSettled(page);
    await trigger.click();
    await expect(zoomSelection).not.toHaveAttribute("aria-disabled", "true");
    mark = await cameraJournalMark(page);
    await zoomSelection.click();
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await cameraJournal(page, mark)).map((e) => e.command)).toContain("zoomToSelection");
    await waitForCameraIdle(page);
    const pane = await box(page.getByTestId("canvas-wrap"));
    const content = await box(selected);
    expect(content.x).toBeGreaterThanOrEqual(pane.x);
    expect(content.y).toBeGreaterThanOrEqual(pane.y);
    expect(content.x + content.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(content.y + content.height).toBeLessThanOrEqual(pane.y + pane.height);
    await trigger.click();
    await fit.click();
    await expect(menu).toBeHidden();
    await waitForCameraIdle(page);
    // Keyboard dismissal is owned by the interaction controller and restores the flyout trigger.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    const focusMark = await interactionJournalMark(page);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect((await interactionJournal(page, focusMark)).map((e) => e.event)).toContain("menu.closed:escape");
    await trigger.click();
    await trigger.click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.getByTestId("collapse-toolbar-button").click();
    await expect(menu).toBeHidden();
    await page.getByTestId("collapse-toolbar-button").click();
    await page.getByTestId("shortcuts-button").click();
    await expect(page.getByTestId("shortcut-zoom-100")).toContainText("Zoom to 100%");
    await expect(page.getByTestId("shortcut-zoom-100")).toContainText("0");
    await expect(page.getByTestId("shortcut-zoom-selection")).toContainText("Zoom to selection");
    await expect(page.getByTestId("shortcut-zoom-selection")).toContainText("2");
  });

  test("React Flow's credit stays visible, clear of the live bar and the first-run hint", async ({ page }) => {
    test.slow(); // Two cold canvas and live-session loads.
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoCanvas(page, KAFKA);
      const credit = page.getByTestId("canvas-attribution");
      await expect(credit).toBeVisible();
      const hint = page.getByTestId("first-run-hint");
      if (await hint.count()) expect(overlaps(await box(credit), await box(hint))).toBe(false);
      await page.keyboard.press("l");
      await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(credit).toBeVisible();
      expect(overlaps(await box(credit), await box(page.getByTestId("live-controls")))).toBe(false);
      const minimap = page.getByTestId("canvas-minimap");
      if (await minimap.isVisible()) expect(overlaps(await box(credit), await box(minimap))).toBe(false);
    }
  });

  test("Continuous traffic has one icon in the live menu and the right-click menu", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
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
