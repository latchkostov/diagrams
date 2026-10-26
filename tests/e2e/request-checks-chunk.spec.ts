import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport } from "./fixtures";
import { waitForBackgroundChecks } from "./checks-readiness";

// The request-check store (src/lib/requestCheckCache.ts) is a chunk of its own, loaded with the first check: never
// at startup or with the canvas. While it downloads, and when its download fails, the editor stays as it was:
// keyboard focus, cursor and styles, export. The checks arrive once it does, and a failed download is retried by
// the next check without moving focus.

const STORE = /\/(?:assets\/requestCheckCache-[A-Za-z0-9_-]+\.js|src\/lib\/requestCheckCache\.ts)(?:\?.*)?$/;

/** Holds every request for the store until release(); `fail` aborts them while it's true. */
async function gate(page: Page) {
  let requested = false;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = { fail: false, requested: () => requested, release };
  await page.route(STORE, async (route) => {
    requested = true;
    if (control.fail) return route.abort("failed");
    await open;
    await route.continue();
  });
  return control;
}

test("a held request-check store keeps the editor usable, and the checks arrive after it", async ({
  page,
  consoleErrors,
}) => {
  const store = await gate(page);
  try {
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    // The first check asks for the store; nothing shows a warning until it arrives.
    await expect.poll(() => store.requested()).toBe(true);
    await expect(page.getByTestId("checks-warning-badge")).toHaveCount(0);
    // Keyboard focus: the inspector takes it and Tab moves on.
    await page.getByTestId("node-caller").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    // Cursor and styles: nothing waits, and the card keeps its styles.
    expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
    expect(await label.evaluate((el) => getComputedStyle(el).borderStyle)).toBe("solid");
    // Export still works.
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("image-export").click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    // The download completes, with an SVG of this diagram in it, while the store is still held.
    expect(await download.failure()).toBeNull();
    const svg = readFileSync(await download.path(), "utf8");
    expect(svg).toMatch(/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/);
    expect(svg).toContain("Decision service");
    expect(store.requested()).toBe(true);
    await page.keyboard.press("Escape");
    await label.focus();
    await label.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 7));
    store.release();
    await waitForBackgroundChecks(page);
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await expect(label).toBeFocused();
    expect(await label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([2, 7]);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-sublabel")).toBeFocused();
    expectNoErrors(consoleErrors);
  } finally {
    store.release();
  }
});

test("a failed request-check store download offers Retry by keyboard, and the checks follow", async ({ page }) => {
  const store = await gate(page);
  store.fail = true;
  await gotoCanvas(page, "blocking-call");
  await expect.poll(() => store.requested()).toBe(true);
  // The Checks card needs the store too: its download fails where it was asked for, with Retry.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("Check diagram");
  await page.getByTestId("command-input").press("Enter");
  const retry = page.getByTestId("lazy-load-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("checks-card")).toHaveCount(0);
  // Back online: from the canvas, the keyboard reaches Retry; it opens the card and gives focus back to the canvas.
  store.fail = false;
  store.release();
  const canvas = page.getByTestId("canvas-wrap");
  await canvas.focus();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("checks-card")).toBeVisible();
  await expect(canvas).toBeFocused();
  // Retry runs the background check that failed too: its warnings show without an edit.
  await waitForBackgroundChecks(page);
  await expect(page.getByTestId("checks-summary")).toBeVisible();
  await expect(canvas).toBeFocused();
});
