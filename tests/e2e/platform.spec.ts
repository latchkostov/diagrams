import {
  test,
  expect,
  gotoCanvas,
  waitForStableViewport,
  viewportTransform,
  pauseClock,
  waitForSelectionSettled,
} from "./fixtures";

// These inputs exercise application platform branches on every host. They cannot
// emulate macOS's native text editing; the native Nightly jobs cover that behavior.
for (const platform of ["MacIntel", "Win32"]) {
  test(`${platform}: native shortcut labels and literal ctrl+wheel pinch`, async ({ page }) => {
    await page.addInitScript((platform) => {
      Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value:
          platform === "MacIntel"
            ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36"
            : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36",
      });
      Object.defineProperty(navigator, "userAgentData", {
        configurable: true,
        value: { platform: platform === "MacIntel" ? "macOS" : "Windows" },
      });
    }, platform);
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect(page.getByTestId("palette")).toContainText(platform === "MacIntel" ? "⌘K" : "Ctrl+K");
    await waitForStableViewport(page);
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    if (!pane) throw new Error("No canvas");
    await page.mouse.move(pane.x + pane.width / 2, pane.y + 80);
    const zoom = async () => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
    const before = await zoom();
    // Literal Control models trackpad pinch; Command is not the pinch modifier.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -40);
    await page.keyboard.up("Control");
    await expect.poll(async () => await zoom()).toBeGreaterThan(before);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-input")).toBeFocused();
  });
}

for (const locale of ["en", "ar"]) {
  test(`rapid quick-add stays beside its outline after the deferred Inspector reveal (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await page.clock.install();
    await gotoCanvas(page, "kafka-order-pipeline");
    await waitForStableViewport(page);
    await pauseClock(page);
    await page.getByTestId("node-payments").click();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("landing-outline")).toBeVisible();
    await page.clock.runFor(1000);
    await waitForStableViewport(page);
    const outline = await page.getByTestId("landing-outline").boundingBox();
    const menu = await page.getByTestId("quick-add").boundingBox();
    if (!outline || !menu) throw new Error("Missing quick-add geometry");
    expect(menu.x).toBeGreaterThanOrEqual(outline.x + outline.width);
  });
}

test("zoom to selection wins over a deferred Inspector reveal", async ({ page }) => {
  await page.clock.install();
  await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
  const zoom = async () => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
  const before = await zoom();
  await pauseClock(page);
  await page.getByTestId("node-stock-db").click();
  await page.keyboard.press("Shift+Digit2");
  await page.clock.resume();
  await waitForSelectionSettled(page);
  const canvas = page.getByTestId("canvas-wrap");
  await expect(canvas).toHaveAttribute("data-fit-pending", "false");
  await waitForStableViewport(page);
  expect(await zoom()).toBeGreaterThan(before * 1.5);
  expect(await zoom()).toBeCloseTo(1.25, 2);
  const pane = await canvas.boundingBox();
  const node = await page.getByTestId("node-stock-db").boundingBox();
  if (!pane || !node) throw new Error("Missing selection geometry");
  expect(node.x).toBeGreaterThanOrEqual(pane.x);
  expect(node.y).toBeGreaterThanOrEqual(pane.y);
  expect(node.x + node.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(node.y + node.height).toBeLessThanOrEqual(pane.y + pane.height);
});
