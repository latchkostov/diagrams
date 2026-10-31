import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Keep the keyboard with the native popup instead of refocusing its DOM owner between keys. */
export async function openNativeSelect(page: Page, select: Locator) {
  await expect(select).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
}
