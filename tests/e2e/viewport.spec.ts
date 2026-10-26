import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  STORAGE_KEYS,
  viewportTransform,
  waitForStableViewport,
  waitForCameraIdle,
} from "./fixtures";

// Opening or closing a side panel refits the diagram only while the whole of it is in view (a fit).
// A manually zoomed view whose diagram centre stays in the pane keeps its position.
// The policy tests cover R6's separate off-pane centring rule.
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
  await waitForCameraIdle(page);
}

async function toggleInspector(page: Page) {
  await page.getByTestId("inspector-toggle").click();
  await settle(page);
  await waitForCameraIdle(page);
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

  for (const macPinch of [false, true])
    test(`panel toggles keep a viewport zoomed by hand (${macPinch ? "macOS" : "Windows"} pinch)`, async ({ page }) => {
      // React Flow scales Ctrl+wheel tenfold for macOS trackpad pinch events. Exercise both
      // interpretations on every host, at the same zoom; a huge zoom invokes the separate R6 rule.
      await page.addInitScript((mac) => {
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          value: navigator.userAgent.replace(
            /\([^)]*\)/,
            mac ? "(Macintosh; Intel Mac OS X 10_15_7)" : "(Windows NT 10.0; Win64; x64)",
          ),
        });
      }, macPinch);
      await openFitted(page);
      const fitted = await boxes(page);
      const pane = await boxOf(page, "canvas-wrap");
      await page.mouse.move(pane.x + pane.width / 3, pane.y + pane.height / 2);
      // Ctrl+wheel zooms (the wheel alone pans).
      // Literal Control: a trackpad pinch emits ctrl+wheel on every OS.
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, macPinch ? -30 : -300);
      await page.keyboard.up("Control");
      await settle(page);
      const before = await boxes(page);
      expect(before[0].height).toBeGreaterThan(fitted[0].height);
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

