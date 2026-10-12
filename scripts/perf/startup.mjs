// Startup and first-interaction timings of a production build, measured in a real Chromium: the gate for
// bundle changes (what loads up front, what loads on intent).
//
//   node scripts/perf/startup.mjs --url http://localhost:5694/ [--throttle 4] [--net fast4g|slow4g] [--runs 5] [--label master]
//
// Serve a production build first (`pnpm build`, then `pnpm exec vite preview --port 5694`). Each run opens
// the Kafka example in a fresh browser context, with the cache off, at the given CPU throttle (and, with
// --net, a mobile network: fast4g is 9 Mbps with 60 ms latency, slow4g 1.6 Mbps with 150 ms) and records:
//  - FCP and LCP (paint / largest-contentful-paint entries), "canvas": when the first diagram node is on
//    screen, and TTI: the end of the last long task before a 2 s quiet window (no long tasks) after the
//    canvas is up, or the canvas time if that is later.
//  - The JavaScript fetched by then (encoded bytes and requests).
//  - Interactions, in order on the same page, each from its input to the frame its result is on screen
//    ("visible"), plus the slowest Event Timing entry in that interaction ("event", INP-style; entries under
//    16 ms aren't reported, shown as <16). `--cold` runs them as soon as the canvas is up instead of after
//    the quiet window, which is the worst case for anything that loads on intent.
// Results print as a table of medians, and per-run JSON lines with --json. Not part of the e2e suite
// (timings depend on the machine).

/* global window, document, performance, requestAnimationFrame, MutationObserver -- page.evaluate callbacks run in the browser */
import { chromium } from "@playwright/test";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";
import { URL } from "node:url";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
}
const BASE = args.url ?? "http://localhost:5694/";
const THROTTLE = Number(args.throttle ?? 4);
const RUNS = Number(args.runs ?? 5);
const LABEL = args.label ?? BASE;
const COLD = "cold" in args;
const JSON_LINES = "json" in args;
const NETWORKS = {
  fast4g: { latency: 60, downloadThroughput: (9e6 / 8) | 0, uploadThroughput: (1.5e6 / 8) | 0 },
  slow4g: { latency: 150, downloadThroughput: (1.6e6 / 8) | 0, uploadThroughput: (750e3 / 8) | 0 },
};
const NET = args.net ? NETWORKS[args.net] : undefined;
if (args.net && !NET) throw new Error(`--net must be one of ${Object.keys(NETWORKS).join(", ")}`);

