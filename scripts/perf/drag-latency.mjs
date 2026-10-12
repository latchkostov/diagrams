// Node-drag responsiveness, measured in a real Chromium: the drawing-UX gate for smart guides (batch 2).
//
//   node scripts/perf/drag-latency.mjs --url http://localhost:5556/ [--throttle 4] [--runs 5] [--label master]
//
// Serve an e2e build first (`VITE_E2E=1 pnpm exec vite build --outDir <dir>` then
// `pnpm exec vite preview --outDir <dir> --port 5556`): production React, plus the Lab, which opens the
// generated 150-node diagram in the editor. For each diagram (the Kafka example, and Lab's stress-150) and
// each CPU throttle rate, it drags one node along a fixed path at about 60 moves a second, slowing down
// near the end (where smart guides engage), and records:
//  - Event Timing entries (`durationThreshold: 16`) during the drag: the worst one, and how many reached
//    16 ms. Pointer moves aren't reported by Event Timing, but the pointer-over/out events the drag crosses
//    are, and their duration runs to the next paint.
//  - Animation frame gaps (rAF intervals): p50, p90 and max.
//  - The longest long-animation-frame entry.
// Results print as JSON lines and a table. Not part of the e2e suite (timings depend on the machine).

/* global window, performance, requestAnimationFrame -- page.evaluate callbacks run in the browser */
import { chromium } from "@playwright/test";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
}
const BASE = args.url ?? "http://localhost:5556/";
const THROTTLES = (args.throttle ?? "4").split(",").map(Number);
const RUNS = Number(args.runs ?? 5);
const LABEL = args.label ?? BASE;
const ONLY = args.only ? new Set(args.only.split(",")) : null;

const OBSERVER = `(() => {
  window.__et = [];
  window.__loaf = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__et.push({ name: e.name, start: e.startTime, duration: e.duration });
  }).observe({ type: "event", durationThreshold: 16, buffered: false });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__loaf.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "long-animation-frame" });
  } catch {}
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

const DIAGRAMS = [
  {
    name: "kafka",
    open: async (page) => {
      await page.goto(`${BASE}?view=canvas&example=kafka-order-pipeline`);
      await page.getByTestId("node-orders").waitFor();
    },
    node: "node-orders",
    // Right and down, back up towards its row (where it aligns with its neighbours), slowing at the end.
    path: [
      [140, 90],
      [60, 30],
      [8, 4],
    ],
  },
  {
    name: "stress-150",
    open: async (page) => {
      await page.goto(`${BASE}?view=lab&preset=stress-150`);
      await page.getByTestId("lab-open-editor").click();
      await page.getByTestId("node-n75").waitFor();
    },
    node: "node-n75",
    path: [
      [140, 90],
      [60, 30],
      [8, 4],
    ],
  },
];

async function measureOnce(browser, diagram, throttle) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  await page.addInitScript(OBSERVER);
  const cdp = await context.newCDPSession(page);
  await diagram.open(page);
  await sleep(2500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await sleep(500);
  const box = await page.getByTestId(diagram.node).boundingBox();
  if (!box) throw new Error(`${diagram.node} not found`);
  let x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await sleep(300);
  const t0 = await page.evaluate(() => {
    window.__gaps = [];
    window.__rafOn = true;
    let last = performance.now();
    const loop = (t) => {
      window.__gaps.push(t - last);
      last = t;
      if (window.__rafOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return performance.now();
  });
  await page.mouse.down();
  // Each leg: [dx, dy] split into 16 ms moves of at most ~6 px, the last leg slower (smart guides engage).
  for (const [i, [dx, dy]] of diagram.path.entries()) {
    const steps = Math.max(2, Math.round(Math.hypot(dx, dy) / (i === diagram.path.length - 1 ? 1 : 6)));
    for (let s = 1; s <= steps; s++) {
      await page.mouse.move(x + (dx * s) / steps, y + (dy * s) / steps);
      await sleep(16);
    }
    x += dx;
    y += dy;
  }
  await sleep(120);
  await page.mouse.up();
  await sleep(400);
  const r = await page.evaluate((start) => {
    window.__rafOn = false;
    const events = window.__et.filter((e) => e.start >= start);
    return {
      events: events.map((e) => e.duration),
      names: [...new Set(events.filter((e) => e.duration >= 16).map((e) => e.name))],
      top: [...events]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((e) => `${e.name}@${Math.round(e.start - start)}:${Math.round(e.duration)}`),
      gaps: window.__gaps.slice(1),
      loaf: window.__loaf.filter((e) => e.start >= start).map((e) => e.duration),
    };
  }, t0);
  await context.close();
  return {
    worstEvent: Math.round(Math.max(0, ...r.events)),
    over16: r.events.filter((d) => d >= 16).length,
    names: r.names,
    top: r.top,
    frameP50: Math.round(pct(r.gaps, 50)),
    frameP90: Math.round(pct(r.gaps, 90)),
    frameMax: Math.round(Math.max(0, ...r.gaps)),
    loafMax: Math.round(Math.max(0, ...r.loaf)),
  };
}

const browser = await chromium.launch();
const table = [];
for (const diagram of DIAGRAMS) {
  if (ONLY && !ONLY.has(diagram.name)) continue;
  for (const throttle of THROTTLES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await measureOnce(browser, diagram, throttle);
      console.log(JSON.stringify({ label: LABEL, diagram: diagram.name, throttle, run: i + 1, ...r }));
      runs.push(r);
    }
    table.push({ diagram: diagram.name, throttle, runs });
  }
}
await browser.close();

const range = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[0] === s[s.length - 1] ? `${s[0]}` : `${s[0]}–${s[s.length - 1]} (median ${pct(s, 50)})`;
};
console.log(`\n${LABEL}`);
for (const { diagram, throttle, runs } of table) {
  console.log(
    `${diagram.padEnd(11)} ${throttle}x  worst event ${range(runs.map((r) => r.worstEvent))} ms | frames p50 ${range(
      runs.map((r) => r.frameP50),
    )}, p90 ${range(runs.map((r) => r.frameP90))}, max ${range(runs.map((r) => r.frameMax))} ms | LoAF max ${range(
      runs.map((r) => r.loafMax),
    )} ms`,
  );
}
