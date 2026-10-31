import { waitForCameraIdle } from "./fixtures";
import type { Page } from "@playwright/test";
import { expect, expectNoErrors, gotoLive } from "./fixtures";
import { captureTest as test } from "./capture-browser";
import { installCaptureReady } from "./capture-ready";
import { chromiumLaunchArgs } from "../../scripts/e2e-chromium";
import { installParticleCounters } from "./particle-counters";

// Record video captures the tab, so whatever the compositor shows is in the video, worker canvases
// included. A real tab capture, accepted automatically (full Chromium's headless mode supports it).
//
// Each layer is checked on its own, with everything standing still (the simulation and the slow-motion
// replay paused, the march with them):
//  1. Find where the layer paints (read through the renderer, `__liveProbe`). The live canvases above
//     it are hidden while it's measured (particles and trails ride the busiest edges, right over the
//     ants), and spots under DOM above it (a label pill, a node, a badge) are left out: the video
//     can't show the layer there, whatever the capture does. Spots where the layer's colour is close
//     to what's beneath it (a white caption card on the light canvas) are left out too: showing or
//     hiding it changes nothing measurable.
//  2. Capture a frame, hide that layer, capture again once the captured frames have settled.
//  3. At every remaining spot, the frame with the layer must be nearer the layer's colour than the
//     frame without it, by a good part of the difference. A thin dash comes out blurred (the capture
//     scales the tab, to 1080p here), so a spot is looked at as its 3x3 neighbourhood and never needs
//     the exact colour.

const KAFKA = "kafka-order-pipeline";
const canvas = (page: Page) => page.getByTestId("live-canvas");
const count = async (page: Page, name: string) => Number(await canvas(page).getAttribute(`data-${name}`));

// Chromium exposes its command line only with this diagnostic flag. Scope it to the contract test.
const launchContractTest = test.extend({
  launchOptions: async ({ launchOptions }, use) => {
    await use({ ...launchOptions, args: [...(launchOptions.args ?? []), "--enable-automation"] });
  },
});

launchContractTest("tab capture retains the shared native Chromium flags", async ({ browser }) => {
  const session = await browser.newBrowserCDPSession();
  try {
    const { arguments: args } = await session.send("Browser.getBrowserCommandLine");
    expect(args).toEqual(expect.arrayContaining(chromiumLaunchArgs("127.0.0.1")));
    expect(args).toContain("--auto-accept-this-tab-capture");
  } finally {
    await session.detach();
  }
});

