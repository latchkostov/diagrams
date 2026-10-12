import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors } from "./fixtures";

const KAFKA = "kafka-order-pipeline";
const canvas = (page: Page) => page.getByTestId("live-canvas");
const count = async (page: Page, name: string) => Number(await canvas(page).getAttribute(`data-${name}`));

async function goLive(page: Page, renderer: "worker" | "main") {
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1${renderer === "main" ? "&renderer=main" : ""}`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("data-renderer", renderer);
}

// Record video captures the tab, so whatever the compositor shows is in the video, worker canvases
// included. A real tab capture, accepted automatically (full Chromium's headless mode supports it).
test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

test.describe("recording captures the worker's canvases", () => {
  for (const renderer of ["worker", "main"] as const) {
    test(`the captured video shows the particles and marching edges (${renderer} path)`, async ({
      page,
      consoleErrors,
    }) => {
      // A countdown, a real capture and a real encoder.
      test.setTimeout(60_000);
      // Keep the stream the recorder gets, to look at its frames.
      await page.addInitScript(() => {
        const get = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = async (options) => {
          const stream = await get(options);
          (window as unknown as { __captured: MediaStream }).__captured = stream;
          return stream;
        };
      });
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
      await page.getByTestId("live-play").click();
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-record").click();
      await page.getByTestId("record-start").click();
      await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 10_000 });

      // One captured frame, then another with the live canvases hidden: the pixels that change are the
      // canvases' contribution to the video (compared in the page; frames are megabytes).
      const differ = await page.evaluate(async () => {
        const stream = (window as unknown as { __captured: MediaStream }).__captured;
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        const grab = async () => {
          await new Promise((r) => setTimeout(r, 400));
          const c = document.createElement("canvas");
          c.width = video.videoWidth;
          c.height = video.videoHeight;
          const g = c.getContext("2d");
          if (!g) throw new Error("no 2D context");
          g.drawImage(video, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const layers = ["live-canvas", "live-canvas-over", "live-canvas-march"].flatMap(
          (id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? [],
        );
        if (layers.length !== 3) throw new Error("a live canvas is missing");
        const shown = await grab();
        for (const el of layers) el.style.visibility = "hidden";
        const hidden = await grab();
        for (const el of layers) el.style.visibility = "";
        video.srcObject = null;
        if (hidden.length !== shown.length) return -1;
        let n = 0;
        for (let i = 0; i < shown.length; i += 4)
          if (
            Math.abs(shown[i] - hidden[i]) +
              Math.abs(shown[i + 1] - hidden[i + 1]) +
              Math.abs(shown[i + 2] - hidden[i + 2]) >
            30
          )
            n++;
        return n;
      });
      expect(differ, "pixels the live canvases contribute to the video").toBeGreaterThan(300);

      await page.getByTestId("record-stop").click();
      await expect(page.getByTestId("record-meta")).toContainText(/WebM/, { timeout: 10_000 });
      expectNoErrors(consoleErrors);
    });
  }
});
