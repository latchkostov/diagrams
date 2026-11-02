import { test, expect, gotoCanvas, waitForCameraIdle, expectNoErrors } from "./fixtures";
import { command, node } from "./keyboard-tutorial-driver";

for (const destination of ["orders", "payments"]) {
  test(`palette navigation to ${destination} dismisses quick-add and releases the camera`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, "kafka-order-pipeline");
    await node(page, "orders");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await command(page, `node:${destination}`, `@ ${destination}`);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
    await waitForCameraIdle(page);
    await expect(page.getByTestId(`rf__node-${destination}`)).toBeFocused();
    // The next canvas key belongs to the destination, with no hidden menu retaining it.
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
}
