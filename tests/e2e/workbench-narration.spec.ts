import { test, expect, gotoLive, waitForCameraIdle } from "./fixtures";

test("retry narration follows and opens the service named by its status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
  await page.getByTestId("live-play").click();
  // Observe a running scenario, so the trouble watcher sees the retry window rather than a seek reset.
  await page.waitForFunction(
    () =>
      Number((document.querySelector('[data-testid="live-timeline-input"]') as HTMLInputElement | null)?.value ?? 0) >=
      100,
  );
  await expect(page.getByTestId("trouble-callout")).toHaveAttribute("data-kind", "retry-storm");
  await page.getByTestId("live-play").click();
  await page.getByTestId("live-view-menu").click();
  await page.getByTestId("view-follow").click();
  await waitForCameraIdle(page);
  const frame = await page.getByTestId("canvas-wrap").boundingBox();
  if (!frame) throw new Error("Expected canvas frame");
  const pills = page.getByTestId(/^call-pill-/);
  expect(await pills.count()).toBeGreaterThan(0);
  for (const pill of await pills.all()) {
    if (!(await pill.isVisible())) continue;
    const box = await pill.boundingBox();
    if (!box) throw new Error("Expected visible call annotation");
    expect(box.x).toBeGreaterThanOrEqual(frame.x + 28);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width - 28);
  }
  await expect(page.getByTestId("live-note-details")).toContainText("Payments details");
  await expect(page.getByTestId("node-payments")).toBeVisible();
  await page.getByTestId("live-note-details").click();
  await expect(page.getByTestId("dock-live-identity")).toContainText("Payments");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-sheet-snap", "half");
  await expect(page.getByTestId("live-view-menu")).toContainText("Following");
});
