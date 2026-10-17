// Live view (docs/BENCHMARKS.md § Metrics, § Live view on large diagrams): the per-frame cost of watching messages
// flow, on the main thread, with the particles drawn in a worker (the default where OffscreenCanvas works) and on the
// main thread (`renderer=main`, the fallback), at two message rates: x1, free play as it opens (the sources' rates at
// the automatic dot scale, about 60 dots a second), and x10 (Traffic × 10 at that same dot scale: ten times the dots).
// The engine's own cost at x100 is in the Node benchmarks (tests/bench/node/sim.bench.ts).
//
// x1 and x10 measure the same scene: x10 is set through the e2e build's hook (`__liveBench.timesTen`), because opening
// Inputs & capacity turns the heat map on for the session. `x10heat` is the separate case of a person doing it there:
// the panel opened, the slider moved, the panel closed with a click (how long the close took is recorded; a slow one
// never fails the run), heat map on.
//
// After switching to x10: the transient, measured on its own (`slowPhaseMs` until frames stay within twice the steady
// frame, the frame rate meanwhile, and the composited layers and running CSS transitions at their peak), then five
// seconds of steady state: main-thread busy (% of wall time) and task ms per animation frame (DevTools counters; CPU
// throttling applies to the main thread only, so the worker's own time is not in them), animation frames and particle
// frames per second, the longest animation frame, and the dots drawn.
//
// Gates (counts, no milliseconds): on a large diagram (decorations.ts, LARGE_LIVE_ELEMENTS), running CSS transitions
// under LIVE_TRANSITIONS_PER_100_LIMIT per 100 nodes and edges, the layers at x10 within
// LIVE_LAYER_RATIO_LIMIT times those at x1, and edges flipping between active and idle per publish under
// LIVE_FLIPS_PER_100_EDGES_LIMIT per 100 edges (that one in `live gates` only). `live gates` holds them in
// `pnpm bench:gates`.
//
// Memory: the JS heap after load with live on, and after a minute of playback (full mode only).

import type { CDPSession, Page } from "@playwright/test";
import {
  flipsPer100Edges,
  layerCount,
  layerRatio,
  LIVE_FLIPS_PER_100_EDGES_LIMIT,
  LIVE_LAYER_RATIO_LIMIT,
  LIVE_TRANSITIONS_PER_100_LIMIT,
  per100,
  slowPhase,
  steadyTail,
} from "../../../src/bench/liveMetrics";
import { Bench, loadWorkload, MODE, round, test, uiSizes, uiSuite, type AppHooks } from "./harness";

const s = uiSuite("live");

/** The longest the transient after x10 is recorded before steady state is measured anyway. */
const TRANSIENT_CAP_MS = MODE === "full" ? 120_000 : 30_000;
/** A close click on the panel that takes longer than this is recorded as timed out (the run goes on). */
const CLOSE_CAP_MS = 10 * 60_000;

type Rate = "x1" | "x10" | "x10heat";
type Hook = NonNullable<AppHooks["__liveBench"]>;

const hook = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as AppHooks).__liveBench, null, { timeout: 180_000 });

/** Traffic × 10 at the dot scale in use, without opening the panel. */
async function timesTen(page: Page) {
  await hook(page);
  await page.evaluate(() => (window as unknown as Required<AppHooks>).__liveBench.timesTen());
}

const decorations = (page: Page): Promise<Hook["decorations"]> =>
  page.evaluate(() => ({ ...(window as unknown as Required<AppHooks>).__liveBench.decorations }));

/** As a person does it: Inputs & capacity, the dot scale pinned, the Traffic slider to its end, then close. */
async function timesTenInPanel(page: Page): Promise<{ closeMs: number; closeTimedOut: number }> {
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
  // The click lands at once; the page may take long to answer after it (a starved main thread). Record, don't fail.
  const t0 = Date.now();
  try {
    await page.getByTestId("capacity-close").click({ timeout: CLOSE_CAP_MS });
    await page.getByTestId("capacity-panel").waitFor({ state: "detached", timeout: CLOSE_CAP_MS });
    return { closeMs: Date.now() - t0, closeTimedOut: 0 };
  } catch {
    return { closeMs: Date.now() - t0, closeTimedOut: 1 };
  }
}

