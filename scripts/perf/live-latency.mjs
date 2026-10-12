// Live view input latency, main-thread time and frame rate, measured in a real Chromium.
//
//   node scripts/perf/live-latency.mjs --url http://localhost:5556/ [--query renderer=main] [--throttle 1,4]
//
// Serve a production build first (`pnpm build && pnpm exec vite preview --port 5556`): development
// React is several times slower and would measure the wrong thing. For each CPU throttle rate it opens
// the Kafka example live at 1x and, while messages flow:
//  - hovers every row of the canvas right-click menu and of the Ctrl+K palette, then walks each with
//    the arrow keys, recording Event Timing entries (`PerformanceObserver`, type "event"). Event Timing
//    only reports events of 16 ms or more, rounded to 8 ms, so a step with no entry counts as "<16".
//  - idles for 5 s and reads main-thread task time (CDP Performance.getMetrics), main-thread
//    animation frames (rAF callbacks) and particle frames (the canvas's `data-frames` counter when the
//    renderer exposes it, else the rAF count: the main-thread renderer draws in every frame).
// Results print as JSON lines and a table. Not part of the e2e suite (timings depend on the machine).

/* global window, document, performance, requestAnimationFrame -- page.evaluate callbacks run in the browser */
import { chromium } from "@playwright/test";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";

/** `--name value` pairs (a flag with no value is ""). */
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
}
const BASE = args.url ?? "http://localhost:5556/";
const QUERY = args.query ? `&${args.query}` : "";
const THROTTLES = (args.throttle ?? "1,4").split(",").map(Number);
const LABEL = args.label ?? (QUERY || "default");
const HEADED = args.headed !== undefined;
/** Extra CSS for an experiment, e.g. --css ".fe-path{animation:none!important}". */
const CSS = args.css;
/** Pause the simulation before measuring (the paused live view's own cost). */
const PAUSED = args.paused !== undefined;
/** Edit mode instead of live (the calibration: what a hover costs with nothing animating). */
const EDIT = args.edit !== undefined;

