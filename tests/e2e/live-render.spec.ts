import {
  animationFrames,
  waitForCameraIdle,
  test,
  performanceTest,
  expect,
  expectNoErrors,
  gotoLive,
  livePaint,
  pauseClock,
  waitForStableViewport,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { zoomIdentity } from "./node-identity";
import { installParticleCounters, rendererCounters } from "./particle-counters";

// The live view draws its particles, the overlay above the edge label pills, the marching edges and
// the Live dot's breath in a worker, on OffscreenCanvas (src/live/liveRenderer.ts); where that isn't
// available the same drawing code runs on the main thread. Every behaviour here is checked on both
// paths: `?renderer=main` forces the fallback. A worker's canvas can't be read from the page, so
// pixels come through the renderer's test hook (`livePaint`). Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const PILL = "shopper-to-gateway"; // "HTTPS": the entry edge, always busy
const canvas = (page: Page) => page.getByTestId("live-canvas");
const count = async (page: Page, name: "particles" | "frames") =>
  name === "frames" ? (await rendererCounters(page)).frames : Number(await canvas(page).getAttribute("data-particles"));
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

type Renderer = "worker" | "main";

test.beforeEach(async ({ page }) => {
  await installParticleCounters(page);
});

test("worker paint counters remain observable while UI reports are held", async ({ page }) => {
  await goLive(page, "worker");
  await zoomIdentity(page, 0.8);
  await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-glow", "canvas");
  await expect.poll(() => page.evaluate(() => typeof window.__liveProbe)).toBe("function");
  const before = await page.evaluate(() => {
    const counters = window.__particleCounters;
    if (!counters) throw new Error("Expected the particle counter observer");
    return counters.holdReports();
  });
  try {
    await page.getByTestId("canvas-wrap").hover();
    await page.mouse.wheel(0, 32);
    await expect.poll(() => page.evaluate(() => window.__particleCounters?.held() ?? 0)).toBeGreaterThan(0);
    expect((await rendererCounters(page, true)).frames).toBeGreaterThan(before);
    expect(Number(await canvas(page).getAttribute("data-frames"))).toBeLessThanOrEqual(before);
  } finally {
    await page.evaluate(() => window.__particleCounters?.releaseReports());
  }
});

async function goLive(page: Page, renderer: Renderer, query = "") {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1${renderer === "main" ? "&renderer=main" : ""}${query}`);
  await expect(canvas(page)).toHaveAttribute("data-renderer", renderer);
}

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  await waitForStableViewport(page);
  await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
  await menuItem(page, actionId).click();
}

/** A layer's pixels in a client rect (the whole pane by default), summed up in the page: the highest alpha and a checksum. */
async function pixels(
  page: Page,
  layer: "base" | "over" | "march",
  rect?: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    async ([layer, rect]) => {
      const el = document.querySelector('[data-testid="live-canvas"]');
      const probe = window.__liveProbe;
      if (!el || !probe) throw new Error("live view isn't on, or this build has no test hooks");
      const pane = el.getBoundingClientRect();
      const { data } = await probe(
        layer,
        rect ?? { x: pane.left, y: pane.top, width: pane.width, height: pane.height },
      );
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum = (sum * 31 + data[i]) % 1_000_000_007;
        if (i % 4 === 3) peak = Math.max(peak, data[i]);
      }
      return { peak, sum, length: data.length };
    },
    [layer, rect ?? null] as const,
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** A label rect from the canvas's test hooks (pane px) → client px. */
async function clientRect(page: Page, r: Box) {
  const pane = await canvas(page).boundingBox();
  if (!pane) throw new Error("no canvas");
  return { x: pane.x + r.x, y: pane.y + r.y, width: r.w, height: r.h };
}

for (const renderer of ["worker", "main"] as const) {
  test.describe(`live rendering, ${renderer} path`, () => {
    test("draws particles frame after frame, and the busy edges march on their canvas", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(20);
      expect(await livePaint(page, "base")).toBeGreaterThan(200);
      const frames = await count(page, "frames");
      await expect.poll(() => count(page, "frames")).toBeGreaterThan(frames + 10);
      // The SVG's own march steps aside for the canvas, which draws the dashes.
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-march", "canvas");
      expect(await livePaint(page, "march")).toBeGreaterThan(200);

      // Paused, everything stands still once the last arrival pulses fade (0.7 s at most): no new
      // frames, and the march keeps its place.
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-still", "1");
      let still = -1;
      await expect
        .poll(
          async () => {
            const now = await count(page, "frames");
            const same = now === still;
            still = now;
            return same;
          },
          { intervals: [900], timeout: 8000 },
        )
        .toBe(true);
      const ants = await pixels(page, "march");
      await animationFrames(page, 20);
      expect(await count(page, "frames")).toBe(still);
      expect(await pixels(page, "march")).toEqual(ants);
      expectNoErrors(consoleErrors);
    });

    test("a dot passing behind an edge label pill is drawn dimmed above it", async ({ page, consoleErrors }) => {
      await goLive(page, renderer);
      // The overlay has paint inside the pill only while a dot passes, and never at full strength.
      // (The pill is re-read each time: the view may still be fitting.)
      let peak = 0;
      await expect
        .poll(
          async () => {
            const pill = await page.getByTestId(`edge-label-${PILL}`).boundingBox();
            if (pill) peak = Math.max(peak, (await pixels(page, "over", pill)).peak);
            return peak;
          },
          { timeout: 10_000, intervals: [50] },
        )
        .toBeGreaterThan(20);
      expect(peak).toBeLessThan(200);
      expectNoErrors(consoleErrors);
    });

    test("a traced message's label is drawn above the pills where the hooks place it", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer, "&traffic=0&speed=0.5");
      await waitForCameraIdle(page);
      await openNodeMenu(page, "shopper", "sim.trace-next");
      // Pause before sending, so the label stays put: the message waits at the start of its first hop,
      // labelled. (Pausing once a label showed raced that hop: Storefront → Commerce gateway is 200 ms of
      // sim time, 0.4 s at 0.5×, and a pause that landed after it, at work in the gateway, had no label.)
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
      await page.getByTestId("trace-send-one").click();
      await expect
        .poll(async () => (await canvas(page).getAttribute("data-trace-labels")) ?? "", { timeout: 10_000 })
        .not.toBe("");
      // Find its pill on the overlay where the hook says it is (the hook is refreshed at the UI clock, so
      // give it a beat).
      await expect
        .poll(
          async () => {
            const [label] = JSON.parse((await canvas(page).getAttribute("data-trace-labels")) ?? "[]") as Box[];
            return label ? livePaint(page, "over", await clientRect(page, label)) : 0;
          },
          { timeout: 5000 },
        )
        .toBeGreaterThan(30);
      expectNoErrors(consoleErrors);
    });

    test("slow motion draws its dots and captions above the pills, over the frozen live view", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
      await openNodeMenu(page, "shopper", "sim.slowmo-from");
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "playing");
      await expect
        .poll(async () => JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]").length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
      // Pause the replay so the caption holds still, then find it on the overlay.
      // The replay camera may fit below 60%, where chips intentionally stop painting.
      await zoomIdentity(page, 0.8);
      await page.getByTestId("live-play").click();
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
      await expect
        .poll(
          async () => {
            const [caption] = JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]") as Box[];
            return caption ? livePaint(page, "over", await clientRect(page, caption)) : 0;
          },
          { timeout: 5000 },
        )
        .toBeGreaterThan(30);
      // Live is frozen and faint underneath (the background dots and the lit edges).
      expect(await livePaint(page, "base", undefined, 5)).toBeGreaterThan(50);
      expectNoErrors(consoleErrors);
    });

    test("clicking a particle traces its message (hit targets from the drawn frame)", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
      await waitForCameraIdle(page);
      await livePaint(page, "base");
      // A dot's opaque core, found on the particle layer, clear of node cards.
      const at = await page.evaluate(async () => {
        const el = document.querySelector('[data-testid="live-canvas"]');
        const probe = window.__liveProbe;
        if (!el || !probe) return null;
        const pane = el.getBoundingClientRect();
        const px = await probe("base", { x: pane.left, y: pane.top, width: pane.width, height: pane.height });
        const { data, width } = px;
        for (let i = 3; i < data.length; i += 4 * 7) {
          if (data[i] < 255) continue;
          const x = px.x + (((i - 3) / 4) % width) / px.scale;
          const y = px.y + Math.floor((i - 3) / 4 / width) / px.scale;
          const hit = document.elementFromPoint(x, y);
          if (hit && !hit.closest(".react-flow__node, button, [data-editor-overlay], .fe-label")) return { x, y };
        }
        return null;
      });
      if (!at) throw new Error("no opaque particle core on the canvas");
      await page.mouse.click(at.x, at.y);
      await expect(page.getByTestId("trace-card")).toBeVisible();
      expectNoErrors(consoleErrors);
    });

    test("a waiting note stops the march like pausing does (the sim clock stands still)", async ({
      page,
      consoleErrors,
    }) => {
      // Waiting, the controller still hands out fresh snapshots, at the same simulated time.
      await page.clock.install();
      // The pausing note comes 4 s into the simulation, once the session is up.
      await gotoLive(
        page,
        `./?view=canvas&example=${KAFKA}&sim=payments-outage&speed=8${renderer === "main" ? "&renderer=main" : ""}`,
      );
      await expect(page.getByTestId("live-note-continue")).toBeVisible();
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-still", "1");
      // The note's camera fit animates first; then the ants hold still (marching, they never would).
      let ants = await pixels(page, "march");
      await expect
        .poll(
          async () => {
            const now = await pixels(page, "march");
            const same = now.sum === ants.sum;
            ants = now;
            return same;
          },
          { intervals: [700], timeout: 8000 },
        )
        .toBe(true);
      expect(ants.peak).toBeGreaterThan(0);
      await pauseClock(page);
      await page.getByTestId("live-note-continue").click();
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
      // A controller resume and the decorator's next UI publication are separate
      // boundaries. Keep the fake clock moving until the resumed frame is visible.
      await expect
        .poll(async () => {
          await page.clock.runFor(125);
          return page.getByTestId("rf__wrapper").getAttribute("data-live-still");
        })
        .not.toBe("1");
      expectNoErrors(consoleErrors);
    });

    test("0.25× draws a calm sample of the traffic", async ({ page, consoleErrors }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(60);
      await page.getByTestId("live-speed").selectOption("0.25");
      await expect.poll(() => count(page, "particles"), { timeout: 8_000 }).toBeLessThan(50);
      expectNoErrors(consoleErrors);
    });
  });
}

/** Counts main-thread 2D canvas drawing calls (a worker's OffscreenCanvas contexts aren't these). */
const COUNT_DRAWS = `(() => {
  window.__draws = 0;
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ["drawImage", "fill", "stroke", "clearRect", "fillRect", "fillText", "putImageData"]) {
    const original = proto[name];
    proto[name] = function (...args) {
      window.__draws++;
      return original.apply(this, args);
    };
  }
  // The page's own animation frames: the main thread's frame count, whatever the worker manages to draw.
  window.__ticks = 0;
  const tick = () => {
    window.__ticks++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

declare global {
  interface Window {
    __draws: number;
    __ticks: number;
  }
}

/**
 * Main-thread draw calls, frames drawn, and the main thread's busy time per animation frame of the page (not per
 * frame the worker drew: a worker starved of CPU draws fewer), over a fixed number of page frames of live traffic.
 * The busy time is Chrome's own count of every task on the page's main thread (CDP Performance `TaskDuration`):
 * animation frames and the UI clock's updates every 125 ms, worker messages, React commits, style and layout. It
 * is counted in the thread's CPU time, so other processes competing for the CPU don't add to it.
 */
async function busyWindow(page: Page, framesToObserve: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
  const taskSeconds = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")?.value ?? 0;
  await page.evaluate(() => {
    window.__draws = 0;
  });
  const frames = await count(page, "frames");
  const ticks = await page.evaluate(() => window.__ticks);
  const busy = await taskSeconds();
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        const tick = () => {
          if (--frames <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    framesToObserve,
  );
  const busyMs = ((await taskSeconds()) - busy) * 1000;
  const pageFrames = (await page.evaluate(() => window.__ticks)) - ticks;
  await cdp.detach();
  return {
    draws: await page.evaluate(() => window.__draws),
    frames: (await count(page, "frames")) - frames,
    pageFrames,
    msPerFrame: busyMs / Math.max(pageFrames, 1),
    // Animations that would repaint (CSS) or recomposite (compositor) every frame while live: each
    // holds input a frame deeper (docs/BACKLOG.md). Transient transitions don't count.
    running: await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity)
        .map((a) => (a as CSSAnimation).animationName ?? "animation"),
    ),
  };
}

async function settleRenderer(page: Page) {
  await expect.poll(() => count(page, "particles"), { timeout: test.info().timeout }).toBeGreaterThan(40);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestIdleCallback(() => resolve()));
  });
  await waitForStableViewport(page);
}

