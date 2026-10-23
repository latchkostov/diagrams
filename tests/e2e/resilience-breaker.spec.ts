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
  await page.setViewportSize({ width: 768, height: 800 });
  const tracker = await holdTracker(page);
  tracker.fail = true;
  await open(page);
  await expect(page.getByTestId("trouble-download-retry")).toBeVisible();
  await expect(page.getByTestId("trouble-download-error")).toHaveAttribute("data-canvas-overlay", "");
  await expect(page.getByTestId("trouble-download-error")).toHaveAttribute("data-below", "");
  await page.getByTestId("fit-view-button").click();
  await waitForCameraIdle(page);
  await expect
    .poll(async () => {
      const callout = await page.getByTestId("trouble-download-error").boundingBox();
      if (!callout) return false;
      for (const id of ["source", "caller", "partner", "result"]) {
        const node = await page.getByTestId(`node-${id}`).boundingBox();
        if (
          !node ||
          (callout.x < node.x + node.width &&
            callout.x + callout.width > node.x &&
            callout.y < node.y + node.height &&
            callout.y + callout.height > node.y)
        )
          return false;
      }
      return true;
    })
    .toBe(true);
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

/** A chunk's production file, or its source module on the dev server (as tests/e2e/lazy-live-fixes.spec.ts). */
const chunk = (name: string, source?: string) =>
  new RegExp(
    String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js${source ? `|${source.replace(/\./g, "\\.")}` : ""})(?:\?.*)?$`,
  );
const TRACKER = chunk("troubleTracker", "src/live/troubleTracker.ts");
const PLACEMENT = chunk("useFloatingPlacement", "src/live/useFloatingPlacement.ts");
// Where the download-error notice itself lived before it shipped with Live (production only: in development it's a
// static import of the live session, which is never optional).
const ERROR_NOTICE = chunk("TroubleDownloadError");

/** Holds every request for `patterns` until release(), counting them; `fail` aborts them while it's true. */
async function holdChunks(page: Page, patterns: RegExp[]) {
  const counts = new Map<RegExp, number>();
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = { fail: false, release, count: (pattern: RegExp) => counts.get(pattern) ?? 0 };
  for (const pattern of patterns)
    await page.route(pattern, async (route) => {
      counts.set(pattern, control.count(pattern) + 1);
      if (control.fail) return route.abort("failed");
      await open;
      // Failed while held: the download that was waiting fails too.
      return control.fail ? route.abort("failed") : route.continue();
    });
  return control;
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "BODY");

/** Tab forward from where the keyboard is until `id` has focus (false: the keyboard never got there). */
async function tabTo(page: Page, id: string) {
  for (let i = 0; i < 120; i++) {
    if ((await focused(page)) === id) return true;
    await page.keyboard.press("Tab");
  }
  return false;
}

test("download recovery survives tracker and error-callout chunk failures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install();
  const downloads = await holdChunks(page, [TRACKER, PLACEMENT, ERROR_NOTICE]);
  try {
    await open(page);
    await pauseClock(page);
    await expect.poll(() => downloads.count(TRACKER)).toBe(1);
    const play = page.getByTestId("live-play");
    await play.focus();
    // The connection drops: detection fails, and so does every download the error notice could need.
    downloads.fail = true;
    downloads.release();
    const notice = page.getByTestId("trouble-download-error");
    const retry = page.getByTestId("trouble-download-retry");
    await expect(retry).toBeVisible();
    await expect(notice).toContainText("couldn't be downloaded");
    await expect(play).toBeFocused();
    // Its placement failed to download as well: it stands where the callout styles put it, styled and usable.
    await expect.poll(() => downloads.count(PLACEMENT)).toBeGreaterThan(0);
    await expect(notice).not.toHaveAttribute("data-placed", "");
    expect(await notice.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
    // The keyboard reaches Retry from the bar.
    expect(await tabTo(page, "trouble-download-retry")).toBe(true);
    await play.focus();
    // An export's notification, and every toast's expiry, leave the way back where it is.
    await exportDiagram(page);
    await expect(page.getByTestId("toast").first()).toBeVisible();
    // Past every toast's expiry in one jump: its timers fire, without stepping each frame.
    await page.clock.fastForward(10_000);
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect(retry).toBeVisible();
    expect(await focused(page)).not.toBe("BODY");
    // Back online: Retry, by keyboard, downloads both again and detection works.
    const before = { tracker: downloads.count(TRACKER), placement: downloads.count(PLACEMENT) };
    downloads.fail = false;
    await play.focus();
    expect(await tabTo(page, "trouble-download-retry")).toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => downloads.count(TRACKER)).toBeGreaterThan(before.tracker);
    await expect.poll(() => downloads.count(PLACEMENT)).toBeGreaterThan(before.placement);
    await expect(notice).toHaveCount(0);
    expect(await focused(page)).not.toBe("BODY");
    await killPartner(page);
    await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "down");
    await page.getByTestId("trouble-action").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    expect(await focused(page)).not.toBe("BODY");
    await exportDiagram(page);
  } finally {
    downloads.release();
  }
});

test("the breaker window uses whole seconds and explains fractional input", async ({ page, consoleErrors }) => {
  await open(page);
  await waitForCameraIdle(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-section-breaker-details").click();
  const window = page.getByTestId("inspector-field-breaker-windowMs");
  await expect(window).toHaveAttribute("min", "1");
  await expect(window).toHaveAttribute("max", "60");
  await window.fill("2.5");
  await expect(window).toHaveAttribute("aria-invalid", "true");
  const error = page.getByTestId("inspector-invalid-breaker-windowMs");
  await expect(error).toBeVisible();
  await expect(window).toHaveAttribute("aria-describedby", (await error.getAttribute("id")) ?? "");
  await window.fill("2");
  await expect(window).not.toHaveAttribute("aria-invalid", "true");
  await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller?.breaker?.windowMs).toBe(2000);
  await window.blur();
  await expect(window).toHaveValue("2");
  expectNoErrors(consoleErrors);
});
