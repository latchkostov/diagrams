import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors } from "./fixtures";

// Record video captures the tab, so whatever the compositor shows is in the video, worker canvases
// included. A real tab capture, accepted automatically (full Chromium's headless mode supports it).
// Each layer is checked on its own: with the simulation paused, a layer's painted pixels (read
// through the renderer, `__liveProbe`) are looked up in a captured frame, then the layer alone is
// hidden and a newer captured frame must differ there.

const KAFKA = "kafka-order-pipeline";
const canvas = (page: Page) => page.getByTestId("live-canvas");
const count = async (page: Page, name: string) => Number(await canvas(page).getAttribute(`data-${name}`));

test.use({ channel: "chromium", launchOptions: { args: ["--auto-accept-this-tab-capture"] } });

async function goLive(page: Page, renderer: "worker" | "main") {
  // Keep the stream the recorder gets, to look at its frames.
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await get(options);
      (window as unknown as { __captured: MediaStream }).__captured = stream;
      return stream;
    };
  });
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1${renderer === "main" ? "&renderer=main" : ""}`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("data-renderer", renderer);
  await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
}

async function record(page: Page) {
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-record").click();
  await page.getByTestId("record-start").click();
  await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 10_000 });
  // Recording presents the diagram: let the refit settle (nothing else moves while paused).
  await page.waitForTimeout(1500);
}

type Layer = "base" | "over" | "march" | "glow";
const TEST_ID: Record<Layer, string> = {
  base: "live-canvas",
  over: "live-canvas-over",
  march: "live-canvas-march",
  glow: "live-toggle-glow",
};

/**
 * Where `layer` paints (up to 300 points, in client px; the glow: its whole canvas), how many of those
 * a captured frame changes at when that layer alone is hidden. `within`: only paint inside this rect.
 */
async function layerInVideo(page: Page, layer: Layer, within?: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(
    async ([layer, testId, within]) => {
      const stream = (window as unknown as { __captured: MediaStream }).__captured;
      const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      const pane = document.querySelector('[data-testid="live-canvas"]')?.getBoundingClientRect();
      const wrap = document.querySelector('[data-testid="canvas-wrap"]')?.getBoundingClientRect();
      if (!stream || !el || !pane || !wrap) throw new Error("no capture, layer or pane");

      // The layer's painted points, in client px.
      const points: { x: number; y: number }[] = [];
      if (layer === "glow") {
        const r = el.getBoundingClientRect();
        for (let y = r.top + 2; y < r.bottom - 2; y += 3)
          for (let x = r.left + 2; x < r.right - 2; x += 3) points.push({ x, y });
      } else {
        const probe = window.__liveProbe;
        if (!probe) throw new Error("no __liveProbe");
        const px = await probe(layer as "base" | "over" | "march", {
          x: pane.left,
          y: pane.top,
          width: pane.width,
          height: pane.height,
        });
        const { data, width } = px;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 120) continue;
          const x = px.x + (((i - 3) / 4) % width) / px.scale;
          const y = px.y + Math.floor((i - 3) / 4 / width) / px.scale;
          if (within && !(x >= within.x && x <= within.x + within.w && y >= within.y && y <= within.y + within.h))
            continue;
          points.push({ x, y });
        }
      }
      const step = Math.max(1, Math.floor(points.length / 300));
      const sample = points.filter((_, i) => i % step === 0);

      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      /**
       * Waits until captured frames show what's on screen now: capture runs ~100-200 ms behind, so
       * both some time and a few new frames (a still tab may send none: then time alone).
       */
      const caughtUp = async () => {
        const until = performance.now() + 500;
        let frames = 0;
        while (performance.now() < until || frames < 3) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 200);
            video.requestVideoFrameCallback(() => {
              clearTimeout(t);
              frames++;
              resolve();
            });
          });
          if (performance.now() > until + 1500) break;
        }
      };
      const grab = () => {
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const g = c.getContext("2d");
        if (!g) throw new Error("no 2D context");
        g.drawImage(video, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      await caughtUp();
      // The captured surface, known once frames arrive (Chrome may scale it, e.g. to 1080p): the canvas
      // area (Element Capture) or the whole tab, whichever shape fits.
      const ratio = video.videoWidth / video.videoHeight;
      const area =
        Math.abs(ratio - wrap.width / wrap.height) <= Math.abs(ratio - innerWidth / innerHeight)
          ? { left: wrap.left, top: wrap.top, width: wrap.width }
          : { left: 0, top: 0, width: innerWidth };
      const frameWidth = video.videoWidth;
      const scale = frameWidth / area.width;
      const at = (frame: Uint8ClampedArray, p: { x: number; y: number }) => {
        const vx = Math.round((p.x - area.left) * scale);
        const vy = Math.round((p.y - area.top) * scale);
        const i = (vy * frameWidth + vx) * 4;
        return [frame[i], frame[i + 1], frame[i + 2]];
      };

      const shown = grab();
      el.style.visibility = "hidden";
      await caughtUp();
      const hidden = grab();
      el.style.visibility = "";
      video.srcObject = null;
      let differ = 0;
      for (const p of sample) {
        const a = at(shown, p);
        const b = at(hidden, p);
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30) differ++;
      }
      return { points: sample.length, differ };
    },
    [layer, TEST_ID[layer], within ?? null] as const,
  );
}

for (const renderer of ["worker", "main"] as const) {
  test.describe(`recording captures each live layer (${renderer} path)`, () => {
    test("the particles, the marching edges and the overlay are each in the video", async ({ page, consoleErrors }) => {
      test.setTimeout(60_000);
      await goLive(page, renderer);
      await page.getByTestId("live-play").click();
      await record(page);
      for (const layer of ["base", "march"] as const) {
        const { points, differ } = await layerInVideo(page, layer);
        expect(points, `${layer}: painted points to look up`).toBeGreaterThan(30);
        expect(differ / points, `${layer}: share of its pixels the video loses without it`).toBeGreaterThan(0.5);
      }
      // The Live toggle (and with it the dot's breath) stays out of the take, as before.
      await expect(page.getByTestId("live-toggle")).toHaveCSS("visibility", "hidden");
      if (renderer === "worker") {
        const glow = await layerInVideo(page, "glow");
        expect(glow.points).toBeGreaterThan(30);
        expect(glow.differ).toBe(0);
      }

      await page.getByTestId("record-stop").click();
      await expect(page.getByTestId("record-meta")).toContainText(/WebM/, { timeout: 10_000 });
      expectNoErrors(consoleErrors);
    });

    test("slow motion's captions are in the video", async ({ page, consoleErrors }) => {
      test.setTimeout(60_000);
      await goLive(page, renderer);
      await expect(async () => {
        await page.getByTestId("node-shopper").click({ button: "right" });
        await page.getByTestId("context-menu-item-sim.slowmo-from").click({ timeout: 1000 });
      }).toPass({ timeout: 8000 });
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "playing");
      await expect
        .poll(async () => JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]").length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
      await page.getByTestId("live-play").click();
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
      await record(page);
      // The captions as drawn now (recording refitted the view), each a rect in pane px.
      await expect
        .poll(async () => JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]").length)
        .toBeGreaterThan(0);
      const pane = await canvas(page).boundingBox();
      const [caption] = JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]") as {
        x: number;
        y: number;
        w: number;
        h: number;
      }[];
      if (!pane || !caption) throw new Error("no caption");
      const { points, differ } = await layerInVideo(page, "over", {
        x: pane.x + caption.x,
        y: pane.y + caption.y,
        w: caption.w,
        h: caption.h,
      });
      expect(points, "caption pixels to look up").toBeGreaterThan(30);
      expect(differ / points, "share of the caption the video loses without the overlay").toBeGreaterThan(0.5);
      await page.getByTestId("record-stop").click();
      await expect(page.getByTestId("record-meta")).toContainText(/WebM/, { timeout: 10_000 });
      expectNoErrors(consoleErrors);
    });
  });
}
