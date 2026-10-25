import { test, expect, expectNoErrors, gotoCanvas, gotoLive, waitForStableViewport } from "./fixtures";

// Live uses the same property sheet as editing, without inline name editors.
const KAFKA = "kafka-order-pipeline";

test("live: nodes, boundaries and connections open their property sheet", async ({ page, consoleErrors }) => {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=4`);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  for (const target of ["node-order-events", "group-label-aks"]) {
    await waitForStableViewport(page);
    await page.getByTestId(target).dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeVisible();
    if (target === "node-order-events") {
      await expect(label).not.toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(0);
      await expect(page.getByTestId("rf__node-order-events")).toBeFocused();
    } else {
      await expect(label).toBeFocused();
    }
    await page.keyboard.press("Escape");
    // Live node Properties leaves focus on the canvas, so Escape clears its selection.
    if (target === "node-order-events") await page.getByTestId(target).click();
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

test("editing: double-click selects the name in the property sheet", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, KAFKA);
  await waitForStableViewport(page);
  await page.getByTestId("node-order-events").dblclick();
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toBeFocused();
  expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(
    (await label.inputValue()).length,
  );
  expectNoErrors(consoleErrors);
});
