import { test, expect, gotoCanvas, openLibrary, waitForCameraIdle } from "./fixtures";

test("the library opens from Add, closes with Escape and remembers Pin open", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
  await openLibrary(page);
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "flyout");
  await expect(page.getByTestId("palette-search")).toBeFocused();
  await expect(page.getByTestId("palette-common")).toBeVisible();
  await expect(page.getByTestId("palette-common").getByTestId(/^palette-item-/)).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
  await expect(page.getByTestId("rail-add")).toBeFocused();
  await openLibrary(page);
  await page.getByTestId("palette-toggle").click();
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
  await page.reload();
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
  await page.getByTestId("palette-toggle").click();
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
});

test("rail keyboard navigation and annotations use the moved controls", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("rail-select").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("rail-add")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("rail-annotate")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette-annotate-note")).toBeVisible();
  await page.getByTestId("palette-annotate-note").click();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await expect(page.getByTestId("palette-annotate-flyout")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await waitForCameraIdle(page);
  await page.getByTestId("view-gallery").click();
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("canvas-wrap")).toBeVisible();
});
