import type { Page } from "@playwright/test";
import { breakerFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForCameraIdle,
  expectNoErrors,
} from "./fixtures";

async function open(page: Page, simulation = false) {
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: breakerFixture(),
  });
  await gotoLive(page, `./?view=canvas&example=blocking-call&live=1&paused=1${simulation ? "&sim=breaker" : ""}`);
}

test("the Inspector clearly edits a simulation breaker override, persists Off and toggles On from the menu", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, true);
  await waitForCameraIdle(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  const field = page.getByTestId("inspector-field-breaker");
  await expect(field).toHaveText("On");
  await field.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("call-override-breaker")).toContainText("On");
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.breaker)
    .toBeNull();
  await page.reload();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await waitForCameraIdle(page);
  await page.getByTestId("edge-call").dblclick();
  const section = page.getByTestId("inspector-section-edge-simulation");
  await expect(section).toBeVisible();
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "true");
  await expect(field).toHaveText("Off");
  await expect(page.getByTestId("call-override-breaker")).toContainText("On");
  await page.screenshot({ path: test.info().outputPath("breaker-override.png") });
  await waitForCameraIdle(page);
  await page.getByTestId("edge-call").click({ button: "right" });
  await page.getByTestId("context-menu-item-edge.simulation").click();
  await page.getByTestId("context-menu-item-edge.breaker").click();
  await expect(field).toHaveText("On");
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller?.breaker)
    .toEqual({});
  expect((await savedDiagram(page)).edges[1].props?.caller).toMatchObject({
    breaker: { minimumCalls: 1, openMs: 1000 },
  });
  await page.getByTestId("undo-button").click();
  await expect(field).toHaveText("Off");
  expectNoErrors(consoleErrors);
});

test("an open breaker uses the existing call pill and Calls hover", async ({ page, consoleErrors }) => {
  await page.clock.install();
  await open(page);
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(500);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("call-pill-call")).toContainText("● Open");
  await page.getByTestId("node-caller").hover();
  await expect(page.getByTestId("calls-breaker-call")).toContainText("Open");
  await expect(page.getByTestId("call-pill-call")).toHaveAttribute("title", /503/);
  expectNoErrors(consoleErrors);
});

async function holdTracker(page: Page) {
  let requested = false;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gate = { fail: false, requested: () => requested, release };
  await page.route(/\/(?:assets\/troubleTracker-[\w-]+\.js|src\/live\/troubleTracker\.ts)(?:\?.*)?$/, async (route) => {
    requested = true;
    if (gate.fail) return route.abort("failed");
    await ready;
    return gate.fail ? route.abort("failed") : route.continue();
  });
  return gate;
}

async function exportDiagram(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-json").click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
}

async function killPartner(page: Page) {
  await waitForCameraIdle(page);
  await page.getByTestId("node-partner").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.fault").click();
  await page.getByTestId("context-menu-item-sim.kill").click();
}

test("held trouble detection keeps keyboard, cursor, styles and export usable, then reports current trouble", async ({
  page,
  consoleErrors,
}) => {
  const tracker = await holdTracker(page);
  try {
    await open(page);
    await expect.poll(tracker.requested).toBe(true);
    await killPartner(page);
    await page.getByTestId("live-play").focus();
    const before = await page.getByTestId("live-controls").evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
    await exportDiagram(page);
    await page.getByTestId("live-play").focus();
    tracker.release();
    await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "down");
    await expect(page.getByTestId("live-play")).toBeFocused();
    expect(await page.getByTestId("live-controls").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before);
    await page.getByTestId("trouble-action").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    await exportDiagram(page);
    expectNoErrors(consoleErrors);
  } finally {
    tracker.release();
  }
});

test("failed trouble detection offers keyboard Retry without taking focus or blocking export", async ({ page }) => {
  const tracker = await holdTracker(page);
  tracker.fail = true;
  await open(page);
  await expect(page.getByTestId("trouble-download-retry")).toBeVisible();
  await killPartner(page);
  await page.getByTestId("live-play").focus();
  await exportDiagram(page);
  await page.getByTestId("live-play").focus();
  await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  tracker.fail = false;
  tracker.release();
  await page.getByTestId("trouble-download-retry").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "down");
  await expect(page.getByTestId("trouble-action")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await exportDiagram(page);
});