test.describe("the canvas never scrolls", () => {
  // React Flow's wrapper used to be a scrollable box (overflow: hidden): with the diagram spilling past its
  // edge, focus or scrollIntoView on a node out of view scrolled it, and React Flow snapped it back a frame
  // later. The whole canvas and its chrome (the live bar, the trace card) jumped for that frame, so a click
  // could miss, and the node stayed hidden. Now the canvas can't scroll, and keyboard focus pans instead.

  /** Pans the canvas by hand: the wheel pans it (scroll-zoom is off). */
  async function panBy(page: Page, dx: number, dy: number) {
    await waitForStableViewport(page);
    const wrap = await boxOf(page, "canvas-wrap");
    await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2);
    await page.mouse.wheel(dx, dy);
    await waitForStableViewport(page);
  }

  test("focus or scrollIntoView on a node out of view moves neither the canvas nor the live bar", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&paused=1`);
    // The diagram spills past the bottom and right of the canvas.
    await panBy(page, -400, -800);
    const before = await boxOf(page, "live-more");
    const after = await page.evaluate(() => {
      const rf = document.querySelector<HTMLElement>(".react-flow");
      const pane = rf?.getBoundingClientRect();
      if (!rf || !pane) throw new Error("No canvas");
      const out = [...rf.querySelectorAll<HTMLElement>(".react-flow__node")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= pane.right || r.top >= pane.bottom;
      });
      if (out.length < 2) throw new Error("Not enough of the diagram is out of view: zoom in further");
      const read = () => [rf.scrollLeft, rf.scrollTop];
      out[0].focus();
      const focused = read();
      out[1].scrollIntoView();
      const scrolled = read();
      const more = document.querySelector('[data-testid="live-more"]')?.getBoundingClientRect();
      return { focused, scrolled, more: more && { x: more.x, y: more.y } };
    });
    expect(after.focused).toEqual([0, 0]);
    expect(after.scrolled).toEqual([0, 0]);
    expect(after.more).toEqual({ x: before.x, y: before.y });
  });

  /** The Kafka example's Tab stop: the first node in reading order (only it has tabindex 0). */
  const TAB_STOP = "rf__node-schemas";
  type Rect = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const within = (a: Rect, b: Rect) =>
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const scale = async (page: Page) => Number(/scale\(([\d.]+)\)/.exec(await viewportTransform(page))?.[1]);
  const wrapperScroll = (page: Page) => page.getByTestId("rf__wrapper").evaluate((w) => [w.scrollLeft, w.scrollTop]);

  /** Tab into the canvas from the last rail control: the browser moves focus there. */
  async function tabIn(page: Page) {
    await page.getByTestId("ai-rail-open").focus();
    await page.keyboard.press("Tab");
  }

  /** Pans by hand until the centre of `testId` sits at `at` (screen px), give or take a few px. */
  async function centreAt(page: Page, testId: string, at: { x: number; y: number }) {
    await expect(async () => {
      const b = await boxOf(page, testId);
      const dx = b.x + b.width / 2 - at.x,
        dy = b.y + b.height / 2 - at.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) await panBy(page, dx, dy);
      const now = await boxOf(page, testId);
      expect(Math.abs(now.x + now.width / 2 - at.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(now.y + now.height / 2 - at.y)).toBeLessThanOrEqual(4);
    }).toPass({ timeout: 10_000 });
  }

  test("Tab into the canvas brings a node half out of view fully into view, with a pan", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await waitForStableViewport(page);
    await expect(page.getByTestId(TAB_STOP)).toHaveAttribute("tabindex", "0");
    // Half past the pane's left edge: React Flow's own pan on focus counted it as in view.
    const wrap = await boxOf(page, "canvas-wrap");
    await centreAt(page, TAB_STOP, { x: wrap.x, y: wrap.y + wrap.height / 2 });
    expect(within(await boxOf(page, TAB_STOP), wrap)).toBe(false);
    await tabIn(page);
    await expect(page.getByTestId(TAB_STOP)).toBeFocused();
    await expect.poll(async () => within(await boxOf(page, TAB_STOP), wrap)).toBe(true);
    expect(await wrapperScroll(page)).toEqual([0, 0]);
  });

  for (const where of ["half past the edge beside the controls", "under the controls"] as const)
    test(`Tab onto a node ${where} keeps the zoom and clears the floating controls`, async ({ page }) => {
      await gotoCanvas(page, KAFKA);
      await waitForStableViewport(page);
      await expect(page.getByTestId(TAB_STOP)).toHaveAttribute("tabindex", "0");
      const wrap = await boxOf(page, "canvas-wrap");
      const controls = await boxOf(page, "canvas-controls");
      // Past the left edge, brought in with the selection's margin alone it would land on the controls. Under
      // them, it's wholly in the pane: in view, yet covered.
      const width = (await boxOf(page, TAB_STOP)).width;
      const x = where === "under the controls" ? controls.x + controls.width + width / 2 - 12 : wrap.x;
      await centreAt(page, TAB_STOP, { x, y: controls.y + controls.height / 2 });
      const placed = await boxOf(page, TAB_STOP);
      expect(overlaps(placed, controls)).toBe(true);
      expect(within(placed, wrap)).toBe(where === "under the controls");
      const zoom = await scale(page);
      await tabIn(page);
      await expect(page.getByTestId(TAB_STOP)).toBeFocused();
      await expect.poll(async () => overlaps(await boxOf(page, TAB_STOP), controls)).toBe(false);
      await waitForStableViewport(page);
      const node = await boxOf(page, TAB_STOP);
      expect(within(node, wrap)).toBe(true);
      expect(overlaps(node, controls)).toBe(false);
      const minimap = page.getByTestId("canvas-minimap");
      if (await minimap.isVisible()) expect(overlaps(node, await boxOf(page, "canvas-minimap"))).toBe(false);
      expect(await scale(page)).toBe(zoom);
      expect(await wrapperScroll(page)).toEqual([0, 0]);
    });

  test("Tab onto a boundary bigger than the pane brings its name into view, not its middle", async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("seeded", "1");
        }
      },
      [
        STORAGE_KEYS.autosavePrefix + KAFKA,
        JSON.stringify({
          format: "diagrams/v1",
          title: "A big boundary",
          groups: [{ id: "big", label: "Big boundary", x: 0, y: 0, width: 2400, height: 1600 }],
          nodes: [{ id: "a", stencil: "service.node", label: "Inside", x: 1100, y: 700, group: "big" }],
          edges: [],
        }),
      ] as const,
    );
    await gotoCanvas(page, KAFKA);
    await waitForStableViewport(page);
    // The boundary comes first in Tab's order: it's the Tab stop.
    const stop = page.getByTestId("rf__node-group:big");
    await expect(stop).toHaveAttribute("tabindex", "0");
    // At 100% the boundary is far bigger than the pane, and its name (top-left) is out of view.
    await page.keyboard.press("Shift+Digit0");
    await waitForStableViewport(page);
    const wrap = await boxOf(page, "canvas-wrap");
    const name = () => boxOf(page, "group-label-big");
    await centreAt(page, "node-a", { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height / 2 });
    expect(within(await name(), wrap)).toBe(false);
    const zoom = await scale(page);
    await tabIn(page);
    await expect(stop).toBeFocused();
    await expect.poll(async () => within(await name(), wrap)).toBe(true);
    await waitForStableViewport(page);
    expect(within(await name(), wrap)).toBe(true);
    expect(await scale(page)).toBe(zoom);
    // With its name in view, focus coming back leaves the view alone.
    const before = await viewportTransform(page);
    await tabIn(page);
    await expect(stop).toBeFocused();
    // A reveal starts as focus lands: a pan would show between the readings.
    await waitForStableViewport(page);
    expect(await viewportTransform(page)).toBe(before);
  });
});
