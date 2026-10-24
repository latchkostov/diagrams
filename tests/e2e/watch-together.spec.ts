import {
  pauseClock,
  test,
  expect,
  expectNoErrors,
  pageLoadTimeout,
  viewportTransform,
  waitForStableViewport,
} from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { emulateTracker } from "./collab-tracker";

// Watch together (shared Live design, P2) between two browsers in one room, with real WebRTC between them and the
// tracker emulated in the test runner (./collab-tracker.ts). The host (the room's creator) drives Live; the guest
// chooses Watch and follows the same run in lockstep. "The same state" is the run digest (src/sim/digest.ts) on the
// same tick, read through the e2e build's probe (window.__watch). Selectors are data-testid only.

type Probe = { tick: number; digest: number; playing: boolean; busy: boolean } | undefined;
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

/** The pane's centre in flow coordinates, and the zoom (what Follow the host's view matches). */
const viewOf = (page: Page) =>
  page.getByTestId("canvas-wrap").evaluate((wrap) => {
    const flow = wrap.querySelector<HTMLElement>(".react-flow");
    const transform = wrap.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";
    const [, x, y, zoom] = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(transform) ?? [];
    const w = flow?.clientWidth ?? 0;
    const h = flow?.clientHeight ?? 0;
    return { x: (w / 2 - Number(x)) / Number(zoom), y: (h / 2 - Number(y)) / Number(zoom), zoom: Number(zoom) };
  });

async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-confirm").click();
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