test.describe("live rendering stays off the main thread", () => {
  performanceTest(
    "the worker path draws nothing on the main thread and runs no endless animation while live",
    async ({ page, consoleErrors }) => {
      // Two live page loads (the worker path, then the fallback), each of which may take the page-load budget on a busy
      // dev server (nightly #78: 14 s and 12 s, out of 30).
      test.slow();
      await page.addInitScript(COUNT_DRAWS);
      await goLive(page, "worker");
      await settleRenderer(page);
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-glow", "canvas");
      const playing: Awaited<ReturnType<typeof busyWindow>>[] = [];
      for (let i = 0; i < 3; i++) {
        const sample = await busyWindow(page, 30);
        playing.push(sample);
        expect(sample.frames, "the worker kept drawing alongside page frames").toBeGreaterThan(sample.pageFrames / 8);
        expect(sample.draws, "main-thread canvas calls across page frames").toBe(0);
        expect(sample.running).toEqual([]);
      }

      // The fallback really is on the main thread: the same check counts its drawing.
      await goLive(page, "main");
      await settleRenderer(page);
      const fallback: typeof playing = [];
      for (let i = 0; i < 3; i++) {
        const sample = await busyWindow(page, 30);
        fallback.push(sample);
        expect(sample.draws).toBeGreaterThan(sample.frames);
      }
      // And the point of the worker: the main thread's work per frame (all of it, not only the animation frames) is
      // well under the fallback's, which draws it all there: about 0.4 to 0.6 of it, measured; 0.8 at most. Both
      // measured in the same run, in thread CPU time. Not a budget in ms.
      const median = (samples: typeof playing) => samples.map((sample) => sample.msPerFrame).sort((a, b) => a - b)[1];
      expect(median(playing), JSON.stringify({ worker: playing, main: fallback })).toBeLessThan(median(fallback) * 0.8);
      expectNoErrors(consoleErrors);
    },
  );
});

