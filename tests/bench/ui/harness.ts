// The browser benchmarks' harness (docs/BENCHMARKS.md § Method): a pinned environment, a materialised workload opened
// the way a saved diagram opens, Chrome DevTools Protocol metrics, render counts, and one part file per spec.
//
// Environment, pinned for every page: 1440 × 900 at device scale factor 1, light theme, en-US, UTC, and a CPU
// throttle on the main thread (BENCH_CPU, default 2: twice as slow, about a mid-range laptop next to a fast desktop;
// it makes a few-ms difference measurable without making the 5,000-node workloads take hours). Chromium's flags keep
// a hidden or idle tab from being throttled further. Timing runs use the e2e build; render counts the same build with
// names kept (scripts/bench/build.mjs).

import { readFileSync } from "node:fs";
import { test as base, expect, type CDPSession, type Page } from "@playwright/test";
import { calibrationWork } from "../calibration";
import { gate, Recorder, round, stats, type Stats, type WorkloadInfo } from "../results";
import { workloadFile } from "../workloadCache";
import { OBSERVERS, RENDER_HOOK, type AppHooks } from "./instrument";

export const MODE = (process.env.BENCH_MODE ?? "full") as "full" | "gates" | "quick";
export const CPU_THROTTLE = Number(process.env.BENCH_CPU ?? 2);
export const VIEWPORT = { width: 1440, height: 900 } as const;
/** The e2e build, and the same with names kept (render counts). */
export const PORT = Number(process.env.BENCH_PORT ?? 6210);
export const NAMES_URL = `http://localhost:${PORT + 1}/`;
export const APP_URL = `http://localhost:${PORT}/`;

/** UI sizes per mode. BENCH_SIZES narrows them. */
export function uiSizes(full: number[], quick = full.filter((n) => n <= 500)): number[] {
  if (process.env.BENCH_SIZES) {
    const only = process.env.BENCH_SIZES.split(",").map(Number);
    return full.filter((n) => only.includes(n));
  }
  return MODE === "quick" ? quick : full;
}

/** Runs of each timing scenario: medians of these. */
export const runsFor = (n: number) => (MODE === "quick" ? 1 : n >= 5_000 ? 2 : 3);

/**
 * Runs `run` up to `runs` times, but stops after one that took over `longMs` of wall time: a single run of the biggest
 * workloads takes minutes, and its own spread is small next to that.
 */
export async function repeat(runs: number, run: (i: number) => Promise<void>, longMs = 120_000) {
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await run(i);
    if (Date.now() - t > longMs) break;
  }
}

/** A materialised workload (tests/bench/node writes them; `pnpm bench` runs that first). */
export function loadWorkload(family: string, n: number) {
  const file = workloadFile(family, n);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`No workload ${family}@${n} at ${file}: run \`pnpm bench\` (or \`pnpm bench:prepare\`) first`);
  }
  const d = JSON.parse(text) as {
    nodes: { id: string; group?: string }[];
    edges: unknown[];
    groups?: { id: string }[];
    annotations?: { id: string }[];
  };
  return { text, d, info: { family, n, nodes: d.nodes.length, edges: d.edges.length } satisfies WorkloadInfo };
}

/** The suite's recorder; calibration runs once per spec file, in a page, at the throttle. */
export function uiSuite(name: string) {
  const rec = new Recorder(name, "browser");
  let calibration = NaN;
  base.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto("about:blank");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    calibration = await page.evaluate(`(() => {
      const work = ${calibrationWork.toString()};
      for (let i = 0; i < 5; i++) work();
      const times = [];
      for (let i = 0; i < 15; i++) { const t = performance.now(); work(); times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)];
    })()`);
    rec.info.browser = browser.version();
    await context.close();
  });
  base.afterAll(() => {
    rec.info.cpuThrottle = CPU_THROTTLE;
    rec.info.viewport = VIEWPORT;
    rec.info.deviceScaleFactor = 1;
    rec.info.mode = MODE;
    rec.write(calibration);
  });
  const id = (...parts: (string | number | undefined)[]) => [name, ...parts.filter((p) => p !== undefined)].join("/");
  return {
    rec,
    time(scenario: string, values: number[], w?: WorkloadInfo, detail?: string, note?: string) {
      const s = stats(values.filter((v) => Number.isFinite(v)));
      return rec.add({
        id: id(scenario, detail, w && `${w.family}@${w.n}`),
        scenario,
        kind: "time",
        unit: "ms",
        value: s.median,
        stats: s,
        ...(w ? { workload: w } : {}),
        ...(note ? { note } : {}),
      });
    },
    count(
      scenario: string,
      value: number,
      o: {
        w?: WorkloadInfo;
        detail?: string;
        unit?: string;
        limit?: number;
        op?: "<=" | ">=" | "==";
        why?: string;
      } = {},
    ) {
      const g = o.limit === undefined ? undefined : gate(o.op ?? "<=", value, o.limit, o.why);
      rec.add({
        id: id(scenario, o.detail, o.w && `${o.w.family}@${o.w.n}`),
        scenario,
        kind: o.unit === "bytes" ? "bytes" : o.unit === "%" ? "percent" : "count",
        unit: o.unit ?? "count",
        value,
        ...(o.w ? { workload: o.w } : {}),
        ...(g ? { gate: g } : {}),
      });
      if (g)
        expect.soft(g.pass, `${scenario}${o.detail ? ` ${o.detail}` : ""}: ${value} ${g.op} ${g.limit}`).toBe(true);
    },
  };
}

