import { test, expect, expectNoErrors, gotoLive, waitForStableViewport } from "./fixtures";

// Live uses the same property sheet as editing, without inline name editors.
const KAFKA = "kafka-order-pipeline";

test("live: nodes, boundaries and connections open their property sheet", async ({ page, consoleErrors }) => {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=4`);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  for (const target of ["node-order-events", "group-label-aks"]) {
    await waitForStableViewport(page);
    await page.getByTestId(target).dblclick();
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("F2");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("node-editor")).toHaveCount(0);
  }
  await waitForStableViewport(page);
  await page
    .getByTestId(/^edge-label-/)
    .first()
    .dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("edge-label-input")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
