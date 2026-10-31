import process from "node:process";
import { expect, type Page } from "@playwright/test";
import { animationFrames } from "./fixtures";

/** macOS popup menus live outside CDP; closed-select typeahead is a native keyboard path. */
export async function chooseNativeSelect(page: Page, id: string, value: string) {
  const select = page.getByTestId(id);
  await expect(select).toBeFocused();
  const options = await select.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options)
      .filter((option) => !option.disabled)
      .map((option) => ({ value: option.value, label: option.label })),
  );
  const index = options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  if (process.platform === "darwin") {
    await page.keyboard.type(options[index].label);
  } else if (index === 0 || index === options.length - 1) {
    await page.keyboard.press(index === 0 ? "Home" : "End");
  } else {
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => select.evaluate((el) => el.matches(":open"))).toBe(true);
    await page.keyboard.press("Home");
    await animationFrames(page);
    for (let i = 0; i < index; i++) {
      await page.keyboard.press("ArrowDown");
      await animationFrames(page);
    }
    await page.keyboard.press("Enter");
    await expect.poll(() => select.evaluate((el) => el.matches(":open"))).toBe(false);
  }
}