export type Metrics = Record<string, number>;

/** A page with its DevTools session, opened on a workload. */
export class Bench {
  constructor(
    readonly page: Page,
    readonly cdp: CDPSession,
  ) {}

  static async create(page: Page, o: { renders?: boolean } = {}): Promise<Bench> {
    await page.addInitScript(OBSERVERS);
    if (o.renders) await page.addInitScript(RENDER_HOOK);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    return new Bench(page, cdp);
  }

  /**
   * Opens a workload as a saved diagram opens: its JSON in the browser's storage (the "imported" slot), then the
   * canvas URL. Returns when its first node is on screen; `settle` waits for the page to go quiet after that.
   */
  async open(
    workload: { text: string; d: { nodes: { id: string }[] } },
    o: { url?: string; query?: string; timeoutMs?: number } = {},
  ) {
    await this.page.addInitScript(
      ([text, ids]) => {
        if (!sessionStorage.getItem("bench-seeded")) {
          localStorage.setItem("diagrams.imported.v1", text);
          sessionStorage.setItem("bench-seeded", "1");
        }
        const set = new Set(ids);
        const apply = () => {
          if (window.__bench) window.__bench.nodeIds = set;
          else setTimeout(apply, 0);
        };
        apply();
      },
      [workload.text, workload.d.nodes.map((n) => n.id)] as const,
    );
    const started = Date.now();
    await this.page.goto(`${o.url ?? APP_URL}?view=canvas&example=imported${o.query ?? ""}`, { waitUntil: "commit" });
    await expect
      .poll(() => this.page.evaluate(() => window.__bench?.firstNode ?? 0), {
        timeout: o.timeoutMs ?? 180_000,
        intervals: [50, 100, 250],
      })
      .toBeGreaterThan(0);
    return { wallMs: Date.now() - started };
  }

  /** The canvas viewport: translation and scale (React Flow's transform, read as the e2e fixtures read it). */
  async viewport(): Promise<{ x: number; y: number; k: number }> {
    const t = await this.page.evaluate(
      () =>
        document.querySelector('[data-testid="canvas-wrap"]')?.querySelector<HTMLElement>(".react-flow__viewport")
          ?.style.transform ?? "",
    );
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(t);
    if (!m) throw new Error(`no viewport transform: "${t}"`);
    return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
  }

  /**
   * Pans as the editor does: a middle-button drag on the empty canvas (a left drag draws a selection box in edit mode),
   * a frame per step.
   */
  async pan(from: { x: number; y: number }, steps: number) {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down({ button: "middle" });
    for (let i = 1; i <= steps; i++) {
      await this.page.mouse.move(from.x + i * 12, from.y + i * 4);
      await this.frames(1);
    }
    await this.page.mouse.up({ button: "middle" });
  }

  /** Zooms as the editor does: the wheel with Control held (a plain wheel pans), `steps` notches, two frames each. */
  async zoom(at: { x: number; y: number }, steps: number, direction: "in" | "out") {
    await this.page.mouse.move(at.x, at.y);
    await this.page.keyboard.down("Control");
    try {
      for (let i = 0; i < steps; i++) {
        await this.page.mouse.wheel(0, direction === "in" ? -120 : 120);
        await this.frames(2);
      }
    } finally {
      await this.page.keyboard.up("Control");
    }
  }

