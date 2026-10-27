import type { Page } from "@playwright/test";
import { chunk, holdChunk as gate, releaseAndEvaluate } from "./chunk";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  waitForCameraIdle,
  savedDiagram,
  expectNoErrors,
  openShareChooser,
} from "./fixtures";

// Live code that downloads on first use (PR #225's bundle trim): the thread-fix application ships in the trouble
// callout's chunk, and slow motion's script loads when slow motion first starts. Each chunk is held (and failed)
// here: keyboard focus, the cursor and styles, and export must hold while it downloads, after it arrives, and when
// it fails and Retry brings it.

const CALLOUT = chunk("TroubleCallout", "src/live/TroubleCallout.tsx");
const SCRIPT = chunk("script", "src/live/slowmo/script.ts");
const SLOW_READOUT = chunk("SlowTimeline", "src/live/slowmo/SlowTimeline.tsx");
const TIMELINE = chunk("Timeline", "src/live/Timeline.tsx");
const PLACEMENT = chunk("useFloatingPlacement", "src/live/useFloatingPlacement.ts");
const FILE_MESSAGES = chunk("fileMessages", "src/interop/ui/fileMessages.ts");
const PAYMENT = "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts";
const KAFKA = "./?view=canvas&example=kafka-order-pipeline&live=1";

test("slow-motion status and Escape work while its readout download is held", async ({ page }) => {
  const readout = await gate(page, SLOW_READOUT);
  try {
    await openKafka(page);
    await slowMotionFromStorefront(page);
    await expect.poll(readout.requested).toBe(true);
    await expect(page.getByTestId("slowmo-chip")).toContainText("live paused");
    await expect(page.getByTestId("slowmo-timeline")).toHaveCount(0);
    await expect(page.getByTestId("slowmo-chip")).toHaveAttribute("role", "status");
    expect(await focused(page)).not.toBe("BODY");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await releaseAndEvaluate(page, SLOW_READOUT, readout.release);
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["live.slow-timeline"]))
      .toEqual({ state: "loaded", active: false });
    await expect(page.getByTestId("slowmo-timeline")).toHaveCount(0);
    expect(await focused(page)).not.toBe("BODY");
  } finally {
    readout.release();
  }
});

test("a held simulation scrubber keeps its clock, focus and Escape working", async ({ page }) => {
  const timeline = await gate(page, TIMELINE);
  try {
    await gotoLive(page, PAYMENT);
    await expect.poll(timeline.requested).toBe(true);
    await expect(page.getByTestId("live-clock")).toBeVisible();
    await expect(page.getByTestId("live-timeline-input")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").focus();
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await releaseAndEvaluate(page, TIMELINE, timeline.release);
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["live.timeline"]))
      .toEqual({ state: "loaded", active: false });
    await expect(page.getByTestId("live-timeline-input")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  } finally {
    timeline.release();
  }
});

test("a failed simulation scrubber offers shared Retry without taking focus", async ({ page }) => {
  const timeline = await gate(page, TIMELINE);
  try {
    await gotoLive(page, PAYMENT);
    await expect.poll(timeline.requested).toBe(true);
    const owner = page.getByTestId("live-play");
    await owner.focus();
    await expect(owner).toBeFocused();
    await expect(page.getByTestId("live-timeline-input")).toHaveCount(0);
    timeline.fail = true;
    timeline.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(page.getByTestId("live-play")).toBeFocused();
    timeline.fail = false;
    timeline.release();
    await page.getByTestId("lazy-load-retry").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-timeline-input")).toBeVisible();
    await expect(page.getByTestId("live-play")).toBeFocused();
    await page.getByTestId("live-expectations-summary").click();
    await expect(page.getByTestId("live-expectations")).toBeVisible();
  } finally {
    timeline.release();
  }
});

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "BODY");

/** What the pointer and the bars look like: unchanged by a download in flight. */
const looks = (page: Page) =>
  page.evaluate(() => {
    const style = (id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { cursor: s.cursor, position: s.position, display: s.display, background: s.backgroundColor };
    };
    return { canvas: style("canvas-wrap"), bar: style("live-controls"), play: style("live-play") };
  });

