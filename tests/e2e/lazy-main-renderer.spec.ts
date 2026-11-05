import { readFileSync } from "node:fs";
import { chunk, holdChunk } from "./chunk";
import { test, expect, gotoLive, waitForStableViewport } from "./fixtures";

const FALLBACK = chunk("MainThreadLoop", "src/live/session/MainThreadLoop.tsx");

for (const workerFails of [false, true])
  test(`held main-thread drawing (${workerFails ? "worker failure" : "forced fallback"}) keeps focus, cursor and export readiness`, async ({
    page,
  }) => {
    const held = await holdChunk(page, FALLBACK);
    // Build serves /assets/particleWorker-<hash>.js; Dev serves the source module. Match both.
    if (workerFails) await page.route(/particleWorker/, (route) => route.abort("failed"));
    try {
      await gotoLive(
        page,
        `./?view=canvas&example=kafka-order-pipeline&live=1&paused=1${workerFails ? "" : "&renderer=main"}`,
      );
      await expect.poll(held.requested).toBe(true);
      await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-renderer", "main");
      const play = page.getByTestId("live-play");
      await play.focus();
      await expect(play).toBeFocused();
      await expect(play).toHaveCSS("cursor", "pointer");
      await expect(play).toHaveAttribute("data-state", "paused");
      expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(play).toBeFocused();

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
      expect(readFileSync(await file.path(), "utf8")).toContain('data-testid="node-badge-payments"');
      await expect(play).toHaveAttribute("data-state", "paused");
      const frames = async () => Number(await page.getByTestId("live-canvas").getAttribute("data-frames"));
      await expect.poll(frames).toBeGreaterThan(0);
      const before = await frames();
      // An unchanged paused scene skips painting. A real view change must still redraw after the held load.
      await page.getByTestId("live-view-menu").click();
      await page.getByTestId("zoom-in-button").click();
      await waitForStableViewport(page);
      await expect(play).toHaveAttribute("data-state", "paused");
      await expect.poll(frames).toBeGreaterThan(before);
      await expect
        .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-frames")))
        .toBeGreaterThan(1);
      await play.click();
      await expect(play).toHaveAttribute("data-state", "playing");
      await expect
        .poll(async () => Number(await page.getByTestId("live-canvas").getAttribute("data-particles")))
        .toBeGreaterThan(0);
    } finally {
      held.release();
    }
  });
