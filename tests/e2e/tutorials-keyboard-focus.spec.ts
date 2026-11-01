import { test, expect, gotoCanvas } from "./fixtures";
import { focus, node } from "./keyboard-tutorial-driver";

test("keyboard focus waits for an open quick-add menu's focus handoff", async ({ page }) => {
  await gotoCanvas(page, "kafka-order-pipeline");
  await node(page, "payments");
  const canvas = page.getByTestId("canvas-wrap");
  await page.evaluate(() => {
    const original = HTMLElement.prototype.focus;
    const pending: (() => void)[] = [];
    const hold = (window.__keyboardFocusHold = {
      pending: false,
      release() {
        HTMLElement.prototype.focus = original;
        for (const move of pending.splice(0)) move();
        delete window.__keyboardFocusHold;
      },
    });
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (this.getAttribute("data-testid") === "quick-add-search") {
        hold.pending = true;
        pending.push(() => original.call(this, options));
      } else original.call(this, options);
    };
  });
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => page.evaluate(() => window.__keyboardFocusHold?.pending)).toBe(true);
  const locate = page.getByTestId.bind(page);
  let observed = false;
  page.getByTestId = (...args) => {
    if (args[0] === "canvas-wrap") observed = true;
    return locate(...args);
  };
  const moving = focus(page, "quick-add-search");
  try {
    await expect.poll(() => observed).toBe(true);
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    await moving;
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await expect(canvas).toHaveAttribute("data-interaction-state", "menu-open");
  } finally {
    page.getByTestId = locate;
    await page.evaluate(() => window.__keyboardFocusHold?.release());
    await moving.catch(() => {});
  }
});