/** File ▸ More formats ▸ Diagram file: the download arrives. */
async function exportDiagram(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-json").click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  // The notification's words download beside the file. Observe its publication before a caller expires toasts.
  await expect(page.getByTestId("toast")).toContainText("Exported");
}

/** The payment lesson run to its exhaustion (15 s) and paused by keyboard: focus on Play. */
async function exhaustPayment(page: Page) {
  await page.clock.install();
  await gotoLive(page, PAYMENT);
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  // Sample at 1, 3, ... 15 seconds instead of painting 900 frames under load. These two-second slices
  // retain trouble's ten-second trend window; a single jump would reset it. Keep UI round trips small too.
  for (let second = 1; second <= 15; second += 2) {
    await page.getByTestId("live-timeline-input").fill(String(second * 50));
    await page.getByTestId("live-play").focus();
  }
  await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "15000");
  await page.getByTestId("live-play").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
}

test("export readiness waits for a held confirmation before the toast clock advances", async ({ page }) => {
  const messages = await gate(page, FILE_MESSAGES);
  await page.clock.install();
  await gotoLive(page, PAYMENT);
  await pauseClock(page);
  const downloaded = page.waitForEvent("download");
  let complete = false;
  const exporting = exportDiagram(page).then(() => {
    complete = true;
  });
  try {
    await downloaded;
    await expect.poll(messages.requested).toBe(true);
    // The file arrived and the app stays usable while its confirmation waits on a separate chunk.
    await expect(page.getByTestId("file-more-formats")).toHaveCount(0);
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-more-formats")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("file-more-formats")).toHaveCount(0);
    expect(complete).toBe(false);
  } finally {
    messages.release();
    await exporting;
  }
  await page.clock.fastForward(10_000);
  await expect(page.getByTestId("toast")).toHaveCount(0);
});

test("a held trouble callout keeps focus, looks and export; once it arrives its fix applies by keyboard", async ({
  page,
  consoleErrors,
}) => {
  const callout = await gate(page, CALLOUT);
  await exhaustPayment(page);
  const before = await looks(page);
  await expect.poll(callout.requested).toBe(true);
  await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  await expect(page.getByTestId("live-play")).toBeFocused();
  expect(await looks(page)).toEqual(before);
  await exportDiagram(page);
  await page.getByTestId("live-play").focus();
  callout.release();
  const action = page.getByTestId("trouble-action");
  await expect(action).toHaveAttribute("data-action", "add-timeout");
  // The callout appears beside the work; it never takes the keyboard.
  await expect(page.getByTestId("live-play")).toBeFocused();
  expect(await looks(page)).toEqual(before);
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("timeout");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.pay?.caller?.deadlineMs)
    .toBe(600);
  await page.getByTestId("add-timeout-undo").focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.pay?.caller?.deadlineMs)
    .toBeUndefined();
  expect(await focused(page)).not.toBe("BODY");
  await exportDiagram(page);
  expectNoErrors(consoleErrors);
});

test("a failed trouble callout download offers Retry; Retry brings it and gives the keyboard back", async ({
  page,
}) => {
  const callout = await gate(page, CALLOUT);
  callout.fail = true;
  await exhaustPayment(page);
  await expect(page.getByTestId("toast")).toContainText("Part of the app couldn't be downloaded");
  // A callout nobody asked for doesn't take the keyboard to say it failed.
  await expect(page.getByTestId("live-play")).toBeFocused();
  callout.fail = false;
  callout.release();
  await page.getByTestId("lazy-load-retry").focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(100);
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
  await expect(page.getByTestId("live-play")).toBeFocused();
});

