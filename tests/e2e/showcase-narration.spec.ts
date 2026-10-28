import type { Page } from "@playwright/test";
import { test, expect, gotoLive, pauseClock, waitForStableViewport, flowState } from "./fixtures";

/** A known note in each large story, and the cards it brings into view. */
const narrations = [
  {
    slug: "black-friday-commerce",
    sim: "doors-open",
    at: 4500,
    text: "Doors open",
    focus: ["gateway", "checkout-api"],
  },
  {
    slug: "cell-based-bookings",
    sim: "region-evacuation",
    at: 5500,
    text: "us-east-1 goes dark",
    focus: ["dns", "east-alb"],
  },
  {
    slug: "payments-ledger",
    sim: "psp-brownout",
    at: 4500,
    text: "Adyen starts failing",
    focus: ["psp-router", "adyen"],
  },
  {
    slug: "delivery-dispatch",
    sim: "partition-ceiling",
    at: 5500,
    text: "KEDA scales to eight",
    focus: ["locations-topic", "geo-indexer"],
  },
  {
    slug: "ev-charging-network",
    sim: "vendor-shell",
    at: 6500,
    text: "deny rule stops",
    focus: ["depot-fw", "depot-switch"],
  },
  {
    slug: "recommendations-feature-store",
    sim: "friday-night",
    at: 4500,
    text: "four times the home loads",
    focus: ["ranking-router", "ranker-v7"],
  },
  {
    slug: "video-on-demand-pipeline",
    sim: "premiere-uploads",
    at: 4500,
    text: "The slate arrives",
    focus: ["uhd-q", "uhd-enc"],
  },
  {
    slug: "observability-pipeline",
    sim: "log-storm",
    at: 3500,
    text: "A bad Checkout deploy logs every retry",
    focus: ["agent-shop", "gateways"],
  },
  {
    slug: "hybrid-enterprise-network",
    sim: "leicester-fibre-cut",
    at: 4500,
    text: "the fibre is cut",
    focus: ["leicester-router", "lte"],
  },
] as const;

const boxOf = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`No box for ${testId}`);
  return box;
};
const clear = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

async function settleNarrationCamera(page: Page) {
  // Complete the move's fake-clock duration before polling its acknowledgement.
  // Under load, 32 ms per protocol round trip need not reach a 900 ms move in time.
  await page.clock.runFor(1000);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(32);
        return page.getByTestId("canvas-wrap").getAttribute("data-camera-state");
      },
      { intervals: [0] },
    )
    .toBe("idle");
  await page.clock.runFor(32);
}

async function visitNarrationPin(page: Page, id: string) {
  const pin = page.getByTestId(`focus-offscreen-${id}`);
  if (!(await pin.isVisible())) return false;
  await expect(pin).toBeInViewport({ ratio: 1 });
  await pin.click();
  await settleNarrationCamera(page);
  return true;
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
])
  test.describe(`large showcases focus the current narration at ${viewport.width}`, () => {
    test.use({ viewport });
    for (const n of narrations)
      test(`${n.slug}: “${n.text}” brings its cards into view`, async ({ page }) => {
        test.slow();
        await page.clock.install();
        await gotoLive(page, `./?view=canvas&example=${n.slug}&live=1&sim=${n.sim}`);
        await pauseClock(page);
        await page.clock.runFor(1000);
        await waitForStableViewport(page);
        const openingZoom = (await flowState(page)).zoom;
        const openingWidths = Object.fromEntries(
          await Promise.all(n.focus.map(async (id) => [id, (await boxOf(page, `rf__node-${id}`)).width] as const)),
        );
        await page.getByTestId("live-restart").click();
        await page.clock.runFor(n.at);
        await expect(page.getByTestId("live-note")).toContainText(n.text);
        // Let the narration camera finish its move.
        await page.clock.runFor(1500);
        await waitForStableViewport(page);
        await settleNarrationCamera(page);
        await expect(page.getByTestId("live-view-menu")).toContainText("Following");
        expect((await flowState(page)).zoom).toBeCloseTo(
          viewport.width < 640 ? Math.max(0.92, openingZoom) : openingZoom,
          4,
        );
        const canvas = await boxOf(page, "canvas-wrap");
        const note = await boxOf(page, "live-note");
        const bar = await boxOf(page, "live-controls");
        let visitedPin = false;
        for (const id of n.focus) {
          // Follow keeps its subject readable and pins distant cards. A pin is a
          // manual move: resume Follow before inspecting the next focus card.
          if (visitedPin) {
            await page.getByTestId("canvas-wrap").focus();
            await page.keyboard.press("Shift+Digit3");
            await settleNarrationCamera(page);
          }
          visitedPin = await visitNarrationPin(page, id);
          const card = await boxOf(page, `rf__node-${id}`);
          expect(card.x, id).toBeGreaterThanOrEqual(canvas.x - 0.5);
          expect(card.y, id).toBeGreaterThanOrEqual(canvas.y - 0.5);
          expect(card.x + card.width, id).toBeLessThanOrEqual(canvas.x + canvas.width + 0.5);
          expect(card.y + card.height, id).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
          expect(clear(card, note), `${id} clear of the note`).toBe(true);
          expect(clear(card, bar), `${id} clear of the playback bar`).toBe(true);
          // Desktop narration preserves the current card size; a manual pin visit may zoom in.
          if (viewport.width >= 1280) expect(card.width, id).toBeGreaterThanOrEqual(openingWidths[id] - 0.5);
        }
        // A manual pin visit may zoom in; narration never makes the opening card smaller.
        await visitNarrationPin(page, n.focus[0]);
        const close = (await boxOf(page, `rf__node-${n.focus[0]}`)).width;
        expect(close).toBeGreaterThanOrEqual(openingWidths[n.focus[0]] - 0.5);
      });
  });

test("dispatch opens the requested partition-ceiling story", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=delivery-dispatch&live=1&sim=partition-ceiling");
  await pauseClock(page);
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("partition-ceiling");
  await page.clock.runFor(1000);
  await waitForStableViewport(page);
  await page.getByTestId("live-restart").click();
  await page.clock.runFor(5500);
  await expect(page.getByTestId("live-note")).toContainText("KEDA scales to eight indexers and stops");
  // Before the 12 s partition change, eight partitions hold the indexers at eight (the dinner rush peaks at five).
  await page.clock.runFor(5000);
  const indexers = page.getByTestId("node-badge-geo-indexer");
  await expect(indexers).toHaveAttribute("data-ready", "8");
  await expect(indexers).toHaveAttribute("data-desired", "8");
});