/** The compositor's layer count, from the next DevTools LayerTree update (null if none came). */
async function layers(cdp: CDPSession, timeoutMs = 30_000): Promise<number | null> {
  let done: (n: number | null) => void = () => {};
  const seen = new Promise<number | null>((resolve) => (done = resolve));
  const on = (e: { layers?: unknown[] }) => {
    const n = layerCount(e);
    if (n !== null) done(n);
  };
  const timer = setTimeout(() => done(null), timeoutMs);
  cdp.on("LayerTree.layerTreeDidChange", on);
  await cdp.send("LayerTree.enable");
  const n = await seen;
  clearTimeout(timer);
  cdp.off("LayerTree.layerTreeDidChange", on);
  await cdp.send("LayerTree.disable");
  return n;
}

/** CSS transitions running now (each one animated on its own). */
const transitions = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length,
  );

/** The layers and running transitions right now. */
async function scene(b: Bench) {
  return { layers: await layers(b.cdp), transitions: await transitions(b.page) };
}

/**
 * From the switch to x10: frames until they settle (or the cap), sampling layers and transitions on the way; the
 * slow phase is read from the frames afterwards.
 */
async function transient(b: Bench) {
  await b.page.evaluate(() => window.__bench.startFrames());
  const t0 = Date.now();
  let peakLayers = 0;
  let peakTransitions = 0;
  for (;;) {
    await b.page.waitForTimeout(1_500);
    const now = await scene(b);
    peakLayers = Math.max(peakLayers, now.layers ?? 0);
    peakTransitions = Math.max(peakTransitions, now.transitions);
    const sofar = await b.page.evaluate(() => window.__bench.frames.slice());
    if (steadyTail(sofar).stable || Date.now() - t0 > TRANSIENT_CAP_MS) break;
  }
  const frames = await b.page.evaluate(() => window.__bench.stopFrames());
  const steady = steadyTail(frames);
  const slow = slowPhase(frames, steady.gapMs);
  return { ...slow, steadyFps: steady.fps, peakLayers, peakTransitions };
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

/**
 * Records the gates for one x10 window, held on a large diagram only: running transitions, layers against x1, edge
 * churn.
 */
function gates(
  w: ReturnType<typeof loadWorkload>,
  detail: string,
  o: {
    x1Layers: number | null;
    x10Layers: number;
    x10Transitions: number;
    flips: number;
    publishes: number;
    elements: number;
    large: boolean;
    /**
     * Gate the edge churn: only in `live gates`. Per publish it depends on how much simulated time a publish covers,
     * which grows as frames slow down (5,000 nodes), so elsewhere it's reported only.
     */
    gateFlips?: boolean;
  },
) {
  const ratio = round(layerRatio(o.x1Layers ?? 0, o.x10Layers), 2);
  const churn = round(flipsPer100Edges(o.flips, o.publishes, w.info.edges), 2);
  const fades = round(per100(o.x10Transitions, o.elements), 2);
  s.count("layersX1", o.x1Layers ?? NaN, { w: w.info, detail });
  s.count("layersX10Peak", o.x10Layers, { w: w.info, detail });
  // Small diagrams keep their fades on purpose (decorations.ts): the gates hold where they're dropped.
  const limit = (l: number) => (o.large ? { limit: l } : {});
  s.count("transitionsX10Peak", o.x10Transitions, { w: w.info, detail });
  s.count("transitionsX10Per100Elements", fades, {
    w: w.info,
    detail,
    ...limit(LIVE_TRANSITIONS_PER_100_LIMIT),
    why: "CSS transitions running at x10 per 100 nodes and edges: each is animated on its own",
  });
  s.count("layerRatioX10", ratio, {
    w: w.info,
    detail,
    ...limit(LIVE_LAYER_RATIO_LIMIT),
    why: "composited layers at x10 against x1, same workload: per-element fades multiplied them",
  });
  s.count("edgeFlipsPer100EdgesPerPublish", churn, {
    w: w.info,
    detail,
    ...(o.gateFlips ? limit(LIVE_FLIPS_PER_100_EDGES_LIMIT) : {}),
    why: "edges changing active/idle per publish: the hold keeps a busy edge lit",
  });
}

async function liveCase(
  browser: import("@playwright/test").Browser,
  w: ReturnType<typeof loadWorkload>,
  renderer: "worker" | "main",
  rate: Rate,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const b = await Bench.create(page);
    await b.open(w, { query: renderer === "main" ? "&renderer=main" : "" });
    await b.settle(3_000, 300_000);
    await b.goLive(0);
    const detail = `${renderer}/${rate}`;
    await hook(page);
    if (rate !== "x1") {
      await page.waitForTimeout(3_000);
      const x1 = await scene(b);
      const d0 = await decorations(page);
      if (rate === "x10") await timesTen(page);
      else {
        const close = await timesTenInPanel(page);
        s.time("panelCloseMs", [close.closeMs], w.info, detail, "Traffic × 10 set in the panel: the close click");
        s.count("panelCloseTimedOut", close.closeTimedOut, { w: w.info, detail });
      }
      const t = await transient(b);
      const d1 = await decorations(page);
      s.time("slowPhaseMs", [t.slowPhaseMs], w.info, detail, "from x10 until frames stay within 2x the steady frame");
      s.count("slowPhaseSettled", t.settled ? 1 : 0, { w: w.info, detail });
      s.count("slowPhaseFps", round(t.slowPhaseFps, 2), { w: w.info, detail, unit: "frames/s" });
      s.count("steadyFps", round(t.steadyFps, 2), { w: w.info, detail, unit: "frames/s" });
      s.count("transitionsX1", x1.transitions, { w: w.info, detail });
      gates(w, detail, {
        x1Layers: x1.layers,
        x10Layers: t.peakLayers,
        x10Transitions: t.peakTransitions,
        elements: d1.elements,
        flips: d1.edgeFlips - d0.edgeFlips,
        publishes: d1.publishes - d0.publishes,
        large: d1.large,
      });
    } else await page.waitForTimeout(3_000);
    const r = await watch(b);
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

const LIVE: [string, number[]][] = [
  ["pipeline", [100, 500, 1_500, 5_000]],
  ["mesh", [100, 500, 1_500]],
];

for (const [family, sizes] of LIVE)
  for (const n of uiSizes(sizes))
    test(`live ${family}@${n}`, async ({ browser }) => {
      test.skip(MODE === "gates", "report-only: the gates are in `live gates`");
      // Five cases, each loading the workload and recording the transient: the biggest take tens of minutes.
      test.setTimeout(90 * 60_000);
      const w = loadWorkload(family, n);
      for (const renderer of ["worker", "main"] as const)
        for (const rate of ["x1", "x10"] as const) await liveCase(browser, w, renderer, rate);
      // Users do open the panel: once, with the default renderer.
      await liveCase(browser, w, "worker", "x10heat");
    });

/**
 * The gates on their own, cheap enough for `pnpm bench:gates`: a large pipeline, x1 then x10 on one page, layers
 * and edge churn over a few seconds of each. Counts only.
 */
const GATE_N = 1_500;
test(`live gates pipeline@${GATE_N}`, async ({ page }) => {
  test.skip(MODE === "quick", "a large workload");
  const w = loadWorkload("pipeline", GATE_N);
  const b = await Bench.create(page);
  await b.open(w);
  await b.settle(3_000, 300_000);
  await b.goLive(0);
  await hook(page);
  await page.waitForTimeout(3_000);
  const x1 = await scene(b);
  await timesTen(page);
  const d0 = await decorations(page);
  let peak = 0;
  let fades = 0;
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1_500);
    const now = await scene(b);
    peak = Math.max(peak, now.layers ?? 0);
    fades = Math.max(fades, now.transitions);
  }
  const d1 = await decorations(page);
  gates(w, "gates", {
    x1Layers: x1.layers,
    x10Layers: peak,
    x10Transitions: fades,
    elements: d1.elements,
    flips: d1.edgeFlips - d0.edgeFlips,
    publishes: d1.publishes - d0.publishes,
    large: d1.large,
    gateFlips: true,
  });
  s.count("decoratedElements", d1.elements, { w: w.info, detail: "gates" });
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
