// Cold load (docs/BENCHMARKS.md § Metrics): a fresh browser context (no cache, empty storage but for the diagram), the
// diagram stored as a saved one, the canvas URL opened. Per workload and size, the median of a few runs of:
// - firstNode: navigation start to the first frame with a diagram node on screen (first meaningful render);
// - settled: to the end of the last long animation frame, once three seconds pass without one (the page is usable);
// - mainThread: main-thread task time from navigation until three seconds without a long frame, with its script, style
//   and layout parts (DevTools counters; it includes what idle time loads in those seconds);
// - longestFrame, blocking: the longest animation frame, and the long frames' blocking time in all;
// - checksDone: to the frame after the first architecture check run finished (in its worker) and was delivered;
// - heapAfterLoad: JS heap after a full GC; domNodes and listeners after it.

import { Bench, MODE, loadWorkload, repeat, runsFor, test, uiSizes, uiSuite, VIEWPORT, type AppHooks } from "./harness";

const s = uiSuite("load");

// Report-only: the gates are elsewhere (renders.bench.ts, memory.bench.ts).
test.skip(MODE === "gates", "report-only");
const FAMILIES = ["mesh", "pipeline", "k8s", "terraform", "annotated", "examples"];

for (const family of FAMILIES)
  for (const n of uiSizes([100, 500, 1_500, 5_000]))
    test(`cold load ${family}@${n}`, async ({ browser }) => {
      const w = loadWorkload(family, n);
      const v: Record<string, number[]> = {};
      let timedOut = 0;
      const push = (k: string, x: number) => (v[k] ??= []).push(x);
      await repeat(runsFor(n), async () => {
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
        try {
          const page = await context.newPage();
          const b = await Bench.create(page);
          // When the first check run has finished (the e2e build's window.__checks), polled once a frame from the start.
          await page.addInitScript(() => {
            const win = window as unknown as { __checksAt?: number };
            void window.__bench
              .until(() => ((window as AppHooks).__checks?.finished ?? 0) > 0)
              .then((t) => (win.__checksAt = t));
          });
          // A load that shows nothing in five minutes is a result too (the mesh at 5,000 nodes, today).
          const LIMIT = 300_000;
          const opened = await b.open(w, { timeoutMs: LIMIT }).then(
            () => true,
            () => false,
          );
          if (!opened) {
            timedOut = LIMIT;
            return;
          }
          // Three quiet seconds: the canvas routes its edges in a frame of its own after the first paint, which can
          // start more than a second later.
          const quiet = await b.settle(3_000, 300_000);
          const m = await b.metrics();
          const e = await b.entries();
          // The readings above waited for any frame still running: the page settled when the last long one ended.
          const settled = Math.max(quiet, ...e.loaf.map((f) => f.start + f.duration));
          const checksAt = await page
            .waitForFunction(() => (window as unknown as { __checksAt?: number }).__checksAt, undefined, {
              timeout: 120_000,
            })
            .then((h) => h.jsonValue() as Promise<number>)
            .catch(() => NaN);
          push("checksDone", checksAt);
          const upTo = e.loaf.filter((f) => f.start <= settled);
          push("firstNode", e.firstNode);
          push("settled", settled);
          push("mainThread", m.TaskDuration);
          push("script", m.ScriptDuration);
          push("styleRecalc", m.RecalcStyleDuration);
          push("layout", m.LayoutDuration);
          push("longestFrame", Math.max(0, ...upTo.map((f) => f.duration)));
          push(
            "blocking",
            upTo.reduce((sum, f) => sum + f.blocking, 0),
          );
          push("heapAfterLoad", await b.heap());
          const dom = await b.domCounters();
          push("domNodes", dom.nodes);
          push("listeners", dom.jsEventListeners);
        } finally {
          await context.close();
        }
      });
      if (timedOut) s.count("firstNodeTimedOut", timedOut, { w: w.info, unit: "ms" });
      if (!v.firstNode) return;
      for (const k of [
        "firstNode",
        "settled",
        "checksDone",
        "mainThread",
        "script",
        "styleRecalc",
        "layout",
        "longestFrame",
        "blocking",
      ])
        if (v[k].some(Number.isFinite)) s.time(k, v[k], w.info);
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
      s.count("heapAfterLoad", median(v.heapAfterLoad), { w: w.info, unit: "bytes" });
      s.count("domNodes", median(v.domNodes), { w: w.info });
      s.count("listeners", median(v.listeners), { w: w.info });
    });
