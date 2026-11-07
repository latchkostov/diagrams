import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { waitForThreadVerification } from "./thread-verification";

/** Stop at the observed herd while the real worker verifies Apply, as the cache feature specs do. */
export async function waitForTutorialCacheAction(page: Page, playing: (on: boolean) => Promise<void>) {
  const callout = page.getByTestId("trouble-callout");
  const action = page.getByTestId("trouble-action");
  for (let sample = 0; sample < 60; sample++) {
    await page.clock.runFor(500);
    if (!(await callout.count()) || (await callout.getAttribute("data-kind")) !== "cache-stampede") continue;
    await playing(false);
    await waitForThreadVerification(page);
    if ((await action.count()) && (await action.getAttribute("data-action")) === "cache") break;
    await playing(true);
  }
  await expect(callout).toHaveAttribute("data-kind", "cache-stampede");
  await expect(action).toHaveAttribute("data-action", "cache");
  await expect(action).toHaveText("One fetch per item");
  await expect(page.getByTestId("tutorial-coach")).toHaveAttribute("data-target", "trouble-action");
  await page.screenshot({ path: test.info().outputPath("cache-stampede-apply-coach.png") });
}
