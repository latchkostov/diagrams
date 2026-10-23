import type { Page } from "@playwright/test";
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

/** A chunk's production file, or its source module on the dev server (as tests/e2e/lazy-loading.spec.ts). */
const chunk = (name: string, source: string) =>
  new RegExp(String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js|${source.replace(/\./g, "\\.")})(?:\?.*)?$`);
const CALLOUT = chunk("TroubleCallout", "src/live/TroubleCallout.tsx");
const SCRIPT = chunk("script", "src/live/slowmo/script.ts");
const PLACEMENT = chunk("useFloatingPlacement", "src/live/useFloatingPlacement.ts");
const PAYMENT = "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts";
const KAFKA = "./?view=canvas&example=kafka-order-pipeline&live=1";

/** Holds every request for `pattern` until release(); `fail` aborts them while it's true. */
async function gate(page: Page, pattern: RegExp) {
  let held = false;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = { fail: false, requested: () => held, release };
  await page.route(pattern, async (route) => {
    held = true;
    if (control.fail) return route.abort("failed");
    await open;
    // Failed while held: the download that was waiting fails too.
    if (control.fail) return route.abort("failed");
    await route.continue();
  });
  return control;
}

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
}

/** The payment lesson run to its exhaustion (15 s) and paused by keyboard: focus on Play. */
async function exhaustPayment(page: Page) {
  await page.clock.install();
  await gotoLive(page, PAYMENT);
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(15000);
  await page.getByTestId("live-play").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
}

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
  await page.clock.runFor(10_000);
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
  const script = await gate(page, SCRIPT);
  script.fail = true;
  await openKafka(page);
  await slowMotionFromStorefront(page);
  const retry = page.getByTestId("lazy-load-retry");
  await expect(page.getByTestId("toast")).toContainText("Part of the app couldn't be downloaded");
  await expect(retry).toBeFocused();
  await expect(page.getByTestId("live-play")).toBeEnabled();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  script.fail = false;
  script.release();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
  expect(await focused(page)).not.toBe("BODY");
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
