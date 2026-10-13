import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, expectNoErrors } from "./fixtures";

// Presenting, full screen: the button beside Exit presentation, F, the browser's own exit, and Esc's order.
// Headless Chromium has the Fullscreen API; the state is read from document.fullscreenElement.

const KAFKA = "kafka-order-pipeline";

const fullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement);

async function present(page: Page) {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
}

test.describe("presenting full screen", () => {
  test("the button enters and leaves full screen, and says which it does", async ({ page, consoleErrors }) => {
    await present(page);
    const button = page.getByTestId("present-fullscreen");
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(button).toHaveAttribute("aria-keyshortcuts", "F");
    expect(await fullscreen(page)).toBe(false);

    await button.click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(button).toHaveAccessibleName("Exit full screen");
    await expect(button).toHaveAttribute("data-state", "on");
    // Still presenting, with the diagram on screen.
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("node-shopper")).toBeInViewport();

    await button.click();
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(page.getByTestId("present-exit")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("F toggles it, only while presenting", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    // Editing: F is no shortcut, and there's no button.
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("f");
    // A key after it that does something: by the time it has, an F that went full screen would have too.
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toContainText("Presenting: full screen, or back");
    expect(await fullscreen(page)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
    await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);

    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "on");
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "off");
  });

  test("the button follows a full screen left outside it", async ({ page }) => {
    await present(page);
    const button = page.getByTestId("present-fullscreen");
    await button.click();
    await expect(button).toHaveAttribute("data-state", "on");
    // As the browser's own exit does (F11, its "Exit full screen" bar): the page didn't ask through the button.
    await page.evaluate(() => document.exitFullscreen());
    await expect(button).toHaveAttribute("data-state", "off");
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(page.getByTestId("present-exit")).toBeVisible();
  });

  test("Esc leaves full screen first, and only the next Esc leaves the presentation", async ({ page }) => {
    await present(page);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "off");
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page).toHaveURL(/present=1/);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page).not.toHaveURL(/present=1/);
  });

  test("leaving the presentation leaves full screen", async ({ page }) => {
    await present(page);
    await page.getByTestId("present-fullscreen").click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await page.getByTestId("present-exit").click();
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect.poll(() => fullscreen(page)).toBe(false);

    // And by going back in history, which leaves the presentation without a click.
    await page.getByTestId("present-toggle").click();
    await page.getByTestId("present-fullscreen").click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await page.goBack();
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect.poll(() => fullscreen(page)).toBe(false);
  });

  test("live view keeps running full screen", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&present=1`);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    const processed = async () => Number(await page.getByTestId("node-badge-orders").getAttribute("data-processed"));
    const before = await processed();
    await expect.poll(processed, { timeout: 10_000 }).toBeGreaterThan(before);
  });

  test("no button, and F does nothing, where the browser can't go full screen", async ({ page }) => {
    // As in an iframe without allow="fullscreen", or iOS Safari.
    await page.addInitScript(() =>
      Object.defineProperty(Document.prototype, "fullscreenEnabled", { configurable: true, get: () => false }),
    );
    await present(page);
    await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);
    // (Chromium would still go full screen if asked: an F that asked would make the Esc below leave full screen
    // instead of the presentation.)
    await page.keyboard.press("f");
    // Esc still leaves the presentation in one press.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topbar")).toBeVisible();
    expect(await fullscreen(page)).toBe(false);
  });
});