/** The host starts a room on Kafka; the guest joins it. */
async function twoInARoom(
  page: Page,
  context: BrowserContext,
  other: BrowserContext,
  example = "kafka-order-pipeline",
): Promise<Page> {
  await emulateTracker([context, other]);
  await page.goto(`./?view=canvas&example=${example}`);
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  const link = await startRoom(page);
  const guest = await other.newPage();
  await guest.goto(link);
  await guest.getByTestId("room-join-accept").click();
  // Knock-to-join: the host lets them in.
  await page.getByTestId("room-knock-admit").first().click({ timeout: pageLoadTimeout() });
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
async function sameStateAfterPause(host: Page, guest: Page, holdFollower = false) {
  await host.getByTestId("live-play").click();
  await expect(host.getByTestId("live-play")).not.toHaveAttribute("data-state", "playing");
  // A rate change can pause between replay slices: wait for the replay itself before sampling its tick.
  await expect.poll(async () => (await run(host)).busy, { timeout: 20_000 }).toBe(false);
  const at = await run(host);
  if (holdFollower) {
    // A matching tick alone must not sample a busy replay's transient digest. Hold readiness
    // across three probes of that exact tick so this regression is independent of machine speed.
    await guest.evaluate((tick) => {
      const watch = (window as unknown as { __watch: { probe(): Probe } }).__watch;
      const original = watch.probe.bind(watch);
      let held = 0;
      watch.probe = () => {
        const state = original();
        return state && state.tick === tick && !state.playing && held++ < 3
          ? { ...state, busy: true, digest: state.digest ^ 1 }
          : state;
      };
    }, at.tick);
  }
  await expect
    .poll(
      async () => {
        const state = await probe(guest);
        return state && !state.busy && !state.playing ? state.tick : undefined;
      },
      { timeout: 20_000 },
    )
    .toBe(at.tick);
  expect((await probe(guest))?.digest).toBe((await probe(host))?.digest);
  return at;
}

test.describe("Watch together", () => {
  test("a timeout edited mid-run reaches the follower through the shared run", async ({ browser, context, page }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      const guest = await twoInARoom(page, context, other, "slow-payment-provider");
      await hostPlays(page, null);
      await guestWatches(guest, "toast");
      await expect.poll(async () => (await run(page)).tick).toBeGreaterThan(20);
      await waitForStableViewport(page);
      await page.getByTestId("edge-pay").click({ button: "right" });
      await page.getByTestId("context-menu-item-node.properties").click();
      await page.getByTestId("inspector-section-edge-simulation").click();
      await page.getByTestId("inspector-field-deadlineMs").fill("100");
      await page.getByTestId("inspector-field-deadlineMs").blur();
      await expect(page.getByTestId("call-pill-pay")).toContainText("timed out");
      await sameStateAfterPause(page, guest);
      await expect(guest.getByTestId("call-pill-pay")).toHaveText(await page.getByTestId("call-pill-pay").innerText());
    } finally {
      await other.close();
    }
  });
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
      await sameStateAfterPause(page, guest, true);
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
      await expect.poll(async () => (await run(page)).tick, { timeout: 20_000 }).toBeGreaterThan(500);
      // Seconds into the run, from the chip's menu: the guest's run catches up from the start.
      await guestWatches(guest, "menu");
      await sameStateAfterPause(page, guest);
    } finally {
      await other.close();
    }
  });

  test("the guest keeps following when the host restarts and picks another simulation", async ({
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
      await expect.poll(async () => (await run(page)).tick, { timeout: 10_000 }).toBeGreaterThan(200);
      // Restart: a new run, from its start for everyone.
      await page.getByTestId("live-restart").click();
      await expect(chip(guest)).toHaveAttribute("data-watch", "following", { timeout: 15_000 });
      await sameStateAfterPause(page, guest);
      // Another simulation (free play): a new run again, and the guest follows it.
      const picker = page.getByTestId("live-sim-picker");
      if (!(await picker.isVisible())) await page.getByTestId("live-more").click();
      await picker.selectOption("");
      if ((await page.getByTestId("live-play").getAttribute("data-state")) !== "playing")
        await page.getByTestId("live-play").click();
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
      await expect.poll(async () => (await run(page)).tick, { timeout: 10_000 }).toBeGreaterThan(100);
      await expect(chip(guest)).toHaveAttribute("data-watch", "following", { timeout: 15_000 });
      await sameStateAfterPause(page, guest);
    } finally {
      await other.close();
    }
  });

  test("presenting (no top bar, no chip) stops neither the host sharing nor the guest following", async ({
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
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
      await guest.getByTestId("present-toggle").click();
      await expect(guest.getByTestId("present-exit")).toBeVisible();
      await expect(chip(guest)).toHaveCount(0);
      // Both present: the guest's run goes on with the host's.
      const from = (await run(guest)).tick;
      await expect.poll(async () => (await run(guest)).tick, { timeout: 10_000 }).toBeGreaterThan(from + 50);
      await guest.getByTestId("present-exit").click();
      await page.getByTestId("present-exit").click();
      await expect(chip(guest)).toHaveAttribute("data-watch", "following");
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
      await guest.clock.install();
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
      await pauseClock(guest);
      await guest.clock.runFor(1000);
      expect((await run(guest)).tick).toBe(held);
      await guest.clock.resume();
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
      // The host zooms in (Ctrl+wheel; a plain wheel pans): the guest's view doesn't move (no yanking).
      await waitForStableViewport(guest);
      const before = await viewportTransform(guest);
      const hostBefore = await viewOf(page);
      const pane = await box(page);
      await page.mouse.move(pane.x + pane.width / 3, pane.y + pane.height / 3);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -400);
      await page.keyboard.up("Control");
      await expect.poll(async () => (await viewOf(page)).zoom).not.toBeCloseTo(hostBefore.zoom, 2);
      await waitForStableViewport(page);
      const host = await viewOf(page);
      await expect
        .poll(() =>
          guest.evaluate(
            () =>
              (
                window as unknown as { __watch?: { getState(): { driver?: { view?: { zoom: number } } } } }
              ).__watch?.getState().driver?.view?.zoom,
          ),
        )
        .toBeCloseTo(host.zoom, 2);
      expect(await viewportTransform(guest)).toBe(before);
      // Opt in: the guest's view takes the host's zoom and centre.
      await chip(guest).click();
      const follow = guest.getByTestId("room-follow-view");
      await expect(follow).toHaveAttribute("aria-checked", "false");
      await follow.click();
      await chip(guest).click();
      await expect(guest.getByTestId("room-follow-view")).toHaveAttribute("aria-checked", "true");
      await guest.keyboard.press("Escape");
      await expect.poll(async () => (await viewOf(guest)).zoom).toBeCloseTo(host.zoom, 2);
      const followed = await viewOf(guest);
      expect(Math.abs(followed.x - host.x)).toBeLessThan(2);
      expect(Math.abs(followed.y - host.y)).toBeLessThan(2);
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
