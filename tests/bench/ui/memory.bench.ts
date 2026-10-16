// Leaks across open and close cycles (docs/BENCHMARKS.md § Metrics, § Gates), on the e2e build. After two warm-up
// cycles (lazy code and first-use DOM settle), a full garbage collection and a reading of the DOM nodes and JS event
// listeners alive (Memory.getDOMCounters) and the JS heap; then CYCLES more cycles and a reading, and CYCLES more and
// another. What the second window keeps per cycle is a leak: a listener added on open and never removed, a dialog's
// DOM kept by a closure. The first window is reported too: something kept once (a bounded cache, a notice) shows
// there and not in the second (live view's first few sessions keep about 14 nodes and 4 listeners once, sometimes
// after the warm-up: that's why the gate reads the second window).
//
// DOM nodes and listeners are counts: they gate. The heap is report-only (its growth per cycle is noisy at this
// scale; a leak big enough to matter shows in the counts or in the nightly trend).

import type { Page } from "@playwright/test";
import { Bench, loadWorkload, MODE, round, test, uiSuite } from "./harness";

const s = uiSuite("memory");
const CYCLES = MODE === "full" ? 10 : 5;

/** Per cycle, at most (counts after GC): today's are 0 to 0.2; one leaked listener or node per cycle is 1. */
const BUDGET = { nodes: 0.6, listeners: 0.6 };

type Cycle = (page: Page, b: Bench) => Promise<void>;

const CYCLES_UNDER_TEST: [string, Cycle][] = [
  [
    "inspector",
    async (page, b) => {
      await page.getByTestId("inspector-toggle").click();
      await page.getByTestId("inspector").waitFor();
      await b.frames(2);
      await page.getByTestId("inspector-toggle").click();
      await b.frames(2);
    },
  ],
  [
    "commandPalette",
    async (page, b) => {
      await page.keyboard.press("Control+k");
      await page.getByTestId("command-palette").waitFor();
      await b.frames(2);
      await page.keyboard.press("Escape");
      await page.getByTestId("command-palette").waitFor({ state: "detached" });
    },
  ],
  [
    "exportDialog",
    async (page, b) => {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-more-formats").click();
      await page.getByTestId("export-image").click();
      await page.getByTestId("image-dialog").waitFor();
      await b.frames(2);
      await page.keyboard.press("Escape");
      await page.getByTestId("image-dialog").waitFor({ state: "detached" });
    },
  ],
  [
    "liveView",
    async (page, b) => {
      await page.getByTestId("live-toggle").click();
      await page.getByTestId("live-controls").waitFor();
      await page.waitForTimeout(500);
      await page.getByTestId("live-toggle").click();
      await page.getByTestId("live-controls").waitFor({ state: "detached" });
      await b.frames(2);
    },
  ],
];

for (const [name, cycle] of CYCLES_UNDER_TEST)
  test(`open and close ${name}`, async ({ page }) => {
    const w = loadWorkload("pipeline", 500);
    const b = await Bench.create(page);
    await b.open(w);
    await b.settle(3_000, 300_000);
    // Focus the canvas, so keyboard shortcuts reach it.
    const spot = await b.emptySpot();
    await page.mouse.click(spot.x, spot.y);
    for (let i = 0; i < 2; i++) await cycle(page, b);
    const reading = async () => {
      for (let i = 0; i < CYCLES; i++) await cycle(page, b);
      await b.settle(500);
      return { heap: await b.heap(), dom: await b.domCounters() };
    };
    await b.settle(500);
    const r0 = { heap: await b.heap(), dom: await b.domCounters() };
    const r1 = await reading();
    const r2 = await reading();
    const per = (x: number) => round(x / CYCLES, 2);
    s.count(`${name}/domNodesPerCycle`, per(r2.dom.nodes - r1.dom.nodes), {
      w: w.info,
      limit: BUDGET.nodes,
      why: "DOM nodes left alive per open and close (second window)",
    });
    s.count(`${name}/listenersPerCycle`, per(r2.dom.jsEventListeners - r1.dom.jsEventListeners), {
      w: w.info,
      limit: BUDGET.listeners,
      why: "event listeners left attached per open and close (second window)",
    });
    s.count(`${name}/domNodesFirstWindow`, r1.dom.nodes - r0.dom.nodes, { w: w.info });
    s.count(`${name}/listenersFirstWindow`, r1.dom.jsEventListeners - r0.dom.jsEventListeners, { w: w.info });
    s.count(`${name}/heapPerCycle`, Math.round((r2.heap - r1.heap) / CYCLES), { w: w.info, unit: "bytes" });
  });