/** The fallback took over on fresh canvases (once live view is up): particles and the march paint, the dot breathes in CSS. */
async function handedOver(page: Page) {
  await expect(canvas(page)).toHaveAttribute("data-renderer", "main", { timeout: 15_000 });
  await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(10);
  await expect.poll(() => livePaint(page, "base")).toBeGreaterThan(100);
  await expect.poll(() => livePaint(page, "march")).toBeGreaterThan(100);
  await expect(page.getByTestId("rf__wrapper")).not.toHaveAttribute("data-live-glow", "canvas");
}

test.describe("a particle worker that can't start hands over to the main thread", () => {
  test("its script never arrives (an error event)", async ({ page }) => {
    // A proxy, a CSP on worker-src, a broken deploy.
    await page.route(/particleWorker/, (route) => route.abort());
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
  });

  test("its constructor throws (a CSP, disabled workers, Trusted Types)", async ({ page, consoleErrors }) => {
    // The capability check still passes (it constructs nothing); the particle worker itself throws.
    await page.addInitScript(() => {
      const Real = window.Worker;
      window.Worker = function (this: Worker, url: string | URL, options?: WorkerOptions) {
        if (String(url).includes("particleWorker")) throw new DOMException("Blocked by policy", "SecurityError");
        return new Real(url, options);
      } as unknown as typeof Worker;
    });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
    expectNoErrors(consoleErrors);
  });

  test("a canvas can't be transferred", async ({ page, consoleErrors }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
        throw new DOMException("Cannot transfer", "InvalidStateError");
      };
    });
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
    expectNoErrors(consoleErrors);
  });
});
