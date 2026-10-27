import { test, expect, gotoCanvas, shareVia, expectNoErrors } from "./fixtures";
import { SLUG, callTool, installFakeModelContext, toolNames } from "./ai-helpers";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const TOASTER = chunk("Toaster", "src/interop/ui/Toaster.tsx");

test("a held toast download preserves Undo, canvas input, focus and file export", async ({ page, consoleErrors }) => {
  const held = await holdChunk(page, TOASTER);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  await installFakeModelContext(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  const canvas = page.getByTestId("canvas-wrap");
  const cursor = await canvas.evaluate((el) => getComputedStyle(el).cursor);
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  expect((await downloaded).suggestedFilename()).toBe(`${SLUG}.diagram.json`);
  await expect.poll(held.requested).toBe(true);
  const image = page.waitForEvent("download", { timeout: 0 });
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  const png = await image;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect(await png.failure()).toBeNull();
  expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toBe(cursor);
  await canvas.focus();
  expect(
    (
      await callTool(page, "edit_diagram", {
        ops: [{ op: "add_node", kind: "Redis cache", label: "Held toast change" }],
      })
    ).isError,
  ).toBe(false);
  await expect(canvas).toBeFocused();
  await releaseAndEvaluate(page, TOASTER, held.release);
  const undo = page.getByTestId("ai-toast-undo");
  await expect(undo).toBeVisible();
  await expect(canvas).toBeFocused();
  await undo.focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(undo).toHaveCount(0);
  expect((await callTool(page, "describe_diagram")).text).not.toContain("Held toast change");
  expectNoErrors(consoleErrors);
});

test("feedback raised while the toast chunk is held arrives beside its dialog", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const held = await holdChunk(page, TOASTER);
  await gotoCanvas(page, SLUG);
  await shareVia(page, "link");
  await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
  await page.getByTestId("share-link-copy").click();
  await expect.poll(held.requested).toBe(true);
  await expect(page.getByTestId("share-link-copy")).toBeFocused();
  await releaseAndEvaluate(page, TOASTER, held.release);
  const dialog = page.getByTestId("share-link-dialog");
  const feedback = dialog.getByTestId("toast");
  await expect(feedback).toContainText("Share link copied.");
  await expect(feedback).toHaveAttribute("data-layer", "dialog");
  await expect(feedback).toHaveAttribute("data-place", "below");
  const panel = await dialog.boundingBox();
  const box = await feedback.boundingBox();
  if (!panel || !box) throw new Error("Expected dialog feedback geometry");
  expect(box.y).toBeGreaterThanOrEqual(panel.y + panel.height);
  await page.getByTestId("share-link-copy").click({ trial: true });
  await expect(page.getByTestId("share-link-copy")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("toast")).toContainText("Share link copied.");
});

test("a failed toast renderer retries without losing the queued Undo", async ({ page }) => {
  const held = await holdChunk(page, TOASTER);
  held.fail = true;
  await installFakeModelContext(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  await callTool(page, "edit_diagram", {
    ops: [{ op: "add_node", kind: "Redis cache", label: "Retry toast change" }],
  });
  await expect(page.getByTestId("toast-load-error")).toBeVisible();
  held.fail = false;
  held.release();
  await page.getByTestId("toast-load-retry").click();
  const undo = page.getByTestId("ai-toast-undo");
  await expect(undo).toBeVisible();
  await undo.click();
  expect((await callTool(page, "describe_diagram")).text).not.toContain("Retry toast change");
});
