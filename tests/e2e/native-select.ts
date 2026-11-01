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
  finished?: () => Promise<boolean>,
) {
  const select = page.getByTestId(id);
  // An optional action can finish while its owner hands focus to another surface.
  // Required selections still wait for the same exact native focus/open state.
  const waitFor = async (ready: () => Promise<boolean>) => {
    let done = false;
    await expect
      .poll(async () => {
        done = !!(await finished?.());
        return done || ready();
      })
      .toBe(true);
    return !done;
  };
  const focused = () =>
    select.evaluateAll((elements) => elements.length === 1 && elements[0] === document.activeElement);
  const open = (value: boolean) =>
    select.evaluateAll((elements, value) => elements.length === 1 && elements[0].matches(":open") === value, value);
  const press = async (key: string) => {
    if (await finished?.()) return false;
    await page.keyboard.press(key);
    return true;
  };
  if (!(await waitFor(focused))) return false;
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
      if (!(await press("Tab")) || !(await press("Shift+Tab")) || !(await waitFor(focused))) return false;
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
      for (const text of prefix) {
        if (await finished?.()) return false;
        await session.send("Input.dispatchKeyEvent", { type: "char", text });
      }
    } finally {
      await session.detach();
    }
  } else if (index === 0 || index === options.length - 1) {
    if (!(await press(index === 0 ? "Home" : "End"))) return false;
  } else {
    if (!(await press("Alt+ArrowDown")) || !(await waitFor(() => open(true))) || !(await press("Home"))) return false;
    await animationFrames(page);
    for (let i = 0; i < index; i++) {
      if (!(await press("ArrowDown"))) return false;
      await animationFrames(page);
    }
    if (!(await press("Enter")) || !(await waitFor(() => open(false)))) return false;
  }
  return !(await finished?.());
}
