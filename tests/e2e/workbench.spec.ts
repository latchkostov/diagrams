import { test, expect, gotoCanvas, openLibrary, openDiagramProperties, waitForCameraIdle } from "./fixtures";

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
  await expect(bezel.getByTestId("live-toggle")).toHaveAttribute("aria-busy", "false");
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

test("the bezel owns the title and Diagram properties owns the description and checks link", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await expect(page.getByTestId("diagram-card")).toHaveCount(0);
  await expect(page.getByTestId("topbar").getByTestId("diagram-title")).toHaveText("A retry storm");
  await openDiagramProperties(page);
  await expect(page.getByTestId("diagram-description")).toContainText("Payments");
  await expect(page.getByTestId("inspector-field-title")).toHaveValue("A retry storm");
  await page.getByTestId("diagram-checks-summary").click();
  await expect(page.getByTestId("dock-tab-checks")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("checks-card")).toBeVisible();
});

test("Diagram properties offers checks only while checks are available", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await openDiagramProperties(page);
  await expect(page.getByTestId("diagram-checks-summary")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await openDiagramProperties(page);
  await expect(page.getByTestId("diagram-checks-summary")).toHaveCount(0);
});

test("phone playback sits below the tool rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("live-toggle").click();
  const bar = await page.getByTestId("live-controls").boundingBox();
  const rail = await page.getByTestId("tool-rail").boundingBox();
  expect(bar).not.toBeNull();
  expect(rail).not.toBeNull();
  if (!bar || !rail) throw new Error("Expected playback and tool rail");
  expect(rail.y + rail.height).toBeLessThanOrEqual(bar.y);
  expect(bar.x).toBe(0);
  expect(bar.width).toBe(390);
  await page.getByTestId("ai-rail-open").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
});

test("Live reserves the caption and full-window transport outside the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("dock-tab-properties")).toBeVisible();
  await waitForCameraIdle(page);
  const bounds = async (id: string) => {
    const box = await page.getByTestId(id).boundingBox();
    if (!box) throw new Error(`Missing ${id}`);
    return box;
  };
  const bar = await bounds("live-controls");
  const canvas = await bounds("canvas-wrap");
  const dock = await bounds("inspector");
  expect(bar.x).toBe(0);
  expect(bar.width).toBe(1440);
  expect(bar.y + bar.height).toBe(900);
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(bar.y);
  expect(dock.y + dock.height).toBeLessThanOrEqual(bar.y);
  await expect(page.getByTestId("live-clock-total")).toBeVisible();
  await page.getByTestId("live-timeline-input").fill("160");
  await page.getByTestId("live-timeline-input").press("ArrowRight");
  await expect(page.getByTestId("live-note-text")).toBeVisible();
  const note = await bounds("live-note");
  const resized = await bounds("canvas-wrap");
  expect(resized.y + resized.height).toBeLessThanOrEqual(note.y);
  expect(note.y + note.height).toBeLessThanOrEqual(bar.y);
  await page.getByTestId("live-note-details").click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-inspector-target", "payments");
});

test("Live details lead the dock and rename opens the editing disclosure", async ({ page }) => {
  await page.goto("./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
  await expect(page.getByTestId("live-timeline-input")).toBeVisible();
  await page.getByTestId("live-timeline-input").fill("160");
  await page.getByTestId("live-timeline-input").press("ArrowRight");
  await page.getByTestId("live-note-details").click();
  await expect(page.getByTestId("dock-live-identity")).toContainText("Payments");
  await expect(page.getByTestId("dock-edit-properties")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
  const area = page.getByTestId("planning-live-details");
  const positions = [];
  for (const key of ["rate", "queue", "inFlight", "latency"]) {
    const value = area.getByTestId(`hover-vital-value-${key}`);
    await expect(value).toHaveCSS("font-size", "17px");
    await expect(area.getByTestId(`hover-vital-label-${key}`)).toHaveCSS("font-size", "11px");
    positions.push((await value.boundingBox())?.y);
  }
  expect(new Set(positions).size).toBe(1);
  await page.getByTestId("node-payments").hover();
  await expect(page.getByTestId("node-detail-payments")).toHaveCount(0);
  await page.getByTestId("node-payments").evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("F2");
  await expect(page.getByTestId("dock-edit-properties")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Payments");
});