test("a failed trouble callout keeps a persistent Retry through toast expiry and export, then brings the callout", async ({
  page,
}) => {
  const callout = await gate(page, CALLOUT);
  const placement = await gate(page, PLACEMENT);
  callout.fail = true;
  placement.fail = true;
  await exhaustPayment(page);
  // In the callout's place: the notice, without taking the keyboard.
  const retry = page.getByTestId("trouble-download-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("live-play")).toBeFocused();
  await exportDiagram(page);
  // Past every toast's expiry in one jump: its timers fire, without stepping each frame.
  await page.clock.fastForward(10_000);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(retry).toBeVisible();
  expect(await focused(page)).not.toBe("BODY");
  // Back online: Retry by keyboard brings the callout, and the keyboard stays on the page.
  callout.fail = false;
  placement.fail = false;
  callout.release();
  placement.release();
  await retry.focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(100);
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
  await expect(page.getByTestId("trouble-download-error")).toHaveCount(0);
  expect(await focused(page)).not.toBe("BODY");
  await exportDiagram(page);
});

/** Kafka in free play, traffic flowing. */
async function openKafka(page: Page) {
  await gotoLive(page, KAFKA);
  await expect
    .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")), {
      timeout: 10_000,
    })
    .toBeGreaterThan(40);
}

/** Slow motion from a node (the Storefront by default), chosen from its menu. */
async function slowMotionFromStorefront(page: Page, node = "shopper") {
  await waitForCameraIdle(page);
  await page.getByTestId(`node-${node}`).click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
}

test("slow motion waits for its script with focus, looks and export intact, then starts", async ({
  page,
  consoleErrors,
}) => {
  const script = await gate(page, SCRIPT);
  await openKafka(page);
  const before = await looks(page);
  await slowMotionFromStorefront(page);
  await expect.poll(script.requested).toBe(true);
  // Waiting for the code: live paused where it was asked, no replay yet, the keyboard where the menu left it.
  await expect(page.getByTestId("live-play")).toBeDisabled();
  await expect(page.getByTestId("live-canvas")).not.toHaveAttribute("data-slowmo", /./);
  // The node the menu was opened on keeps the keyboard (its test id changes while hovered, so hold the element).
  expect(await focused(page)).not.toBe("BODY");
  const owner = await page.evaluateHandle(() => document.activeElement as HTMLElement);
  const ownerFocused = () => page.evaluate((el) => el === document.activeElement, owner);
  expect((await looks(page)).canvas).toEqual(before.canvas);
  await exportDiagram(page);
  await expect(page.getByTestId("live-canvas")).not.toHaveAttribute("data-slowmo", /./);
  await owner.focus();
  script.release();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
  expect(await ownerFocused()).toBe(true);
  expect((await looks(page)).canvas).toEqual(before.canvas);
  await exportDiagram(page);
  await owner.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-play")).not.toHaveAttribute("data-state", "slowmo");
  expectNoErrors(consoleErrors);
});

test("a failed slow-motion download returns to live with a focused Retry that starts it and gives focus back", async ({
  page,
}) => {
  await page.clock.install();
  const script = await gate(page, SCRIPT);
  script.fail = true;
  await openKafka(page);
  await pauseClock(page);
  await slowMotionFromStorefront(page);
  const retry = page.getByTestId("lazy-load-retry");
  await expect(page.getByTestId("toast")).toContainText("Part of the app couldn't be downloaded");
  await expect(retry).toBeFocused();
  await expect(page.getByTestId("live-play")).toBeEnabled();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  script.fail = false;
  script.release();
  const retryClock = await page.evaluate(() => performance.now());
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => performance.now()), "Retry assertions run on the held replay clock").toBe(
    retryClock,
  );
  // Capture and focus handoff yield through animation frames; advance them explicitly.
  await expect
    .poll(async () => {
      await page.clock.runFor(250);
      return page.getByTestId("live-canvas").getAttribute("data-slowmo");
    })
    .toBe("playing");
  expect(Number(await page.getByTestId("live-canvas").getAttribute("data-slowmo-progress"))).toBeLessThan(1000);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo-machine", "playing");
  expect(await focused(page)).not.toBe("BODY");
  // Pin both ends of the race: Retry starts at the beginning while the clock is held.
  // Seek to the final fraction, then let the replay clock actually cross its last beat.
  await page.getByTestId("slowmo-timeline-input").fill("999");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo-machine", "playing");
  await page.clock.runFor(1_000);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo-progress", "1000");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo-machine", "finished");
});

