import { test, expect, expectNoErrors, gotoLive } from "./fixtures";

// Live is a viewing mode: double-click and F2 never open a name editor.
const KAFKA = "kafka-order-pipeline";

test("live: nodes, boundaries and connections open no editor", async ({ page, consoleErrors }) => {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=4`);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  for (const target of ["node-order-events", "group-label-aks"]) {
    await page.getByTestId(target).dblclick();
    await page.keyboard.press("F2");
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
    await expect(page.getByTestId("node-editor")).toHaveCount(0);
  }
  await page
    .getByTestId(/^edge-label-/)
    .first()
    .dblclick();
  await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
  await expect(page.getByTestId("edge-label-input")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
