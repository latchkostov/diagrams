import { test, expect, gotoCanvas, waitForCameraIdle } from "./fixtures";

test("the first-visit hint leaves the Workbench view controls and minimap clear", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("checks-count").click();
  await waitForCameraIdle(page);
  const hint = await page.getByTestId("first-run-hint").boundingBox();
  expect(hint).not.toBeNull();
  for (const id of ["canvas-controls", "canvas-minimap"]) {
    const control = await page.getByTestId(id).boundingBox();
    expect(control).not.toBeNull();
    if (!hint || !control) throw new Error("Missing first-visit chrome");
    expect(
      hint.x < control.x + control.width &&
        hint.x + hint.width > control.x &&
        hint.y < control.y + control.height &&
        hint.y + hint.height > control.y,
    ).toBe(false);
  }
  await page.getByTestId("view-focus").click();
  await expect(page.getByTestId("view-focus")).toHaveAttribute("aria-pressed", "true");
});
