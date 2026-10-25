import { test, expect, waitForCameraIdle } from "./fixtures";
import { openSurface, surfaceContract } from "./lazy-surface-helpers";
import { chunk, holdChunk } from "./chunk";
import { installCaptureReady } from "./capture-ready";

declare global {
  interface Window {
    __heldSurfaceCapture: MediaStream;
  }
}

test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

test("recording waits before countdown and captures the released narration", async ({ page }) => {
  await page.addInitScript(installCaptureReady);
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await capture(options);
      window.__heldSurfaceCapture = stream;
      return stream;
    };
  });
  const [id, name, source] = surfaceContract("live.note");
  const held = await holdChunk(page, chunk(name, `src/${source}.tsx`));
  try {
    await openSurface(page, id);
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    // Keep the active narration at its current point instead of restarting its simulation.
    await page.getByTestId("record-opt-from-start").uncheck();
    await page.getByTestId("record-start").click();
    await expect.poll(() => page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBeGreaterThan(0);
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    await expect(page.getByTestId("record-indicator")).toHaveCount(0);
    await expect(page.getByTestId("live-note-text")).toHaveCount(0);
    // A conspicuous test-only background makes this actual deferred element identifiable in video pixels.
    await page.addStyleTag({
      content: '[data-testid="live-note-text"] { background: rgb(216,35,194); padding: 16px; }',
    });
    held.release();
    await expect(page.getByTestId("live-note-text")).toHaveText("Follow a request through the decision service.");
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    await expect(page.getByTestId("record-indicator")).toBeVisible();
    await waitForCameraIdle(page);
    const sample = await page.getByTestId("live-note-text").boundingBox();
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    if (!sample || !pane) throw new Error("Missing captured narration geometry");
    // Read real captured frames until the released element's marker is in the compositor output.
    await page.evaluate(
      async ({ sample, pane }) => {
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = window.__heldSurfaceCapture;
        await video.play();
        const canvas = document.createElement("canvas");
        const read = () => {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Missing video pixel context");
          ctx.drawImage(video, 0, 0);
          const x = Math.round(((sample.x + 6 - pane.x) / pane.width) * canvas.width);
          const y = Math.round(((sample.y + 6 - pane.y) / pane.height) * canvas.height);
          return Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
        };
        try {
          await window.__captureReady(
            (callback) => video.requestVideoFrameCallback(callback),
            read,
            (rgb) => window.__captureMarker(rgb, false),
          );
        } finally {
          video.srcObject = null;
        }
      },
      { sample, pane },
    );
    await page.getByTestId("record-stop").click();
    await expect(page.getByTestId("record-review")).toBeVisible();
    await expect
      .poll(() => page.getByTestId("record-preview").evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    // Check the encoded clip too: a correct capture stream alone would miss recording the wrong stream.
    const recordedSurface = await page.getByTestId("record-preview").evaluate(
      async (video: HTMLVideoElement, { sample, pane }) => {
        video.muted = true;
        await video.play();
        const canvas = document.createElement("canvas");
        try {
          return await window.__captureReady(
            (callback) => video.requestVideoFrameCallback(callback),
            () => {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new Error("Missing recorded video pixel context");
              ctx.drawImage(video, 0, 0);
              const x = Math.round(((sample.x + 6 - pane.x) / pane.width) * canvas.width);
              const y = Math.round(((sample.y + 6 - pane.y) / pane.height) * canvas.height);
              return Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
            },
            (rgb) => window.__captureMarker(rgb, false),
          );
        } finally {
          video.pause();
        }
      },
      { sample, pane },
    );
    expect(recordedSurface[0]).toBeGreaterThan(recordedSurface[1] + 64);
    expect(recordedSurface[2]).toBeGreaterThan(recordedSurface[1] + 64);
    await page.getByTestId("record-discard").click();
  } finally {
    held.release();
  }
});
