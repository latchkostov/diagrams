import { test, expect, gotoCanvas, shareVia, expectNoErrors, waitForStableBox, pinLibrary } from "./fixtures";
import { SLUG, callTool, installFakeModelContext, toolNames } from "./ai-helpers";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

const TOASTER = chunk("Toaster", "src/interop/ui/Toaster.tsx");
const IMAGE = chunk("image", "src/interop/image.ts");

test("node, palette and pane cursors survive a held toast download", async ({ page }) => {
  const held = await holdChunk(page, TOASTER);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
    });
    await gotoCanvas(page, SLUG);
    await pinLibrary(page);
    const cursors = async () => {
      await expect(page.getByTestId("node-shopper")).toHaveCSS("cursor", "move");
      await expect(page.getByTestId("palette-item-kafka.topic")).toHaveCSS("cursor", "grab");
      await expect(page.getByTestId("palette-section-messaging")).toHaveCSS("cursor", "pointer");
      await expect(page.getByTestId("palette-search")).toHaveCSS("cursor", "text");
      await expect(page.getByTestId("canvas-pane")).toHaveCSS("cursor", "default");
    };
    await cursors();
    const downloaded = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    expect((await downloaded).suggestedFilename()).toBe(`${SLUG}.diagram.json`);
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await cursors();
    await releaseAndEvaluate(page, TOASTER, held.release);
    await expect(page.getByTestId("toast")).toBeVisible();
    await cursors();
  } finally {
    held.release();
  }
});

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

test("failed renderer retries inside Share", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const held = await holdChunk(page, TOASTER);
  held.fail = true;
  await gotoCanvas(page, SLUG);
  await shareVia(page, "link");
  await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
  await page.getByTestId("share-link-copy").click();
  // Raised while the dialog is open: its Retry is the dialog's feedback, beside the panel, not behind the modal.
  const dialog = page.getByTestId("share-link-dialog");
  const recovery = dialog.getByTestId("toast-load-error");
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute("data-layer", "dialog");
  const retry = dialog.getByTestId("toast-load-retry");
  await retry.click({ trial: true });
  // In the dialog's own Tab cycle: Tab from the copy button reaches it, before anything outside the dialog.
  const focusedRetry = () => retry.evaluate((el) => el === document.activeElement);
  for (let i = 0; i < 8 && !(await focusedRetry()); i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await expect(retry).toBeFocused();
  held.fail = false;
  held.release();
  await page.keyboard.press("Enter");
  // The queued feedback arrives beside its dialog, which keeps the keyboard: Escape closes it.
  const feedback = dialog.getByTestId("toast");
  await expect(feedback).toContainText("Share link copied.");
  await expect(feedback).toHaveAttribute("data-layer", "dialog");
  await expect(recovery).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("toast")).toContainText("Share link copied.");
});

test("failed renderer retries inside Share in a short window, inside the panel and in reach", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 340 });
  const held = await holdChunk(page, TOASTER);
  held.fail = true;
  await gotoCanvas(page, SLUG);
  await shareVia(page, "link");
  await expect(page.getByTestId("share-link-url")).toHaveValue(/#d=/);
  const copy = page.getByTestId("share-link-copy");
  // Once the dialog's entrance has settled.
  await waitForStableBox(copy);
  const before = await copy.boundingBox();
  await copy.click();
  const dialog = page.getByTestId("share-link-dialog");
  const recovery = dialog.getByTestId("toast-load-error");
  await expect(recovery).toHaveAttribute("data-place", "inside");
  // The dialog's own controls keep their place.
  expect(await copy.boundingBox()).toEqual(before);
  const box = await recovery.boundingBox();
  if (!box) throw new Error("Expected recovery geometry");
  expect(box.y + box.height).toBeLessThanOrEqual(340);
  held.fail = false;
  held.release();
  await dialog.getByTestId("toast-load-retry").click();
  await expect(dialog.getByTestId("toast")).toContainText("Share link copied.");
});

test("failed renderer retries during image export", async ({ page }) => {
  const held = await holdChunk(page, TOASTER);
  held.fail = true;
  const image = await holdChunk(page, IMAGE);
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await expect.poll(image.requested).toBe(true);
  // The export holds the page's input and its Cancel cannot show: the Retry is let through, and has the keyboard.
  const retry = page.getByTestId("toast-load-retry");
  await expect(retry).toBeFocused();
  held.fail = false;
  held.release();
  await retry.click();
  // The queued task arrives with its progress and Cancel, which takes the keyboard and still cancels.
  const cancel = page.getByTestId("image-export-cancel");
  await expect(cancel).toBeFocused();
  await expect(page.getByTestId("toast-load-error")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toHaveCount(0);
  image.release();
});
