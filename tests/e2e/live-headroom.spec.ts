import { readFileSync } from "node:fs";
import { chunk, holdChunk } from "./chunk";
import { test, expect, gotoCanvas, E2E_TARGET } from "./fixtures";

const RUNTIME = chunk("live-shared", "src/sim/engine.ts");

test.skip(E2E_TARGET !== "build", "The consolidated runtime is a production bundle boundary.");

test("a held shared Live runtime preserves focus and cursor while image export awaits readiness", async ({ page }) => {
  const held = await holdChunk(page, RUNTIME);
  try {
    await gotoCanvas(page, "kafka-order-pipeline");
    const toggle = page.getByTestId("live-toggle");
    await toggle.click();
    await expect.poll(held.requested).toBe(true);
    await expect(toggle).toHaveAttribute("aria-busy", "true");
    await expect(toggle).toHaveCSS("cursor", "progress");
    await expect(toggle).toBeFocused();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    let downloaded = false;
    const download = page.waitForEvent("download").then((file) => {
      downloaded = true;
      return file;
    });
    await page.getByTestId("image-export").click();
    await expect.poll(() => page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBeGreaterThan(0);
    expect(downloaded).toBe(false);
    await expect(page.getByTestId("image-export-cancel")).toBeFocused();
    held.release();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.svg$/);
    expect(readFileSync(await file.path(), "utf8")).toContain('data-testid="node-badge-payments"');
    await expect(toggle).toHaveAttribute("aria-busy", "false");
    await expect(toggle).not.toHaveCSS("cursor", "progress");
    await expect(page.getByTestId("live-controls")).toBeVisible();
  } finally {
    held.release();
  }
});

test("a failed shared Live runtime keeps the canvas usable and recovers through session Retry", async ({ page }) => {
  const held = await holdChunk(page, RUNTIME);
  try {
    await gotoCanvas(page, "kafka-order-pipeline");
    const toggle = page.getByTestId("live-toggle");
    await toggle.click();
    await expect.poll(held.requested).toBe(true);
    await expect(toggle).toBeFocused();
    held.fail = true;
    held.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(page.getByTestId("node-payments")).toBeVisible();
    held.fail = false;
    await page.getByTestId("lazy-load-retry").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-busy", "false");
    await expect(toggle).not.toHaveCSS("cursor", "progress");
  } finally {
    held.release();
  }
});
