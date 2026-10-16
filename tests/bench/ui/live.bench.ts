// Live view (docs/BENCHMARKS.md § Metrics): the per-frame cost of watching messages flow, on the main thread, with the
// particles drawn in a worker (the default where OffscreenCanvas works) and on the main thread (`renderer=main`, the
// fallback), at two message rates: x1, free play as it opens (the sources' rates at the automatic dot scale, about
// 60 dots a second), and x10 (Inputs ▸ Traffic × 10 at that same dot scale: ten times the dots). The engine's own
// cost at x100 is in the Node benchmarks (tests/bench/node/sim.bench.ts).
//
// Over five seconds after a three-second warm-up: main-thread busy (% of wall time) and task ms per animation frame
// (DevTools counters; CPU throttling applies to the main thread only, so the worker's own time is not in them),
// animation frames and particle frames per second, the longest animation frame, and the dots drawn.
//
// Memory: the JS heap after load with live on, and after a minute of playback (full mode only).

import type { Page } from "@playwright/test";
import { Bench, loadWorkload, MODE, round, test, uiSizes, uiSuite } from "./harness";

const s = uiSuite("live");

// Report-only: the gates are elsewhere (renders.bench.ts, memory.bench.ts).
test.skip(MODE === "gates", "report-only");

async function setTrafficTimesTen(page: Page) {
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("capacity-panel").waitFor();
  // Pin the dot scale where it is, so more traffic means more dots, not a coarser scale.
  const scale = await page.getByTestId("scale-indicator").getAttribute("data-scale");
  await page.getByTestId("scale-override").selectOption(String(scale));
  const slider = page.getByTestId("capacity-traffic-mult");
  await slider.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="capacity-traffic-mult"]')?.getAttribute("data-value") === "10",
  );
  await page.getByTestId("capacity-close").click();
}

/** Five seconds of playback: what the main thread spent, and how smoothly it drew. */
async function watch(b: Bench, ms = 5_000) {
  const read = () =>
    b.page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('[data-testid="live-canvas"]');
      return {
        frames: Number(c?.dataset.frames ?? NaN),
        particles: Number(c?.dataset.particles ?? 0),
        renderer: c?.dataset.renderer ?? "",
      };
    });
  await b.mark();
  await b.page.evaluate(() => window.__bench.startFrames());
  const c0 = await read();
  const m0 = await b.metrics();
  const t0 = Date.now();
  await b.page.waitForTimeout(ms);
  const m1 = await b.metrics();
  const wall = Date.now() - t0;
  const c1 = await read();
  const raf = (await b.page.evaluate(() => window.__bench.stopFrames())).length;
  const e = await b.entries();
  const task = m1.TaskDuration - m0.TaskDuration;
  return {
    renderer: c1.renderer,
    busyPct: round((task / wall) * 100, 1),
    msPerFrame: round(task / Math.max(1, raf), 2),
    fps: round((raf / wall) * 1000, 1),
    particleFps: round(((Number.isFinite(c1.frames - c0.frames) ? c1.frames - c0.frames : raf) / wall) * 1000, 1),
    longest: Math.max(0, ...e.loaf.map((f) => f.duration)),
    dots: c1.particles,
  };
}

const LIVE: [string, number[]][] = [
  ["pipeline", [100, 500, 1_500, 5_000]],
  ["mesh", [100, 500, 1_500]],
];

for (const [family, sizes] of LIVE)
  for (const n of uiSizes(sizes))
    test(`live ${family}@${n}`, async ({ browser }) => {
      const w = loadWorkload(family, n);
      for (const renderer of ["worker", "main"] as const)
        for (const rate of ["x1", "x10"] as const) {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
          try {
            const page = await context.newPage();
            const b = await Bench.create(page);
            await b.open(w, { query: renderer === "main" ? "&renderer=main" : "" });
            await b.settle(3_000, 300_000);
            await b.goLive(0);
            if (rate === "x10") await setTrafficTimesTen(page);
            await page.waitForTimeout(3_000);
            const r = await watch(b);
            const detail = `${renderer}/${rate}`;
            // The worker renderer falls back to the main thread when it can't start or keep up (it did at 5,000 nodes):
            // record which one drew, so the numbers aren't read as the worker's.
            s.count("rendererFellBack", r.renderer === renderer ? 0 : 1, { w: w.info, detail });
            s.count("mainBusyPct", r.busyPct, { w: w.info, detail, unit: "%" });
            s.time("mainMsPerFrame", [r.msPerFrame], w.info, detail, "main-thread task ms per animation frame");
            s.time("longestFrame", [r.longest], w.info, detail);
            s.count("fps", r.fps, { w: w.info, detail, unit: "frames/s" });
            s.count("particleFps", r.particleFps, { w: w.info, detail, unit: "frames/s" });
            s.count("dots", r.dots, { w: w.info, detail });
          } finally {
            await context.close();
          }
        }
    });

test("live memory over a minute", async ({ page }) => {
  test.skip(MODE !== "full", "a minute of playback: full runs only");
  const w = loadWorkload("pipeline", 1_500);
  const b = await Bench.create(page);
  await b.open(w);
  await b.settle(3_000, 300_000);
  await b.goLive();
  const start = await b.heap();
  const dom0 = await b.domCounters();
  await page.waitForTimeout(60_000);
  const end = await b.heap();
  const dom1 = await b.domCounters();
  s.count("heapLiveStart", start, { w: w.info, unit: "bytes" });
  s.count("heapLiveAfter60s", end, { w: w.info, unit: "bytes" });
  s.count("heapLiveGrowth60s", end - start, { w: w.info, unit: "bytes" });
  s.count("domNodesLiveGrowth60s", dom1.nodes - dom0.nodes, { w: w.info });
});