async function goLive(page: Page, renderer: "worker" | "main") {
  await page.addInitScript(installCaptureReady);
  // Keep the stream the recorder gets, to look at its frames.
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await get(options);
      (window as unknown as { __captured: MediaStream }).__captured = stream;
      return stream;
    };
  });
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1${renderer === "main" ? "&renderer=main" : ""}`);
  await expect(canvas(page)).toHaveAttribute("data-renderer", renderer);
  await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
}

/** Starts a take of what's on screen now (no restart), then waits for the presentation refit to end. */
async function record(page: Page) {
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-record").click();
  // In slow motion the take would otherwise rewind the replay and play it: keep it where it is.
  const fromStart = page.getByTestId("record-opt-slowmo");
  if (await fromStart.isVisible()) await fromStart.uncheck();
  await page.getByTestId("record-start").click();
  await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 10_000 });
  await waitForCameraIdle(page);
}

type Layer = "base" | "over" | "march" | "glow";
const TEST_ID: Record<Layer, string> = {
  base: "live-canvas",
  over: "live-canvas-over",
  march: "live-canvas-march",
  glow: "live-toggle-glow",
};

interface LayerCheck {
  /** Solid painted spots looked up. */
  points: number;
  /** Of those, spots nothing covers and where the layer stands out from what's beneath it. */
  shown: number;
  /** Of the shown spots, those the video draws nearer the layer's colour with the layer than without. */
  lost: number;
  /** The glow: spots in its canvas that change when it's hidden (it should have none: the toggle is out of the take). */
  changed: number;
}

/**
 * How `layer` shows up in the captured video (see the top of the file). `within`: only paint inside
 * this client rect.
 */
async function layerInVideo(
  page: Page,
  layer: Layer,
  within?: { x: number; y: number; w: number; h: number },
): Promise<LayerCheck> {
  return page.evaluate(
    async ([layer, testId, within]) => {
      const stream = (window as unknown as { __captured: MediaStream }).__captured;
      const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      const wrap = document.querySelector('[data-testid="canvas-wrap"]')?.getBoundingClientRect();
      const pane = document.querySelector('[data-testid="live-canvas"]')?.getBoundingClientRect();
      if (!stream || !el || !wrap || !pane) throw new Error("no capture, layer or pane");

      // The layer's painted spots in client px, with the colour it paints there.
      const spots: { x: number; y: number; rgb?: [number, number, number] }[] = [];
      if (layer === "glow") {
        const r = el.getBoundingClientRect();
        for (let y = r.top + 2; y < r.bottom - 2; y += 3)
          for (let x = r.left + 2; x < r.right - 2; x += 3) spots.push({ x, y });
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
          // Well-covered pixels: blended over what's beneath, their colour still shows where nothing
          // covers them (thin dashes have few fully opaque pixels).
          if (data[i] < 140) continue;
          const x = px.x + (((i - 3) / 4) % width) / px.scale;
          const y = px.y + Math.floor((i - 3) / 4 / width) / px.scale;
          if (within && !(x >= within.x && x <= within.x + within.w && y >= within.y && y <= within.y + within.h))
            continue;
          spots.push({ x, y, rgb: [data[i - 3], data[i - 2], data[i - 1]] });
        }
      }
      // What's above the layer: the live canvases drawn over it (hidden while it's measured), and DOM
      // (pills, nodes, badges), whose spots are left out.
      const above: Record<string, string[]> = {
        march: ["live-canvas", "live-canvas-over"],
        base: ["live-canvas-over"],
        over: [],
      };
      const upper = (above[layer] ?? []).flatMap(
        (id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? [],
      );
      const boxes = [
        ...document.querySelectorAll(
          '[data-testid^="edge-label-"], [data-testid^="node-"], [data-testid^="node-badge-"]',
        ),
      ].map((e) => e.getBoundingClientRect());
      const covered = (p: { x: number; y: number }) =>
        layer !== "over" &&
        boxes.some((b) => p.x >= b.left - 2 && p.x <= b.right + 2 && p.y >= b.top - 2 && p.y <= b.bottom + 2);
      // The readiness marker changes on every frame; neither it nor its scaled 3x3 fringe belongs to the sample.
      const open = spots.filter(
        (p) =>
          (layer === "glow" || !covered(p)) &&
          !(p.x >= wrap.left + 4 && p.x <= wrap.left + 28 && p.y >= wrap.top + 4 && p.y <= wrap.top + 28),
      );
      const step = Math.max(1, Math.floor(open.length / 400));
      const sample = open.filter((_, i) => i % step === 0);

      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      const marker = document.createElement("div");
      marker.dataset.testid = "capture-ready-marker";
      marker.style.cssText = "position:fixed;width:16px;height:16px;z-index:2147483647;pointer-events:none";
      marker.style.left = `${wrap.left + 8}px`;
      marker.style.top = `${wrap.top + 8}px`;
      document.querySelector('[data-testid="canvas-wrap"]')?.appendChild(marker);
      type Frame = { data: Uint8ClampedArray; width: number; height: number };
      const grab = (): Frame => {
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const g = c.getContext("2d");
        if (!g) throw new Error("no 2D context");
        g.drawImage(video, 0, 0);
        return { data: g.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
      };
      /** The captured surface: the canvas area (Element Capture) or the whole tab, whichever shape fits. */
      const toFrame = (f: Frame, p: { x: number; y: number }) => {
        const ratio = f.width / f.height;
        const area =
          Math.abs(ratio - wrap.width / wrap.height) <= Math.abs(ratio - innerWidth / innerHeight)
            ? { left: wrap.left, top: wrap.top, width: wrap.width }
            : { left: 0, top: 0, width: innerWidth };
        const s = f.width / area.width;
        return { x: Math.round((p.x - area.left) * s), y: Math.round((p.y - area.top) * s) };
      };
      /** The colours around a spot (3x3 frame pixels): the capture's scaling blurs and shifts by a pixel. */
      const around = (f: Frame, p: { x: number; y: number }) => {
        const c = toFrame(f, p);
        const out: [number, number, number][] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = Math.min(f.width - 1, Math.max(0, c.x + dx));
            const y = Math.min(f.height - 1, Math.max(0, c.y + dy));
            const i = (y * f.width + x) * 4;
            out.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
          }
        return out;
      };
      const dist = (a: [number, number, number], b: [number, number, number]) =>
        Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      /** The sample's colours in a frame: what "settled" compares. */
      const signature = (f: Frame) =>
        sample.map((p) => {
          const c = toFrame(f, p);
          const i = (c.y * f.width + c.x) * 4;
          return f.data[i] + f.data[i + 1] * 256 + f.data[i + 2] * 65536;
        });
      // A marker inside the captured area acknowledges each page change in the actual video pixels.
      // Changing it also requests a new frame on a still tab. Silence and repeated stale frames prove nothing.
      let green = false;
      const fresh = async (): Promise<Frame> => {
        green = !green;
        const rgb: [number, number, number] = green ? [24, 205, 57] : [216, 35, 194];
        marker.style.backgroundColor = `rgb(${rgb.join(",")})`;
        return window.__captureReady(
          (callback) => video.requestVideoFrameCallback(callback),
          grab,
          (frame) => {
            const p = toFrame(frame, { x: wrap.left + 16, y: wrap.top + 16 });
            const i = (p.y * frame.width + p.x) * 4;
            return window.__captureMarker([frame.data[i], frame.data[i + 1], frame.data[i + 2]], green);
          },
        );
      };
      const settled = async (): Promise<Frame> => {
        let frame = await fresh();
        let last = signature(frame).join();
        let same = 0;
        while (same < 3) {
          frame = await fresh();
          const now = signature(frame).join();
          same = now === last && frame.width > 0 ? same + 1 : 0;
          last = now;
        }
        return frame;
      };

      // The first frames can be empty: wait for real ones.
      let before: Frame;
      let after: Frame;
      const visibility = el.style.visibility;
      const upperVisibility = upper.map((u) => u.style.visibility);
      try {
        for (const u of upper) u.style.visibility = "hidden";
        before = await settled();
        el.style.visibility = "hidden";
        after = await settled();
      } finally {
        el.style.visibility = visibility;
        upper.forEach((u, i) => {
          u.style.visibility = upperVisibility[i];
        });
        video.srcObject = null;
        marker.remove();
      }

      let shown = 0;
      let lost = 0;
      let changed = 0;
      for (const p of sample) {
        const a = around(before, p);
        const b = around(after, p);
        if (Math.max(...a.map((c, i) => dist(c, b[i]))) > 30) changed++;
        const rgb = p.rgb;
        if (!rgb) continue;
        // The neighbourhood pixel nearest the layer's colour with the layer shown, and the same pixel
        // without it (what's beneath).
        let k = 0;
        for (let i = 1; i < a.length; i++) if (dist(a[i], rgb) < dist(a[k], rgb)) k = i;
        const contrast = dist(b[k], rgb);
        if (contrast < 90) continue; // the layer looks like what's beneath: nothing to measure here
        shown++;
        if (contrast - dist(a[k], rgb) > contrast * 0.25) lost++;
      }
      return { points: sample.length, shown, lost, changed };
    },
    [layer, TEST_ID[layer], within ?? null] as const,
  );
}

/** The layer reaches the video: enough of its spots show its colour, and nearly all of those go with it. */
function expectInVideo(layer: string, c: LayerCheck) {
  expect(c.points, `${layer}: uncovered painted spots to look up`).toBeGreaterThan(30);
  expect(c.shown, `${layer}: spots where the layer stands out from what's beneath it`).toBeGreaterThan(20);
  expect(c.lost / c.shown, `${layer}: of those, the share the video draws with the layer`).toBeGreaterThan(0.9);
}

