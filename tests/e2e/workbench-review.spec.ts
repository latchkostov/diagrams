import { test, expect, gotoCanvas, gotoLive, openLibrary, waitForCameraIdle } from "./fixtures";
import { openAdvanced } from "./ai-helpers";

test("R-5bf14cfd51 automatic Properties folding preserves the AI draft and feedback", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await openAdvanced(page);
  await page.getByTestId("ai-request").fill("Keep this unfinished request");
  const reply = '[{"op":"remove","targets":["missing-node"]}]';
  await page.getByTestId("ai-reply").fill(reply);
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-copy-fix")).toBeEnabled();
  await waitForCameraIdle(page);
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("rail-select").click();
  await expect(page.getByTestId("dock-tab-ai")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("ai-request")).toHaveValue("Keep this unfinished request");
  await expect(page.getByTestId("ai-reply")).toHaveValue(reply);
  await expect(page.getByTestId("ai-copy-fix")).toBeEnabled();
});

test("R-f8f7ad86ab Add yields Escape to the palette and keeps its focus return target", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await openLibrary(page);
  await expect(page.getByTestId("palette-search")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-input")).toHaveCount(0);
  await expect(page.getByTestId("palette-search")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
  await expect(page.getByTestId("rail-add")).toBeFocused();
});

test("R-10e953faac settled camera detail uses the newly selected edge style", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-edge-straight").click();
  await page.getByTestId("zoom-100").click();
  await waitForCameraIdle(page);
  const strokes = page.getByTestId(/^connection-stroke-/);
  expect(await strokes.count()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      strokes.evaluateAll((els) =>
        els.every((el) => el.getAttribute("d") === el.nextElementSibling?.getAttribute("d")),
      ),
    )
    .toBe(true);
  for (const path of await strokes.evaluateAll((els) => els.map((el) => el.getAttribute("d")))) {
    expect(path).toMatch(/^M.*L/);
    expect(path).not.toMatch(/[CQ]/);
  }
});

test("R-23fc70b200 Arabic timeline clicks seek left to right within RTL chrome", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "ar"));
  await gotoLive(page, "./?view=canvas&example=retry-storm&sim=three-quick-retries&paused=1");
  await expect(page.getByTestId("live-controls")).toHaveCSS("direction", "rtl");
  const input = page.getByTestId("live-timeline-input");
  const bounds = await input.boundingBox();
  if (!bounds) throw new Error("Missing timeline input");
  await input.click({ position: { x: bounds.width / 4, y: bounds.height / 2 } });
  await expect.poll(async () => Number(await input.inputValue()) / 1000).toBeCloseTo(0.25, 1);
  await expect
    .poll(async () => Number(await page.getByTestId("live-timeline").getAttribute("data-fraction")))
    .toBeCloseTo(0.25, 1);
});

test("R-59f1d6e16b a pinned phone library overlays the full-width canvas in Edit and Live", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCanvas(page, "retry-storm");
  await openLibrary(page);
  await page.getByTestId("palette-toggle").click();
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
  await expect.poll(async () => (await page.getByTestId("canvas-wrap").boundingBox())?.width).toBe(390);
  await page.reload();
  await expect(page.getByTestId("palette")).toHaveAttribute("data-mode", "pinned");
  await expect.poll(async () => (await page.getByTestId("canvas-wrap").boundingBox())?.width).toBe(390);
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("canvas-wrap").boundingBox())?.width).toBe(390);
});
