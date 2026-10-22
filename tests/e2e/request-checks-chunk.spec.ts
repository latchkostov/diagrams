import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport } from "./fixtures";

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
    await expect(page.getByTestId("checks-count")).toHaveCount(0);
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
    expect((await downloaded).suggestedFilename()).toMatch(/\.svg$/);
    await page.keyboard.press("Escape");
    store.release();
    await expect(page.getByTestId("checks-count")).toBeVisible();
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
  // The background check that failed runs again with the next one (as after an edit), and its warnings show.
  await page.evaluate(() => (window as unknown as { __checks: { flush(): void } }).__checks.flush());
  await expect(page.getByTestId("checks-summary")).toBeVisible();
  await expect(canvas).toBeFocused();
});
