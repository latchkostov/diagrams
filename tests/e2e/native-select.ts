import process from "node:process";
import { expect, type Page } from "@playwright/test";
import { animationFrames } from "./fixtures";

const lastTypeahead = new WeakMap<Page, string>();

/** macOS popup menus live outside CDP; closed-select typeahead is a native keyboard path. */
export async function chooseNativeSelect(
  page: Page,
  id: string,
  value: string,
  input: "platform" | "typeahead" = "platform",
) {
  const select = page.getByTestId(id);
  await expect(select).toBeFocused();
  const options = await select.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options)
      .filter((option) => !option.disabled)
      .map((option) => ({ value: option.value, label: option.label })),
  );
  const index = options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  if (process.platform === "darwin" || input === "typeahead") {
    // A second choice on the same focused select otherwise extends its native search prefix.
    // A real keyboard blur resets that session; keep the selection and return to the same control.
    if (lastTypeahead.get(page) === id) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(select).toBeFocused();
    }
    lastTypeahead.set(page, id);
    // Use the shortest unambiguous prefix: action selects can reset after each character.
    const label = Array.from(options[index].label.trimStart());
    let prefix = "";
    for (const character of label) {
      prefix += character;
      if (
        options.filter((option) => option.label.trimStart().toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
          .length === 1
      )
        break;
    }
    // keyboard.type uses insertText for non-US characters, which doesn't drive native typeahead.
    // A trusted printable char event follows the browser's default selection path in every alphabet.
    const session = await page.context().newCDPSession(page);
    try {
      for (const text of prefix) await session.send("Input.dispatchKeyEvent", { type: "char", text });
    } finally {
      await session.detach();
    }
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