async function pauseBeforeCaptionPaint(page: Page, paused?: () => void) {
  await expect(canvas(page)).toHaveAttribute("data-slowmo", "playing");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await page.getByTestId("live-play").click();
  await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
  paused?.();
  // Painting may finish after the replay controls are ready. Hold the replay before waiting for it.
  await expect
    .poll(async () => JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]").length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
}

test("caption preparation pauses before waiting for a delayed worker paint", async ({ page }) => {
  await installParticleCounters(page);
  await goLive(page, "worker");
  await waitForCameraIdle(page);
  await page.evaluate(() => window.__particleCounters?.holdReports());
  await expect.poll(() => page.evaluate(() => window.__particleCounters?.held() ?? 0)).toBeGreaterThan(0);
  await page.getByTestId("node-shopper").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  const paused = Promise.withResolvers<undefined>();
  let finished = false;
  const preparing = pauseBeforeCaptionPaint(page, () => paused.resolve(undefined)).then(() => {
    finished = true;
  });
  try {
    await Promise.race([paused.promise, preparing]);
    expect(finished, "pause preparation must not depend on a completed caption paint").toBe(false);
    await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
    await page.evaluate(() => window.__particleCounters?.releaseReports());
    await preparing;
  } finally {
    await page.evaluate(() => window.__particleCounters?.releaseReports());
    await preparing;
  }
});

