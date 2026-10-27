import type { Page } from "@playwright/test";
import { expect, pauseClock } from "./fixtures";

/** An installed clock keeps exact-duration assertions independent of locator/encoder scheduling. */
export async function recordFor(page: Page, seconds: number, options: { countdown?: "frames" | "ticks" } = {}) {
  await pauseClock(page);
  await page.getByTestId("record-start").click();
  const countdown = page.getByTestId("record-countdown");
  for (const count of ["3", "2", "1"]) {
    await expect.poll(() => countdown.evaluate((el) => el.firstElementChild?.textContent?.trim())).toBe(count);
    if (options.countdown === "ticks") await page.clock.fastForward(1000);
    else await page.clock.runFor(1000);
  }
  await expect(page.getByTestId("record-indicator")).toBeVisible();
  // The encoder starts two frames after the countdown leaves the screen.
  await page.clock.runFor(50);
  await page.clock.runFor(seconds * 1000);
}