test("pending script download freezes live controls and says so; Esc gives them back", async ({ page }) => {
  const script = await gate(page, SCRIPT);
  await gotoLive(page, `${KAFKA}&sim=payments-outage&speed=8`);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  const at = (await page.getByTestId("live-canvas").getAttribute("data-sim-time")) ?? "";
  // The note frames Payments: slow motion from there.
  await slowMotionFromStorefront(page, "payments");
  await expect.poll(script.requested).toBe(true);
  const loading = page.getByTestId("slowmo-loading");
  await expect(loading).toHaveAttribute("role", "status");
  await expect(loading).toContainText("Loading slow motion");
  await expect(loading).toContainText("Esc to cancel");
  // The note's Continue and the Enter key would pass the note: both wait with live.
  await page.getByTestId("live-note-continue").click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("live-play")).toBeDisabled();
  // The bar shows the wait in the clock's place; the frozen simulation time is the canvas's.
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", at);
  // Esc cancels the wait: live is back, its Continue works again.
  await page.keyboard.press("Escape");
  await expect(loading).toHaveCount(0);
  await expect(page.getByTestId("live-play")).toBeEnabled();
  await page.getByTestId("live-note-continue").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  // The cancelled start's code arrives later: wait for it to download, run and paint, and slow motion stays off.
  const downloaded = page.waitForResponse((response) => SCRIPT.test(response.url()));
  script.release();
  const module = await downloaded;
  expect(await module.finished()).toBeNull();
  // Network completion precedes module evaluation and the cancelled start's continuation.
  await page.evaluate(async (url) => {
    await import(url);
  }, module.url());
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.getByTestId("live-canvas")).not.toHaveAttribute("data-slowmo", /./);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await expect(page.getByTestId("slowmo-loading")).toHaveCount(0);
  await expect(page.getByTestId("live-play")).toBeEnabled();
});

test("a slow-motion download failing behind a dialog leaves the dialog the keyboard; Retry waits for it", async ({
  page,
}) => {
  const script = await gate(page, SCRIPT);
  await openKafka(page);
  await slowMotionFromStorefront(page);
  await expect(page.getByTestId("slowmo-loading")).toBeVisible();
  await openShareChooser(page);
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="share-chooser"]'));
  await expect.poll(inDialog).toBe(true);
  script.fail = true;
  script.release();
  const retry = page.getByTestId("lazy-load-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("slowmo-loading")).toHaveCount(0);
  expect(await inDialog()).toBe(true);
  await expect(retry).not.toBeFocused();
  // Pressed while the dialog is open, Retry waits for it to close.
  script.fail = false;
  await retry.click();
  await expect.poll(inDialog).toBe(true);
  await expect(page.getByTestId("live-canvas")).not.toHaveAttribute("data-slowmo", /./);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
  expect(await focused(page)).not.toBe("BODY");
});

for (const locale of ["en", "en-XA"]) {
  test(`the loading status leaves More in the bar at every width (${locale})`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await page.setViewportSize({ width: 1280, height: 800 });
    const script = await gate(page, SCRIPT);
    await openKafka(page);
    await slowMotionFromStorefront(page);
    const loading = page.getByTestId("slowmo-loading");
    await expect(loading).toBeVisible();
    for (const width of [1280, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const more = await page.getByTestId("live-more").boundingBox();
      const bar = await page.getByTestId("live-controls").boundingBox();
      if (!more || !bar) throw new Error(`No bar at ${width} px`);
      expect(more.x).toBeGreaterThanOrEqual(bar.x);
      expect(more.x + more.width).toBeLessThanOrEqual(Math.min(bar.x + bar.width, width) + 0.5);
      // The status stays whole for screen readers, however little of it fits on screen.
      await expect(loading).toHaveAttribute("role", "status");
      await expect(loading).toContainText("Esc to cancel");
    }
    script.release();
  });
}
