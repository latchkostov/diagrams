import { test, expect, waitForCameraIdle, pauseClock } from "./fixtures";
import { openSurface, surfaceContract } from "./lazy-surface-helpers";
import { chunk, holdChunk } from "./chunk";
import { installCaptureReady } from "./capture-ready";
import { holdTraceRuntime, replayNode } from "./held-trace-runtime";

test("held runtime: recording waits for the pending replay, then starts its exact first beat", async ({ page }) => {
  const held = await holdTraceRuntime(page, "&paused=1");
  try {
    await replayNode(page);
    const checkpoint = await page.getByTestId("live-canvas").getAttribute("data-sim-time");
    if (checkpoint === null) throw new Error("Missing requested replay state");
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await expect(page.getByTestId("record-opt-slowmo")).toBeChecked();
    await page.getByTestId("record-start").click();
    await expect.poll(() => page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBeGreaterThan(0);
    await expect(page.getByTestId("record-countdown")).toHaveCount(0);
    await expect(page.getByTestId("record-indicator")).toHaveCount(0);
    held.release();
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", checkpoint);
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "paused");
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo-progress", "0");
    await expect(page.getByTestId("record-indicator")).toBeVisible();
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
    await page.getByTestId("record-stop").click();
    await expect(page.getByTestId("record-review")).toBeVisible();
  } finally {
    held.release();
  }
});

declare global {
  interface Window {
    __heldSurfaceCapture: MediaStream;
    __heldSurfaceRecorder: MediaRecorder;
    __heldSurfaceEncodedChunks: number;
  }
}

// Observe at construction: the indicator precedes the real encoder's start,
// and an event subscription installed afterwards can miss its first data chunk.
function observeRecording() {
  const NativeRecorder = MediaRecorder;
  window.MediaRecorder = class extends NativeRecorder {
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super(stream, options);
      window.__heldSurfaceRecorder = this;
      window.__heldSurfaceEncodedChunks = 0;
      this.addEventListener("dataavailable", (event) => {
        if (event.data.size) window.__heldSurfaceEncodedChunks++;
      });
    }
  };
}

test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

test("recording waits before countdown and captures the released narration", async ({ page }) => {
  await page.addInitScript(installCaptureReady);
  await page.addInitScript(observeRecording);
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
    await page.clock.install();
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
    await pauseClock(page);
    held.release();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(16);
          return (await page.getByTestId("live-note-text").allTextContents()).join("");
        },
        { intervals: [0] },
      )
      .toBe("Follow a request through the decision service.");
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    for (const count of ["3", "2", "1"]) {
      await expect
        .poll(() =>
          page.getByTestId("record-countdown").evaluate((el) => el.firstElementChild?.getAttribute("data-count")),
        )
        .toBe(count);
      await page.clock.runFor(1000);
    }
    await expect(page.getByTestId("record-indicator")).toBeVisible();
    // The indicator precedes the encoder's start by two frames. Captured tab frames can
    // already contain the narration during that gap; stopping then cancels the take.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(16);
          return page.evaluate(() => window.__heldSurfaceRecorder.state);
        },
        { intervals: [0] },
      )
      .toBe("recording");
    // Subscribe at construction so a busy worker cannot miss the first nonempty chunk.
    await expect.poll(() => page.evaluate(() => window.__heldSurfaceEncodedChunks)).toBeGreaterThan(0);
    await page.clock.runFor(1000);
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
    await page.clock.resume();
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

test("Live and recording start while discovery remains held", async ({ page }) => {
  await page.addInitScript(observeRecording);
  await page.clock.install();
  const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
  try {
    await page.goto("./");
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("start-example-rag-assistant").click();
    await expect(page.getByTestId("diagram-title")).toHaveText("RAG support assistant");
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await pauseClock(page);
    await page.getByTestId("record-start").click();
    await expect(page.getByTestId("record-countdown")).toBeVisible();
    for (const count of ["3", "2", "1"]) {
      await expect
        .poll(() =>
          page.getByTestId("record-countdown").evaluate((el) => el.firstElementChild?.getAttribute("data-count")),
        )
        .toBe(count);
      await page.clock.runFor(1000);
    }
    await expect(page.getByTestId("record-indicator")).toBeVisible();
    expect(await page.evaluate(() => window.__lazySurfaces?.states()["examples.discovery"]?.state)).toBe("loading");
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    // Keep the clock paused at the indicator so Stop cannot accidentally outrun
    // the encoder's two-frame startup. Require actual encoded data before saving.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(16);
          return page.evaluate(() => window.__heldSurfaceRecorder.state);
        },
        { intervals: [0] },
      )
      .toBe("recording");
    await expect.poll(() => page.evaluate(() => window.__heldSurfaceEncodedChunks)).toBeGreaterThan(0);
    await page.getByTestId("record-stop").click();
    await page.clock.resume();
    await expect(page.getByTestId("record-download")).toBeVisible();
    await page.getByTestId("record-discard").click();
  } finally {
    held.release();
  }
});
