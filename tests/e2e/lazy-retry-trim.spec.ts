import type { Page } from "@playwright/test";
import { resilienceFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  waitForCameraIdle,
  waitForStableViewport,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";
import { holdTraceRuntime, replayNode } from "./held-trace-runtime";

test("held runtime: failed load keeps the checkpoint and one Retry replays the pending node", async ({ page }) => {
  const runtime = await holdTraceRuntime(page, "&paused=1");
  try {
    await replayNode(page);
    const at = await page.getByTestId("live-canvas").getAttribute("data-sim-time");
    if (at === null) throw new Error("Missing requested replay state");
    runtime.fail = true;
    runtime.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(page.getByTestId("slowmo-loading")).toBeVisible();
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", at);
    runtime.fail = false;
    await page.getByTestId("lazy-load-retry").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
    await expect(page.getByTestId("lazy-load-retry")).toHaveCount(0);
    await page.getByTestId("trace-card-close").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  } finally {
    runtime.release();
  }
});

test("held runtime: Escape after failure removes Retry and retires its replay", async ({ page }) => {
  const runtime = await holdTraceRuntime(page, "&paused=1");
  try {
    await replayNode(page);
    runtime.fail = true;
    runtime.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("slowmo-loading")).toHaveCount(0);
    await expect(page.getByTestId("lazy-load-retry")).toHaveCount(0);
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  } finally {
    runtime.release();
  }
});

// PR #236's bundle trim. A Request's wait, timeout, pool and retry fields (src/canvas/inspector/CallWaitFields.tsx)
// are a chunk of their own, asked for when a Request's inspector opens; slow motion's painter
// (src/live/slowmo/painter.ts) downloads in the script's chunk. Each is held (and failed) here: keyboard focus,
// cursor and styles, and export hold while it downloads, after it arrives, and when it fails and Retry brings it.