  /**
   * Turns live view on from a settled canvas (a page opened with live=1 never goes quiet: its frames are the
   * animation), waits for its controls and a warm-up of `warmMs`.
   */
  async goLive(warmMs = 3_000) {
    await this.page.getByTestId("live-toggle").click();
    await this.page.getByTestId("live-controls").waitFor({ timeout: 180_000 });
    await this.page.waitForTimeout(warmMs);
  }

  /** Waits until no long animation frame for `quietMs`, at most `maxMs`; returns when the last one ended. */
  async settle(quietMs = 1_000, maxMs = 120_000): Promise<number> {
    const until = Date.now() + maxMs;
    for (;;) {
      const { last, now } = await this.page.evaluate(() => {
        window.__bench.flush();
        return {
          last: Math.max(window.__bench.firstNode, ...window.__bench.loaf.map((f) => f.start + f.duration)),
          now: performance.now(),
        };
      });
      if (now - last >= quietMs || Date.now() > until) return last;
      await this.page.waitForTimeout(Math.min(250, quietMs - (now - last) + 20));
    }
  }

  /** The DevTools performance counters (main thread task times in ms, heap in bytes, DOM nodes...). */
  async metrics(): Promise<Metrics> {
    const { metrics } = (await this.cdp.send("Performance.getMetrics")) as {
      metrics: { name: string; value: number }[];
    };
    const out: Metrics = {};
    for (const m of metrics) out[m.name] = /Duration$/.test(m.name) ? m.value * 1000 : m.value;
    return out;
  }

