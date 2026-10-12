import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, waitForStableViewport } from "./fixtures";

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

  test("Tab into the canvas brings a node half out of view fully into view, with a pan", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await waitForStableViewport(page);
    const stop = page.locator('.react-flow__node[tabindex="0"]');
    await expect(stop).toHaveCount(1);
    // Half of the canvas's Tab stop (the first node in reading order) past the pane's left edge: React Flow's
    // own pan on focus counts it as in view.
    const wrap0 = await boxOf(page, "canvas-wrap");
    await expect(async () => {
      const node0 = await stop.boundingBox();
      if (!node0) throw new Error("No Tab stop");
      const off = node0.x + node0.width / 2 - wrap0.x;
      if (Math.abs(off) > node0.width / 4) await panBy(page, off, 0);
      const now = await stop.boundingBox();
      expect(now && now.x < wrap0.x && now.x + now.width > wrap0.x).toBe(true);
    }).toPass({ timeout: 10_000 });
    const inPane = async () => {
      const wrap = await boxOf(page, "canvas-wrap");
      const b = await stop.boundingBox();
      return (
        !!b &&
        b.x >= wrap.x &&
        b.y >= wrap.y &&
        b.x + b.width <= wrap.x + wrap.width &&
        b.y + b.height <= wrap.y + wrap.height
      );
    };
    expect(await inPane()).toBe(false);
    // Focus the last Tab stop before the canvas, then Tab: the browser moves focus onto the node.
    await page.evaluate(() => {
      const rf = document.querySelector(".react-flow");
      const stops = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
        .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length)
        .filter((el) => !rf?.contains(el) && (rf?.compareDocumentPosition(el) ?? 0) & Node.DOCUMENT_POSITION_PRECEDING);
      const before = stops.at(-1);
      if (!before) throw new Error("No Tab stop before the canvas");
      before.focus();
    });
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
    await expect.poll(inPane).toBe(true);
    expect(
      await page.getByTestId("canvas-wrap").evaluate((w) => {
        const rf = w.querySelector<HTMLElement>(".react-flow");
        return [rf?.scrollLeft, rf?.scrollTop];
      }),
    ).toEqual([0, 0]);
  });
});
