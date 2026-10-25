import { test, expect, gotoLab, pauseClock } from "./fixtures";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  for (const contact of ["hover", "focus", "press"] as const) {
    test(`${contact}: Undo stays put across a notification and bar movement (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await gotoLab(page, "toast-interaction");
      await page.clock.install();
      await pauseClock(page);
      await page.getByTestId("toast-lab-first").click();
      const undo = page.getByTestId("toast-lab-undo");
      if (contact === "focus") await undo.focus();
      else await undo.hover();
      const before = await undo.boundingBox();
      if (!before) throw new Error("Expected Undo on screen");
      const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      if (contact === "press") await page.mouse.down();
      // An external notification arrives while the user's pointer/key/press remains on Undo.
      await page.getByTestId("toast-lab-next").evaluate((button: HTMLButtonElement) => button.click());
      await page.getByTestId("toast-lab-bar").evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByTestId("toast-lab-avoid")).toHaveCSS("bottom", "100px");
      // Advance placement and expiry together, proving neither can invalidate the engaged target.
      await page.clock.fastForward(7000);
      await expect(undo).toBeVisible();
      expect(await undo.boundingBox()).toEqual(before);
      await expect(page.getByTestId("toast")).toHaveAttribute("aria-live", "polite");
      if (reducedMotion === "reduce") await expect(page.getByTestId("toast")).toHaveCSS("animation-name", "none");
      if (contact === "focus") await page.keyboard.press("Enter");
      else if (contact === "press") await page.mouse.up();
      else await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId("toast-lab-undos")).toHaveText("1");
      await expect(page.getByTestId("toast")).toContainText("Second notification");
      // Released toasts follow the bar again; no permanent frozen stack or notification loss.
      await expect(page.getByTestId("toast")).toHaveCSS("bottom", "140px");
    });
  }
}
