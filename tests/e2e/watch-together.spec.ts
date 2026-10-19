import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, expectNoErrors, pageLoadTimeout, viewportTransform, waitForStableViewport } from "./fixtures";
import { emulateTracker } from "./collab-tracker";

// Watch together (shared Live design, P2) between two browsers in one room, with real WebRTC between them and the
// tracker emulated in the test runner (./collab-tracker.ts). The host (the room's creator) drives Live; the guest
// chooses Watch and follows the same run in lockstep. "The same state" is the run digest (src/sim/digest.ts) on the
// same tick, read through the e2e build's probe (window.__watch). Selectors are data-testid only.

type Probe = { tick: number; digest: number; playing: boolean } | undefined;
const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __watch?: { probe(): Probe } }).__watch?.probe());
const chip = (page: Page) => page.getByTestId("room-chip");
/** The page's run now (its Live session must be up). */
async function run(page: Page) {
  const p = await probe(page);
  if (!p) throw new Error("No live session to probe");
  return p;
}
async function box(page: Page) {
  const b = await page.getByTestId("canvas-wrap").boundingBox();
  if (!b) throw new Error("No canvas");
  return b;
}

async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-confirm").click();
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

/** The host starts a room on Kafka; the guest joins it. */
async function twoInARoom(page: Page, context: BrowserContext, other: BrowserContext): Promise<Page> {
  await emulateTracker([context, other]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  const link = await startRoom(page);
  const guest = await other.newPage();
  await guest.goto(link);
  await guest.getByTestId("room-join-accept").click();
  await expect(guest.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(chip(page)).toHaveAttribute("data-peers", "1");
  return guest;
}

/** The host goes Live with Black Friday (or free play, which has no narration to move anyone's camera), playing. */
async function hostPlays(host: Page, simulation: string | null = "black-friday") {
  await host.getByTestId("live-toggle").click();
  await expect(host.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  if (simulation) {
    const picker = host.getByTestId("live-sim-picker");
    if (!(await picker.isVisible())) await host.getByTestId("live-more").click();
    await picker.selectOption(simulation);
    // Half speed: Black Friday's 15 s then last half a minute, so a slow machine pauses it before it ends.
    await host.getByTestId("live-speed").selectOption("0.5");
  }
  if ((await host.getByTestId("live-play").getAttribute("data-state")) !== "playing")
    await host.getByTestId("live-play").click();
  await expect(host.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await expect(chip(host)).toHaveAttribute("data-watch", "host");
}

/** The guest takes the offer to watch (the toast's Watch, or the chip's menu), into Live, following. */
async function guestWatches(guest: Page, via: "toast" | "menu") {
  if (via === "toast") await guest.getByTestId("room-watch-offer").click({ timeout: pageLoadTimeout() });
  else {
    await chip(guest).click();
    await guest.getByTestId("room-watch").click();
  }
  await expect(guest.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(chip(guest)).toHaveAttribute("data-watch", "following", { timeout: 30_000 });
  await expect(chip(guest)).toContainText("Following");
}

/** The host pauses; the guest comes to the same tick; their runs are in the same state there. */
async function sameStateAfterPause(host: Page, guest: Page) {
  await host.getByTestId("live-play").click();
  await expect(host.getByTestId("live-play")).not.toHaveAttribute("data-state", "playing");
  // Paused, and any rebuild (a rate change replays the run to the same moment) finished: the tick stands still.
  let last = -1;
  await expect
    .poll(
      async () => {
        const tick = (await run(host)).tick;
        const still = tick === last;
        last = tick;
        return still;
      },
      { intervals: [400], timeout: 20_000 },
    )
    .toBe(true);
  const at = await run(host);
  await expect.poll(async () => (await probe(guest))?.tick, { timeout: 20_000 }).toBe(at.tick);
  expect((await probe(guest))?.digest).toBe((await probe(host))?.digest);
  return at;
}

test.describe("Watch together", () => {
  test("the guest watches the host's Live: rps and replicas changed mid-run reach them on the same tick", async ({
    browser,
    context,
    page,
    consoleErrors,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      const guest = await twoInARoom(page, context, other);
      await hostPlays(page);
      // Offered, never automatic: the guest's canvas stays as it was until they choose Watch.
      await expect(chip(guest)).toHaveAttribute("data-watch", "offered");
      await expect(guest.getByTestId("live-controls")).toHaveCount(0);
      await guestWatches(guest, "toast");
      // Mid-run, the host changes an entry rate (a rebuild) and a replica count (a patch).
      await page.getByTestId("live-capacity").click();
      await expect(page.getByTestId("capacity-panel")).toBeVisible();
      await page.getByTestId("capacity-replicas-payments-inc").click();
      const rate = page.getByTestId("capacity-rate-shopper");
      await rate.fill("3k");
      await rate.press("Enter");
      await expect.poll(async () => (await run(page)).tick, { timeout: 10_000 }).toBeGreaterThan(400);
      await sameStateAfterPause(page, guest);
      expectNoErrors(consoleErrors);
    } finally {
      await other.close();
    }
  });

  test("a late joiner catches up to the host's run and lands on the same state", async ({ browser, context, page }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      const guest = await twoInARoom(page, context, other);
      await hostPlays(page);
      await page.getByTestId("live-capacity").click();
      await page.getByTestId("capacity-replicas-payments-inc").click();
      await expect.poll(async () => (await run(page)).tick, { timeout: 10_000 }).toBeGreaterThan(500);
      // Seconds into the run, from the chip's menu: the guest's run catches up from the start.
      await guestWatches(guest, "menu");
      await sameStateAfterPause(page, guest);
    } finally {
      await other.close();
    }
  });

  test("when the host's connection stops, the guest holds still and waits; no one else takes over", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      const guest = await twoInARoom(page, context, other);
      await hostPlays(page);
      await guestWatches(guest, "toast");
      // The host's page stops answering for twelve seconds (no beacons, no ops).
      void page.evaluate(() => {
        const end = Date.now() + 12_000;
        while (Date.now() < end) {
          /* a hung tab */
        }
      });
      await expect(chip(guest)).toHaveAttribute("data-watch", "host-dropped", { timeout: 10_000 });
      await expect(chip(guest)).toContainText("connection dropped");
      const held = (await run(guest)).tick;
      await guest.waitForTimeout(1000);
      expect((await run(guest)).tick).toBe(held);
      await expect(chip(page)).toHaveAttribute("data-watch", "host");
      // The host is back: the guest goes on following.
      await expect(chip(guest)).toHaveAttribute("data-watch", "following", { timeout: 15_000 });
    } finally {
      await other.close();
    }
  });

  test("the guest's camera is their own; Follow the host's view is opt-in and their own pan ends it", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      const guest = await twoInARoom(page, context, other);
      await hostPlays(page, null);
      await guestWatches(guest, "toast");
      // The host zooms in: the guest's view doesn't move (no yanking).
      await waitForStableViewport(guest);
      const before = await viewportTransform(guest);
      const pane = await box(page);
      await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
      await page.mouse.wheel(0, -400);
      await expect.poll(() => viewportTransform(page)).not.toBe(before);
      await guest.waitForTimeout(800);
      expect(await viewportTransform(guest)).toBe(before);
      // Opt in: the guest's view takes the host's zoom.
      await chip(guest).click();
      const follow = guest.getByTestId("room-follow-view");
      await expect(follow).toHaveAttribute("aria-checked", "false");
      await follow.click();
      const zoom = (t: string) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? NaN);
      const hostZoom = zoom(await viewportTransform(page));
      await expect.poll(async () => zoom(await viewportTransform(guest))).toBeCloseTo(hostZoom, 2);
      // The guest pans on their own: following the view ends there.
      const g = await box(guest);
      await guest.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await guest.mouse.wheel(0, 300);
      await chip(guest).click();
      await expect(guest.getByTestId("room-follow-view")).toHaveAttribute("aria-checked", "false");
    } finally {
      await other.close();
    }
  });
});