const INIT = `(() => {
  window.__lt = [];
  window.__et = [];
  window.__lcp = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.startTime + e.duration); })
    .observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
    .observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__et.push({ name: e.name, start: e.startTime, duration: e.duration });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  // The first frame with a diagram node in it.
  window.__canvas = new Promise((resolve) => {
    const check = () => {
      if (!document.querySelector(".react-flow__node")) return false;
      requestAnimationFrame(() => resolve(performance.now()));
      return true;
    };
    const mo = new MutationObserver(() => check() && mo.disconnect());
    mo.observe(document, { childList: true, subtree: true });
  });
  // The last trusted input, for "from input to visible".
  window.__input = 0;
  for (const type of ["pointerdown", "keydown"])
    window.addEventListener(type, (e) => { if (e.isTrusted) window.__input = e.timeStamp; }, true);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

/** Arms a watcher for `selector`: resolves with the time of the first frame it's in. */
const arm = (page, selector) =>
  page.evaluate((sel) => {
    window.__seen = new Promise((resolve) => {
      const done = () => requestAnimationFrame(() => resolve(performance.now()));
      if (document.querySelector(sel)) return done();
      const mo = new MutationObserver(() => {
        if (!document.querySelector(sel)) return;
        mo.disconnect();
        done();
      });
      mo.observe(document, { childList: true, subtree: true, attributes: true });
    });
  }, selector);

/** Runs `act` and returns { visible, event } for `selector` appearing. */
async function interaction(page, selector, act) {
  await arm(page, selector);
  const before = await page.evaluate(() => window.__et.length);
  await act();
  const seen = await page.evaluate(() => window.__seen);
  // Event Timing entries are reported after the frame; give them a moment.
  await sleep(300);
  return page.evaluate(
    ({ before, seen }) => ({
      visible: seen - window.__input,
      event: Math.max(0, ...window.__et.slice(before).map((e) => e.duration)),
    }),
    { before, seen },
  );
}

const tid = (id) => `[data-testid="${id}"]`;

/** An empty spot on the canvas pane (for double-click quick-add). */
const emptySpot = (page) =>
  page.evaluate(() => {
    const wrap = document.querySelector('[data-testid="canvas-wrap"]').getBoundingClientRect();
    for (let y = wrap.top + wrap.height * 0.85; y > wrap.top + 80; y -= 20)
      for (let x = wrap.left + wrap.width * 0.5; x < wrap.right - 300; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el?.classList.contains("react-flow__pane")) return { x, y };
      }
    throw new Error("no empty spot");
  });

const INTERACTIONS = [
  ["file menu", async (page) => interaction(page, tid("file-menu"), () => page.getByTestId("file-button").click())],
  [
    "export dialog",
    async (page) => {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-more-formats").click();
      return interaction(page, tid("image-dialog"), () => page.getByTestId("export-image").click());
    },
  ],
  [
    "share dialog",
    async (page) => {
      await page.getByTestId("file-button").click();
      await page.getByTestId("export-share-link").click();
      await page.getByTestId("toast-share-details").waitFor();
      return interaction(page, tid("share-link-dialog"), () => page.getByTestId("toast-share-details").click());
    },
  ],
  [
    "ctrl+k",
    async (page) => {
      await page.getByTestId("canvas-wrap").focus();
      return interaction(page, tid("command-palette"), () => page.keyboard.press("Control+k"));
    },
  ],
  [
    "quick-add",
    async (page) => {
      const spot = await emptySpot(page);
      return interaction(page, tid("quick-add"), () => page.mouse.dblclick(spot.x, spot.y));
    },
  ],
  ["ai panel", async (page) => interaction(page, tid("ai-panel"), () => page.getByTestId("ai-rail-open").click())],
  ["live", async (page) => interaction(page, tid("live-hud"), () => page.getByTestId("live-toggle").click())],
];

/** Closes whatever the last interaction opened. */
async function reset(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await sleep(50);
  }
  if (await page.getByTestId("ai-collapse").isVisible()) await page.getByTestId("ai-collapse").click();
  await page.mouse.click(5, 5);
  await sleep(200);
}

async function run(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  await page.addInitScript(INIT);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  if (NET) await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET });
  await page.goto(`${BASE}?view=canvas&example=kafka-order-pipeline`, { waitUntil: "commit" });
  const canvas = await page.evaluate(() => window.__canvas);
  // TTI: wait for a 2 s window without long tasks (up to 20 s).
  let tti = canvas;
  if (!COLD) {
    const until = Date.now() + 20_000;
    for (;;) {
      const { last, now } = await page.evaluate(() => ({ last: Math.max(0, ...window.__lt), now: performance.now() }));
      tti = Math.max(canvas, last);
      if (now - last >= 2000 || Date.now() > until) break;
      await sleep(250);
    }
  }
  const startup = await page.evaluate((tti) => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN;
    const js = performance.getEntriesByType("resource").filter((r) => /\.js(\?|$)/.test(r.name) && r.startTime <= tti);
    return { fcp, lcp: window.__lcp, js: js.reduce((n, r) => n + r.encodedBodySize, 0), requests: js.length };
  }, tti);
  const result = { ...startup, canvas, tti: COLD ? NaN : tti, interactions: {} };
  for (const [name, fn] of INTERACTIONS) {
    try {
      result.interactions[name] = await fn(page);
    } catch (err) {
      result.interactions[name] = { visible: NaN, event: NaN, error: String(err).split("\n")[0] };
    }
    await reset(page);
  }
  await context.close();
  return result;
}

const browser = await chromium.launch();
const results = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run(browser);
  results.push(r);
  if (JSON_LINES) console.log(JSON.stringify({ label: LABEL, throttle: THROTTLE, cold: COLD, run: i, ...r }));
}
await browser.close();

const ms = (x) => (Number.isFinite(x) ? `${Math.round(x)} ms` : "-");
console.log(
  `\n${LABEL}: ${RUNS} runs, ${THROTTLE}x CPU${NET ? `, ${args.net}` : ""}${COLD ? ", interactions as soon as the canvas is up" : ""}`,
);
console.log(`  FCP     ${ms(median(results.map((r) => r.fcp)))}`);
console.log(`  LCP     ${ms(median(results.map((r) => r.lcp)))}`);
console.log(`  canvas  ${ms(median(results.map((r) => r.canvas)))}`);
console.log(`  TTI     ${ms(median(results.map((r) => r.tti)))}`);
console.log(
  `  JS      ${(median(results.map((r) => r.js)) / 1000).toFixed(1)} kB transferred, ${median(results.map((r) => r.requests))} requests`,
);
for (const [name] of INTERACTIONS) {
  const rs = results.map((r) => r.interactions[name]);
  const errors = rs.filter((r) => r.error);
  const event = median(rs.map((r) => r.event));
  console.log(
    `  ${name.padEnd(14)} visible ${ms(median(rs.map((r) => r.visible))).padStart(7)}, event ${event > 0 ? ms(event) : "<16 ms"}${errors.length ? `  (${errors.length} failed: ${errors[0].error})` : ""}`,
  );
}
