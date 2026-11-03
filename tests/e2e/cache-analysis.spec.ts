import { test, expect, gotoCanvas, waitForSelectionSettled } from "./fixtures";

test("Expected origin demand follows coalescing while fresh hits and TTL stay fixed", async ({ page }) => {
  await gotoCanvas(page, "cache-stampede");
  await page.getByTestId("node-cdn").click();
  await waitForSelectionSettled(page);
  await page.getByTestId("cache-rule-launch-expires-toggle").click();
  const expected = page.getByTestId("cache-rule-launch-expected");
  const before = await expected.textContent();
  await page.getByTestId("cache-rule-launch-coalesce").check();
  await expect(expected).toContainText("0.19/s reach Product API");
  await page.getByTestId("undo-button").click();
  await expect(expected).toHaveText(before ?? "");
});