for (const renderer of ["worker", "main"] as const) {
  test.describe(`recording captures each live layer (${renderer} path)`, () => {
    test("the particles and the marching edges are each in the video", async ({ page, consoleErrors }) => {
      test.setTimeout(90_000);
      await goLive(page, renderer);
      // Paused: the particles stay put and the march with them.
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-still", "1");
      if (renderer === "worker") await expect(page.getByTestId("live-toggle-glow")).toBeVisible();
      await record(page);
      for (const layer of ["base", "march"] as const) expectInVideo(layer, await layerInVideo(page, layer));
      // The Live toggle (and with it the dot's breath) stays out of the take, as before.
      await expect(page.getByTestId("live-toggle")).toBeHidden();
      await expect(page.getByTestId("topbar")).toHaveCount(0);
      if (renderer === "worker") {
        // Presentation removes the top bar and its worker canvas. The excluded
        // layer must leave the compositor, rather than merely stop animating.
        await expect(page.getByTestId("live-toggle-glow")).toHaveCount(0);
      }

      await page.getByTestId("record-stop").click();
      await expect(page.getByTestId("record-meta")).toContainText(/WebM/, { timeout: 10_000 });
      expectNoErrors(consoleErrors);
    });

    test("slow motion's captions are in the video", async ({ page, consoleErrors }) => {
      test.setTimeout(90_000);
      await goLive(page, renderer);
      await waitForCameraIdle(page);
      await page.getByTestId("node-shopper").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.slowmo-from").click();
      await pauseBeforeCaptionPaint(page);
      await record(page);
      // The replay stayed paused for the take.
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
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
      expectInVideo(
        "caption",
        await layerInVideo(page, "over", { x: pane.x + caption.x, y: pane.y + caption.y, w: caption.w, h: caption.h }),
      );
      await page.getByTestId("record-stop").click();
      await expect(page.getByTestId("record-meta")).toContainText(/WebM/, { timeout: 10_000 });
      expectNoErrors(consoleErrors);
    });
  });
}
