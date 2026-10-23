import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport, waitForLiveSession } from "./fixtures";

// Also run by tests/engines/canvas.config.ts in Firefox and WebKit against the production e2e build.
for (const finish of ["Escape", "Go live"] as const) {
  test(`click a source handle then ${finish} without TouchEvent`, async ({ page, consoleErrors }) => {
    await page.addInitScript(() => Object.defineProperty(window, "TouchEvent", { value: undefined }));
    await gotoCanvas(page, "kafka-order-pipeline");
    await waitForStableViewport(page);
    await page.getByTestId("handle-orders-right").click();
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
    if (finish === "Escape") await page.keyboard.press("Escape");
    else {
      await page.getByTestId("live-toggle").click();
      await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
      await waitForLiveSession(page);
      await expect(page.getByTestId("live-controls")).toBeVisible();
    }
    await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-interaction-state", "gesture");
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("error-boundary")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
}
