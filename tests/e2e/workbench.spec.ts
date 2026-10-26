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

test("Properties, Checks and AI share one dock and Escape returns from Checks", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("checks-count").click();
  await expect(page.getByTestId("checks-card")).toBeVisible();
  await expect(page.getByTestId("inspector").getByTestId("checks-card")).toHaveCount(1);
  await page.getByTestId("dock-tab-checks").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("dock-tab-ai").click();
  await expect(page.getByTestId("inspector").getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-rail-open")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  expect((await page.getByTestId("inspector").boundingBox())?.width).toBe(0);
  await expect(page.getByTestId("inspector-toggle")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector").getByTestId("ai-panel")).toBeVisible();
});

test("a new selection waits for pointer-up before reopening the dock", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("dock-tab-properties")).toBeVisible();
  await page.getByTestId("inspector-toggle").click();
  await waitForCameraIdle(page);
  await page.getByTestId("fit-view-button").click();
  await waitForCameraIdle(page);
  const box = await page.getByTestId("node-checkout").boundingBox();
  if (!box) throw new Error("Checkout is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await page.mouse.up();
  await expect(page.getByTestId("dock-tab-properties")).toBeVisible();
});

test("the bezel switches Edit and Live and keeps history controls", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  const bezel = page.getByTestId("topbar");
  await expect(bezel.getByTestId("diagram-title")).toHaveText("A retry storm");
  await expect(bezel.getByTestId("undo-button")).toBeDisabled();
  await expect(bezel.getByTestId("redo-button")).toBeDisabled();
  await expect(page.getByTestId("mode-edit")).toHaveAttribute("aria-pressed", "true");
  await bezel.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(bezel.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
  await bezel.getByTestId("mode-edit").click();
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await page.getByTestId("canvas-wrap").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("l");
  await expect(bezel.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
});

test("View offers explicit themes and Match system follows device changes without losing Pin open", async ({
  page,
}) => {
  await gotoCanvas(page, "retry-storm");
  await openLibrary(page);
  await page.getByTestId("palette-toggle").click();
  await page.getByTestId("view-button").click();
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-system").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await page.reload();
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
});