const OBSERVER = `(() => {
  window.__et = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__et.push({ name: e.name, start: e.startTime, duration: e.duration });
  }).observe({ type: "event", durationThreshold: 16, buffered: false });
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

/** Runs `steps` (each an async action), recording the longest Event Timing entry inside each step. */
async function timedSteps(page, steps) {
  const out = [];
  for (const step of steps) {
    const t0 = await page.evaluate(() => performance.now());
    await step();
    await sleep(140);
    const t1 = await page.evaluate(() => performance.now());
    const longest = await page.evaluate(
      ([a, b]) => Math.max(0, ...window.__et.filter((e) => e.start >= a && e.start < b).map((e) => e.duration)),
      [t0, t1],
    );
    out.push(longest);
  }
  return out;
}

function summarize(values) {
  const seen = values.filter((v) => v > 0);
  // Below Event Timing's 16 ms floor counts as 8 for the median (it reads "<16").
  const all = values.map((v) => (v > 0 ? v : 8));
  const fmt = (v) => (v === null ? "-" : v <= 8 ? "<16" : `${Math.round(v)}`);
  return {
    n: values.length,
    over16: seen.length,
    p50: fmt(median(all)),
    p90: fmt(pct(all, 90)),
    max: fmt(Math.max(8, ...all)),
  };
}

async function itemsIn(page, listTestId, prefix) {
  return page
    .getByTestId(listTestId)
    .locator(`[data-testid^="${prefix}"]:not([aria-disabled="true"]):not([aria-haspopup])`)
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
}

async function hoverSteps(page, ids, rounds) {
  const steps = [];
  for (let r = 0; r < rounds; r++)
    for (const id of ids)
      steps.push(async () => {
        const box = await page.getByTestId(id).boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      });
  return steps;
}

async function measureOnce(browser, throttle) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  await page.addInitScript(OBSERVER);
  const cdp = await context.newCDPSession(page);
  await page.goto(`${BASE}?view=canvas&example=kafka-order-pipeline${EDIT ? "" : "&live=1"}${QUERY}`);
  await page.getByTestId(EDIT ? "node-gateway" : "live-controls").waitFor();
  if (CSS) await page.addStyleTag({ content: CSS });
  await sleep(2500);
  if (PAUSED) await page.getByTestId("live-play").click();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  await sleep(1000);

  // Idle window: main-thread time, rAF frames and particle frames over 5 s.
  const metric = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  const counted = await page.evaluate(() => {
    window.__raf = 0;
    window.__rafStop = false;
    const loop = () => {
      window.__raf++;
      if (!window.__rafStop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const c = document.querySelector('[data-testid="live-canvas"]');
    return { frames: Number(c?.dataset.frames ?? NaN), renderer: c?.dataset.renderer ?? "main (no hook)" };
  });
  const m0 = await metric();
  const w0 = Date.now();
  await sleep(5000);
  const m1 = await metric();
  const wall = (Date.now() - w0) / 1000;
  const after = await page.evaluate(() => {
    // Stop counting: an extra rAF loop must not run during the input measurements.
    window.__rafStop = true;
    const c = document.querySelector('[data-testid="live-canvas"]');
    return {
      raf: window.__raf,
      frames: Number(c?.dataset.frames ?? NaN),
      particles: Number(c?.dataset.particles ?? 0),
    };
  });
  const task = m1.TaskDuration - m0.TaskDuration;
  const particleFrames = Number.isFinite(after.frames - counted.frames) ? after.frames - counted.frames : after.raf;
  const idle = {
    renderer: counted.renderer,
    particles: after.particles,
    mainBusyPct: Math.round((task / wall) * 1000) / 10,
    mainMsPerFrame: Math.round(((task * 1000) / Math.max(1, after.raf)) * 100) / 100,
    script: Math.round(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 1000) / 10,
    style: Math.round(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) / wall) * 1000) / 10,
    layout: Math.round(((m1.LayoutDuration - m0.LayoutDuration) / wall) * 1000) / 10,
    rafFps: Math.round((after.raf / wall) * 10) / 10,
    particleFps: Math.round((particleFrames / wall) * 10) / 10,
  };

  // Canvas right-click menu.
  const wrap = await page.getByTestId("canvas-wrap").boundingBox();
  await page.mouse.click(wrap.x + wrap.width / 2, wrap.y + 90, { button: "right" });
  await page.getByTestId("context-menu").waitFor();
  const menuIds = await itemsIn(page, "context-menu", "context-menu-item-");
  const menuHover = await timedSteps(page, await hoverSteps(page, menuIds, 2));
  const menuKeys = await timedSteps(
    page,
    Array.from({ length: 16 }, () => () => page.keyboard.press("ArrowDown")),
  );
  await page.keyboard.press("Escape");
  await sleep(300);

  // Ctrl+K palette.
  await page.mouse.move(wrap.x + 40, wrap.y + wrap.height - 40);
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette").waitFor();
  const paletteIds = (await itemsIn(page, "command-list", "command-item-")).slice(0, 10);
  const paletteHover = await timedSteps(page, await hoverSteps(page, paletteIds, 2));
  const paletteKeys = await timedSteps(
    page,
    Array.from({ length: 16 }, () => () => page.keyboard.press("ArrowDown")),
  );
  await context.close();
  return {
    idle,
    menuHover: summarize(menuHover),
    menuKeys: summarize(menuKeys),
    paletteHover: summarize(paletteHover),
    paletteKeys: summarize(paletteKeys),
  };
}

const browser = await chromium.launch({ headless: !HEADED });
const rows = [];
for (const throttle of THROTTLES) {
  const r = await measureOnce(browser, throttle);
  console.log(JSON.stringify({ label: LABEL, throttle, ...r }));
  rows.push({ throttle, ...r });
}
await browser.close();

console.log(`\n${LABEL}`);
for (const r of rows) {
  const i = r.idle;
  console.log(
    `${r.throttle}x  [${i.renderer}] particles ${i.particles} | main busy ${i.mainBusyPct}% (script ${i.script}%, style ${i.style}%, layout ${i.layout}%), ${i.mainMsPerFrame} ms/frame | rAF ${i.rafFps} fps, particles ${i.particleFps} fps`,
  );
  for (const k of ["menuHover", "menuKeys", "paletteHover", "paletteKeys"]) {
    const s = r[k];
    console.log(`     ${k.padEnd(13)} n=${s.n} >=16ms: ${s.over16}  p50 ${s.p50}  p90 ${s.p90}  max ${s.max} ms`);
  }
}