  /** JS heap in use after a full garbage collection, in bytes. */
  async heap(): Promise<number> {
    await this.cdp.send("HeapProfiler.collectGarbage");
    await this.cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = (await this.cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
    return usedSize;
  }

  /** Documents, DOM nodes and JS event listeners alive (after a GC: `heap()` first). */
  async domCounters(): Promise<{ documents: number; nodes: number; jsEventListeners: number }> {
    return (await this.cdp.send("Memory.getDOMCounters")) as {
      documents: number;
      nodes: number;
      jsEventListeners: number;
    };
  }

  /** Clears the page's buffered entries, so the next read sees only what follows. */
  async mark() {
    await this.page.evaluate(() => {
      const b = window.__bench;
      b.flush();
      b.events.length = 0;
      b.loaf.length = 0;
      b.longtasks.length = 0;
      b.paints.length = 0;
    });
  }

  async entries() {
    return this.page.evaluate(() => {
      const b = window.__bench;
      b.flush();
      return { events: b.events, loaf: b.loaf, longtasks: b.longtasks, paints: b.paints, firstNode: b.firstNode };
    });
  }

  /** A point on the empty canvas (no node, edge, boundary or annotation under it), near `at` (fractions of the pane). */
  async emptySpot(at = { x: 0.5, y: 0.5 }): Promise<{ x: number; y: number }> {
    const spot = await this.page.evaluate((target) => {
      const wrapEl = document.querySelector('[data-testid="canvas-wrap"]');
      if (!wrapEl) return null;
      const wrap = wrapEl.getBoundingClientRect();
      const cx = wrap.left + wrap.width * target.x;
      const cy = wrap.top + wrap.height * target.y;
      for (let r = 0; r < Math.min(wrap.width, wrap.height) / 2; r += 6)
        for (let a = 0; a < 24; a++) {
          const x = cx + r * Math.cos((a * Math.PI) / 12);
          const y = cy + r * Math.sin((a * Math.PI) / 12);
          const el = document.elementFromPoint(x, y);
          // The canvas itself: nothing with a test id of its own (a node, an edge, a card, a control) in between, only
          // React Flow's own wrapper (rf__wrapper) or the canvas's.
          const owner = el?.closest("[data-testid]")?.getAttribute("data-testid");
          if (owner === "rf__wrapper" || owner === "canvas-wrap") return { x, y };
        }
      return null;
    }, at);
    if (!spot) throw new Error("no empty spot on the canvas");
    return spot;
  }

  /**
   * Runs a gesture and reads what it cost: main-thread task time per step, animation frame intervals (p50, p90, max),
   * the longest animation frame, and input to next paint for each input the gesture made.
   */
  async gesture(act: () => Promise<number>) {
    await this.frames(2);
    await this.mark();
    await this.page.evaluate(() => window.__bench.startFrames());
    const before = await this.metrics();
    const steps = await act();
    await this.frames(3);
    const after = await this.metrics();
    const frames = await this.page.evaluate(() => window.__bench.stopFrames());
    const e = await this.entries();
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    return {
      steps,
      taskMsPerStep: round((after.TaskDuration - before.TaskDuration) / Math.max(1, steps), 2),
      frameP50: round(pct(gaps, 50), 1),
      frameP90: round(pct(gaps, 90), 1),
      frameMax: round(Math.max(0, ...gaps), 1),
      longestFrame: Math.max(0, ...e.loaf.map((f) => f.duration)),
      paints: e.paints.map((x) => x.ms),
    };
  }

  /** Waits for two animation frames (the last input's paint is done). */
  async frames(n = 2) {
    await this.page.evaluate(
      (count) =>
        new Promise<void>((resolve) => {
          const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
          step(count);
        }),
      n,
    );
  }

  /**
   * A diagram node near the canvas centre (spiralling out) with a point of its own to click (`pointOn`), among `ids`.
   * Returns its test id and that point.
   */
  async nodeNearCentre(ids: readonly string[], fallback?: readonly string[]): Promise<string> {
    return (await this.clickableNear(ids, fallback)).testId;
  }

  /** Among `ids`, else (none of them clickable near the centre) among `fallback`. */
  async clickableNear(
    ids: readonly string[],
    fallback?: readonly string[],
  ): Promise<{ testId: string; x: number; y: number }> {
    const found = await this.page.evaluate((list) => {
      const known = new Set(list);
      const wrapEl = document.querySelector('[data-testid="canvas-wrap"]');
      if (!wrapEl) return null;
      const wrap = wrapEl.getBoundingClientRect();
      const cx = wrap.left + wrap.width / 2;
      const cy = wrap.top + wrap.height / 2;
      const seen = new Set<string>();
      for (let r = 0; r < Math.min(wrap.width, wrap.height) / 2; r += 4)
        for (let a = 0; a < 16; a++) {
          const el = document.elementFromPoint(
            cx + r * Math.cos((a * Math.PI) / 8),
            cy + r * Math.sin((a * Math.PI) / 8),
          );
          const node = el?.closest('[data-testid^="node-"]');
          const testId = node?.getAttribute("data-testid");
          if (!node || !testId || seen.has(testId) || !known.has(testId.slice(5))) continue;
          seen.add(testId);
          // A point on the card that is the node's own, not a connection handle on it.
          const box = node.getBoundingClientRect();
          for (const fx of [0.3, 0.5, 0.7, 0.2, 0.8, 0.4, 0.6])
            for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75]) {
              const x = box.left + box.width * fx;
              const y = box.top + box.height * fy;
              const hit = document.elementFromPoint(x, y);
              if (hit && node.contains(hit) && !hit.closest('[data-testid^="handle-"]')) return { testId, x, y };
            }
        }
      return null;
    }, ids as string[]);
    if (found) return found;
    if (fallback) return this.clickableNear(fallback);
    throw new Error("no clickable diagram node near the canvas centre");
  }

  /** A point on a node's card that is the node's own (not one of its connection handles). */
  async pointOn(testId: string): Promise<{ x: number; y: number }> {
    const { x, y } = await this.clickableNear([testId.slice(5)]).catch(async () => {
      await this.page.getByTestId(testId).scrollIntoViewIfNeeded();
      return this.clickableNear([testId.slice(5)]);
    });
    return { x, y };
  }

  /** Clicks (or double-clicks) a node on a point that is the node's own. */
  async clickNode(testId: string, o: { double?: boolean } = {}) {
    const { x, y } = await this.pointOn(testId);
    if (o.double) await this.page.mouse.dblclick(x, y);
    else await this.page.mouse.click(x, y);
  }

  /** Renders since `startRenders()` (names build only). */
  async renders() {
    const r = await this.page.evaluate(() => window.__benchRenders?.stop());
    if (!r) throw new Error("no render hook: open the page with { renders: true }");
    return r;
  }

  async startRenders() {
    await this.page.evaluate(() => window.__benchRenders?.start());
  }

  /** Main-thread task time between two metric readings, in ms. */
  static taskMs(a: Metrics, b: Metrics) {
    return round(b.TaskDuration - a.TaskDuration, 2);
  }
}

/** p-th percentile of values (nearest rank). */
export function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN;
}

export { expect, round, stats, type AppHooks, type Stats };
export const test = base;
