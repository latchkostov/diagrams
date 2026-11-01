import { test, expect, gotoCanvas, waitForCameraIdle, expectNoErrors } from "./fixtures";

test("a phone selection stays above Properties and keeps the next canvas key", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCanvas(page, "partitions-vs-subscriptions");
  await waitForCameraIdle(page);
  const node = page.getByTestId("node-receipts");
  await node.click();
  await expect(page.getByTestId("inspector")).toBeVisible();
  await waitForCameraIdle(page);
  await expect(node).toBeVisible();
  const card = await node.boundingBox();
  const sheet = await page.getByTestId("inspector").boundingBox();
  if (!card || !sheet) throw new Error("Expected the selected card and Properties sheet");
  expect(card.y + card.height).toBeLessThanOrEqual(sheet.y);
  await expect(page.getByTestId("rf__node-receipts")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  expectNoErrors(consoleErrors);
});
