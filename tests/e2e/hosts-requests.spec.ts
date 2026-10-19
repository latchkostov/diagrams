import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, expectNoErrors, pageLoadTimeout } from "./fixtures";
import { emulateTracker } from "./collab-tracker";

// Hosts and requests (meeting hosts design P3) between browsers in one room, with real WebRTC between them and the
// tracker emulated in the test runner (./collab-tracker.ts). Asking to drive, the host's answer, the driver role
// moving at a tick (the old host then follows the new driver's run, checked by digest), and the host leaving on
// purpose (the earliest co-host takes the room). Selectors are data-testid only.

type Probe = { tick: number; digest: number; playing: boolean; run?: string } | undefined;
const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __watch?: { probe(): Probe } }).__watch?.probe());
const chip = (page: Page) => page.getByTestId("room-chip");
async function run(page: Page) {
  const p = await probe(page);
  if (!p) throw new Error("No live session to probe");
  return p;
}

async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-confirm").click();
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

async function join(context: BrowserContext, link: string, alias: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  await page.getByTestId("room-join-alias").fill(alias);
  await page.getByTestId("room-join-accept").click();
  await expect(page.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
  return page;
}

/** The host starts a room on Kafka. */
async function hostRoom(page: Page): Promise<string> {
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  return startRoom(page);
}

/** The host goes Live with Black Friday at half speed, playing. */
async function hostPlays(host: Page) {
  await host.getByTestId("live-toggle").click();
  await expect(host.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  const picker = host.getByTestId("live-sim-picker");
  if (!(await picker.isVisible())) await host.getByTestId("live-more").click();
  await picker.selectOption("black-friday");
  await host.getByTestId("live-speed").selectOption("0.5");
  if ((await host.getByTestId("live-play").getAttribute("data-state")) !== "playing")
    await host.getByTestId("live-play").click();
  await expect(host.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await expect(chip(host)).toHaveAttribute("data-watch", "host");
}

async function watches(guest: Page) {
  await guest.getByTestId("room-watch-offer").click({ timeout: pageLoadTimeout() });
  await expect(guest.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(chip(guest)).toHaveAttribute("data-watch", "following", { timeout: 30_000 });
}

/** The driver pauses; the follower comes to the same tick; their runs are in the same state there. */
async function sameStateAfterPause(driver: Page, follower: Page) {
  await driver.getByTestId("live-play").click();
  await expect(driver.getByTestId("live-play")).not.toHaveAttribute("data-state", "playing");
  let last = -1;
  await expect
    .poll(
      async () => {
        const tick = (await run(driver)).tick;
        const still = tick === last;
        last = tick;
        return still;
      },
      { intervals: [400], timeout: 20_000 },
    )
    .toBe(true);
  const at = await run(driver);
  await expect.poll(async () => (await probe(follower))?.tick, { timeout: 20_000 }).toBe(at.tick);
  expect((await probe(follower))?.digest).toBe((await probe(driver))?.digest);
}

test.describe("Hosts and requests", () => {
  test("ask to drive, the host lets them: the new driver changes a rate and the old host follows by digest", async ({
    browser,
    context,
    page,
    consoleErrors,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      await emulateTracker([context, other]);
      const link = await hostRoom(page);
      const guest = await join(other, link, "Heron");
      await hostPlays(page);
      await watches(guest);
      // Following, the live bar is inert: using it says who drives, with Ask to drive.
      await guest.getByTestId("live-play").click();
      await expect(guest.getByTestId("room-driving")).toBeVisible();
      await expect(chip(guest)).toHaveAttribute("data-watch", "following");
      await guest.getByTestId("room-driving-ask").click();
      // The host's card: Let them. The shared run before the handoff.
      await expect(page.getByTestId("room-prompt-drive")).toContainText("Heron");
      const shared = (await run(page)).run;
      expect(shared).toBeTruthy();
      await page.getByTestId("room-prompt-accept").click();
      await expect(page.getByTestId("room-prompt-drive")).toHaveCount(0);
      // The run moves to the guest at a tick: the guest drives it on, the host follows it.
      await expect(chip(guest)).toHaveAttribute("data-driving", "true", { timeout: 20_000 });
      await expect(chip(page)).toHaveAttribute("data-watch", "following", { timeout: 20_000 });
      await expect(chip(page)).toHaveAttribute("data-host", "true");
      // The same run goes on (no fallback to a new one): the guest drives it, the host follows it.
      expect((await run(guest)).run).toBe(shared);
      expect((await run(page)).run).toBe(shared);
      // The new driver changes the shopper's entry rate mid-run.
      await guest.getByTestId("live-capacity").click();
      await expect(guest.getByTestId("capacity-panel")).toBeVisible();
      const rate = guest.getByTestId("capacity-rate-shopper");
      await rate.fill("3k");
      await rate.press("Enter");
      const from = (await run(guest)).tick;
      await expect.poll(async () => (await run(guest)).tick, { timeout: 20_000 }).toBeGreaterThan(from + 200);
      await sameStateAfterPause(guest, page);
      expectNoErrors(consoleErrors);
    } finally {
      await other.close();
    }
  });

  test("ask to drive, the host says not now: the asker is told, and goes on following", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const other = await browser.newContext();
    try {
      await emulateTracker([context, other]);
      const link = await hostRoom(page);
      const guest = await join(other, link, "Heron");
      await hostPlays(page);
      await watches(guest);
      await chip(guest).click();
      await guest.getByTestId("room-ask-drive").click();
      await expect(page.getByTestId("room-prompt-drive")).toBeVisible();
      await page.getByTestId("room-prompt-decline").click();
      await expect(page.getByTestId("room-prompt-drive")).toHaveCount(0);
      await expect(guest.getByTestId("toast").filter({ hasText: "Not now" })).toBeVisible();
      await expect(chip(guest)).toHaveAttribute("data-watch", "following");
      await expect(chip(guest)).toHaveAttribute("data-driving", "false");
      await expect(chip(page)).toHaveAttribute("data-watch", "host");
      // Asking again is possible.
      await chip(guest).click();
      await expect(guest.getByTestId("room-ask-drive")).toBeEnabled();
    } finally {
      await other.close();
    }
  });

  test("the host leaves on purpose: the earliest co-host becomes host, not whoever came first", async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const [a, b] = [await browser.newContext(), await browser.newContext()];
    try {
      await emulateTracker([context, a, b]);
      const link = await hostRoom(page);
      const first = await join(a, link, "Ada");
      const second = await join(b, link, "Bea");
      await expect(chip(page)).toHaveAttribute("data-peers", "2");
      // The host makes the second to join a co-host.
      await chip(page).click();
      await page.getByTestId("room-person-row").filter({ hasText: "Bea" }).click();
      await page.getByTestId("room-make-cohost").click();
      await expect(chip(second)).toHaveAttribute("data-host", "cohost");
      await expect(chip(first)).toHaveAttribute("data-host", "false");
      await chip(page).click();
      await page.getByTestId("room-leave").click();
      await expect(chip(second)).toHaveAttribute("data-host", "true", { timeout: 20_000 });
      await expect(chip(first)).toHaveAttribute("data-host", "false");
      await expect(second.getByTestId("toast").filter({ hasText: "host of this room" })).toBeVisible();
    } finally {
      await a.close();
      await b.close();
    }
  });
});