/** A chunk's production file, or its source module on the dev server (as tests/e2e/lazy-live-fixes.spec.ts). */
const chunk = (name: string, source: string) =>
  new RegExp(String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js|${source.replace(/\./g, "\\.")})(?:\?.*)?$`);
const FIELDS = chunk("CallWaitFields", "src/canvas/inspector/CallWaitFields.tsx");
const SCRIPT = chunk("script", "src/live/slowmo/script.ts");

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
    if (control.fail) return route.abort("failed");
    await route.continue();
  });
  return control;
}

/** The retry lesson's Request (a `p3-w2` diagram), with its inspector open. */
async function openRequestInspector(page: Page) {
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: resilienceFixture(),
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
}

/** File ▸ More formats ▸ Diagram file: the download arrives. */
async function exportDiagram(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-json").click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  // The menu closes with the export (Esc here would also cancel a pending slow motion).
  await expect(page.getByTestId("file-more-formats")).toHaveCount(0);
}

const cursor = (page: Page) => page.evaluate(() => getComputedStyle(document.body).cursor);

test("held Request fields keep the inspector usable; once they arrive the keyboard carries on into them", async ({
  page,
  consoleErrors,
}) => {
  const fields = await gate(page, FIELDS);
  try {
    await openRequestInspector(page);
    // Asked for as the inspector opens, before the section is.
    await expect.poll(() => fields.requested()).toBe(true);
    // By keyboard: Enter opens the section; a polite status says the fields are on their way.
    const section = page.getByTestId("inspector-section-edge-simulation");
    await section.focus();
    await page.keyboard.press("Enter");
    await expect(section).toBeFocused();
    await expect(section).toHaveAttribute("aria-expanded", "true");
    const loading = page.getByTestId("call-fields-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("inspector-field-retries")).toHaveCount(0);
    // Tab moves on past the empty section, never stuck on it or lost to the page.
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && el !== document.body && el.getAttribute("data-testid") !== "inspector-section-edge-simulation";
      }),
    ).toBe(true);
    // Cursor and styles: nothing waits, and the inspector keeps its styles.
    expect(await cursor(page)).not.toMatch(/wait|progress/);
    const label = page.getByTestId("inspector-field-label");
    expect(await label.evaluate((el) => getComputedStyle(el).borderStyle)).toBe("solid");
    // Export works while the fields are held.
    await exportDiagram(page);
    await section.focus();
    fields.release();
    await expect(page.getByTestId("inspector-field-retries")).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(section).toBeFocused();
    expect(await cursor(page)).not.toMatch(/wait|progress/);
    expect(await label.evaluate((el) => getComputedStyle(el).borderStyle)).toBe("solid");
    // The keyboard carries on into the fields that arrived, in their order.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-wait-non-blocking")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-deadlineMs")).toBeFocused();
    await page.keyboard.press("Tab");
    // Waiting limits now keep pool/reply controls behind their own disclosure before Retries.
    await expect(page.getByTestId("inspector-section-call-advanced")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-retries")).toBeFocused();
    await exportDiagram(page);
    expectNoErrors(consoleErrors);
  } finally {
    fields.release();
  }
});

test("a failed Request fields download offers Retry by keyboard, which brings them and gives focus back", async ({
  page,
}) => {
  const fields = await gate(page, FIELDS);
  fields.fail = true;
  await openRequestInspector(page);
  // The inspector's preload fails silently: nothing to say until the fields are asked for, and export works.
  await expect.poll(() => fields.requested()).toBe(true);
  await expect(page.getByTestId("lazy-load-retry")).toHaveCount(0);
  await exportDiagram(page);
  // The download precedes its lazy success notification; settle it before asking for the failure toast.
  await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "success");
  const section = page.getByTestId("inspector-section-edge-simulation");
  await section.click();
  const retry = page.getByTestId("lazy-load-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("inspector-field-retries")).toHaveCount(0);
  // A download nobody's keyboard asked for doesn't take the focus to say it failed.
  await expect(section).toBeFocused();
  expect(await cursor(page)).not.toMatch(/wait|progress/);
  fields.fail = false;
  fields.release();
  await section.focus();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-retries")).toBeVisible();
  await expect(section).toBeFocused();
  // The retry policy the diagram saved shows: three attempts.
  await expect(page.getByTestId("inspector-field-retries")).toContainText("3");
});

test("slow motion's painter arrives with its script: the main-thread renderer draws captions once it does", async ({
  page,
  consoleErrors,
}) => {
  const script = await gate(page, SCRIPT);
  try {
    await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&renderer=main");
    const canvas = page.getByTestId("live-canvas");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-particles")), { timeout: 10_000 })
      .toBeGreaterThan(40);
    await waitForCameraIdle(page);
    await page.getByTestId("node-shopper").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click();
    await expect.poll(script.requested).toBe(true);
    // Waiting for the code: nothing is drawn over live, the keyboard stays where the menu left it.
    await expect(canvas).not.toHaveAttribute("data-slowmo", /./);
    const owner = await page.evaluateHandle(() => document.activeElement as HTMLElement);
    expect(await page.evaluate((el) => el !== document.body, owner)).toBe(true);
    expect(await cursor(page)).not.toMatch(/wait|progress/);
    await exportDiagram(page);
    await owner.focus();
    script.release();
    await expect(canvas).toHaveAttribute("data-slowmo", "playing");
    // The painter that came with the script draws the journey's captions.
    await expect
      .poll(async () => JSON.parse((await canvas.getAttribute("data-slowmo-captions")) ?? "[]").length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    expect(await page.evaluate((el) => el === document.activeElement, owner)).toBe(true);
    expect(await cursor(page)).not.toMatch(/wait|progress/);
    await exportDiagram(page);
    await owner.focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-play")).not.toHaveAttribute("data-state", "slowmo");
    expectNoErrors(consoleErrors);
  } finally {
    script.release();
  }
});
