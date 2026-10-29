// Opt-in measurement helper for docs/backlog/2026-10-28-perf-survey-2.md.
// SURVEY2=1 pnpm exec playwright test -c tests/bench/survey2.config.ts
// SURVEY2_TRACE=1 selects the names build and separate diagnostic profiles.
// Timings are observations, never performance assertions. Existing harness owns
// CPU throttle, workload generation, frame observers, GC and server cleanup.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import type { DiagramFile } from "../../../src/model/types";
import { outDir } from "../results";
import { APP_URL, Bench, expect, loadWorkload, NAMES_URL, PORT, test, type AppHooks } from "./harness";

const TRACE = process.env.SURVEY2_TRACE === "1";
const SAMPLES = Number(process.env.SURVEY2_SAMPLES ?? (TRACE ? 1 : 3));
const URL = TRACE ? NAMES_URL : APP_URL;
const DIR = join(outDir(), "survey2");
mkdirSync(DIR, { recursive: true });
test.skip(process.env.SURVEY2 !== "1", "explicit measurement session only");
test.beforeAll(({ browser }) => record("environment", { chromium: browser.version(), node: process.version }));

/** Same camera completion/stability predicates as Bench, without a locator
 * assertion's full-canvas ARIA diagnostic on an intermediate pending frame. */
class SurveyBench extends Bench {
  static override async create(page: Page) {
    const b = await Bench.create(page);
    return new SurveyBench(page, b.cdp);
  }

  override async canvasSettled() {
    await expect.poll(() => this.page.getByTestId("canvas-wrap").getAttribute("data-fit-pending")).toBe("false");
    let last = "";
    await expect
      .poll(
        async () => {
          const [box, viewport] = await Promise.all([
            this.page.getByTestId("canvas-wrap").boundingBox(),
            this.viewport(),
          ]);
          const now = box ? JSON.stringify([box, viewport]) : "";
          const stable = now !== "" && now === last;
          last = now;
          return stable;
        },
        { intervals: [100, 150, 150, 250] },
      )
      .toBe(true);
  }
}

function record(metric: string, data: unknown) {
  const row = { metric, traced: TRACE, data };
  appendFileSync(
    join(DIR, TRACE ? "traces.jsonl" : (process.env.SURVEY2_FILE ?? "samples.jsonl")),
    `${JSON.stringify(row)}\n`,
  );
  console.log(JSON.stringify(row));
}

async function trace<T>(b: Bench, name: string, act: () => Promise<T>): Promise<T> {
  if (!TRACE) return act();
  await b.cdp.send("Profiler.enable");
  await b.cdp.send("Profiler.start");
  await b.cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  try {
    return await act();
  } finally {
    const { profile } = await b.cdp.send("Profiler.stop");
    writeFileSync(join(DIR, `${name}.cpuprofile`), JSON.stringify(profile));
    const complete = new Promise<string>((resolve) => {
      b.cdp.once("Tracing.tracingComplete", (e) => {
        if (e.stream) resolve(e.stream);
      });
    });
    await b.cdp.send("Tracing.end");
    const handle = await complete;
    let text = "";
    for (;;) {
      const chunk = await b.cdp.send("IO.read", { handle });
      text += chunk.data;
      if (chunk.eof) break;
    }
    await b.cdp.send("IO.close", { handle });
    writeFileSync(join(DIR, `${name}.trace.json`), text);
  }
}

async function operation(b: Bench, name: string, act: () => Promise<unknown>) {
  await b.frames(3);
  await b.mark();
  return trace(b, name, async () => {
    const before = await b.metrics();
    const start = await b.page.evaluate(() => performance.now());
    await act();
    await b.frames(2);
    const end = await b.page.evaluate(() => performance.now());
    const after = await b.metrics();
    record(name, {
      wall: end - start,
      task: after.TaskDuration - before.TaskDuration,
      script: after.ScriptDuration - before.ScriptDuration,
      style: after.RecalcStyleDuration - before.RecalcStyleDuration,
      layout: after.LayoutDuration - before.LayoutDuration,
      longest: Math.max(0, ...(await b.entries()).loaf.map((f) => f.duration)),
    });
  });
}

async function open(page: Page, n: number) {
  const w = loadWorkload("pipeline", n);
  const b = await SurveyBench.create(page);
  await b.open(w, { url: URL });
  await b.canvasSettled();
  await b.settle(2000, 300_000);
  return { b, w, d: JSON.parse(w.text) as DiagramFile };
}

async function menu(b: Bench, item: string) {
  const at = await b.emptySpot({ x: 0.5, y: 0.92 });
  await b.page.mouse.click(at.x, at.y, { button: "right" });
  await b.page.getByTestId(`context-menu-item-${item}`).waitFor();
}

async function htmlDialog(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-html").click();
  await page.getByTestId("html-export-download").waitFor();
  await expect(page.getByTestId("html-export-download")).toBeEnabled();
}

async function saveDownload(page: Page, act: () => Promise<unknown>, path?: string) {
  const received = page.waitForEvent("download", { timeout: 300_000 });
  await act();
  const download = await received;
  expect(await download.failure()).toBeNull();
  if (path) await download.saveAs(path);
  return download;
}

// A retrying locator count assertion builds an ARIA failure snapshot on its
// initial mismatch. On a large scene that diagnostic itself costs seconds.
async function waitForCount(page: Page, prefix: string, count: number) {
  const ready = await page.waitForFunction(
    ([prefix, count]) => document.querySelectorAll(`[data-testid^="${prefix}"]`).length === count,
    [prefix, count] as const,
  );
  await ready.dispose();
}

for (const example of ["kafka-order-pipeline", "black-friday-commerce"])
  for (const locale of ["en", "de"])
    test(`survey2 startup ${example} ${locale}`, async ({ browser }) => {
      for (let sample = 0; sample < SAMPLES; sample++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
        try {
          const page = await context.newPage();
          const b = await SurveyBench.create(page);
          await page.addInitScript((lang) => localStorage.setItem("diagrams.locale", lang), locale);
          await b.cdp.send("Network.enable");
          await b.cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          await trace(b, `startup-${example}-${locale}`, async () => {
            await page.goto(`http://localhost:${TRACE ? PORT + 1 : PORT + 2}/?view=canvas&example=${example}`, {
              waitUntil: "commit",
            });
            await page.waitForFunction(() => window.__bench?.firstNode > 0);
            // Same operational TTI as scripts/perf/startup.mjs: two seconds
            // without a long task; report its END, excluding the quiet window.
            await expect
              .poll(
                async () => {
                  return page.evaluate(() => {
                    window.__bench.flush();
                    const at = Math.max(
                      window.__bench.firstNode,
                      ...window.__bench.longtasks.map((t) => t.start + t.duration),
                    );
                    return performance.now() - at >= 2000;
                  });
                },
                { timeout: 180_000 },
              )
              .toBe(true);
            const startup = await page.evaluate(() => {
              window.__bench.flush();
              const first = window.__bench.firstNode;
              const tti = Math.max(first, ...window.__bench.longtasks.map((t) => t.start + t.duration));
              const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
              return {
                first,
                tti,
                fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
                resources: resources
                  .filter((r) => r.responseEnd <= first)
                  .map((r) => ({
                    name: new globalThis.URL(r.name).pathname,
                    bytes: r.encodedBodySize,
                    transfer: r.transferSize,
                  })),
              };
            });
            const js = startup.resources.filter((r) => /\.js$/.test(r.name));
            record(`startup-${example}-${locale}`, {
              ...startup,
              jsBytes: js.reduce((n, r) => n + r.bytes, 0),
              jsGzip: js.reduce(
                (n, r) =>
                  n + gzipSync(readFileSync(join(TRACE ? join(outDir(), "dist-names") : "dist", r.name))).length,
                0,
              ),
              totalBytes: startup.resources.reduce((n, r) => n + r.bytes, 0),
            });
          });
          await operation(b, `startup-live-${example}-${locale}`, async () => {
            await page.getByTestId("live-toggle").click();
            await page.getByTestId("live-controls").waitFor();
            await page.getByTestId("live-canvas").waitFor();
          });
        } finally {
          await context.close();
        }
      }
    });

for (const n of [500, 1500]) {
  test(`survey2 cold PNG pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b } = await open(page, n);
        await menu(b, "canvas.auto-layout");
        await page.getByTestId("context-menu-item-canvas.auto-layout").click();
        await b.canvasSettled();
        await b.settle(1000, 300_000);
        await page.getByTestId("file-button").click();
        await operation(b, `cold-png-${n}`, () => saveDownload(page, () => page.getByTestId("export-png").click()));
      } finally {
        await context.close();
      }
    }
  });

  test(`survey2 layout pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b } = await open(page, n);
        await menu(b, "canvas.auto-layout");
        await operation(b, `layout-${n}`, async () => {
          await page.getByTestId("context-menu-item-canvas.auto-layout").click();
          await b.canvasSettled();
          await b.settle(1000, 300_000);
        });
      } finally {
        await context.close();
      }
    }
  });

  test(`survey2 edit pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b, d } = await open(page, n);
        const ids = d.nodes.map((x) => x.id);
        const target = await b.nodeNearCentre(ids);
        await b.clickNode(target);
        for (const multi of [false, true]) {
          let otherId: string | undefined;
          let otherBefore: string | undefined;
          if (multi) {
            const other = await b.nodeNearCentre(ids.filter((id) => `node-${id}` !== target));
            otherId = other;
            const at = await b.pointOn(other);
            await page.keyboard.down("Shift");
            await page.mouse.click(at.x, at.y);
            await page.keyboard.up("Shift");
            await b.selectionSettled();
            otherBefore = await page.getByTestId(other).evaluate((el) => el.parentElement?.style.transform);
          }
          const at = await b.pointOn(target);
          const prior = await page.getByTestId(target).evaluate((el) => el.parentElement?.style.transform);
          await trace(b, `${multi ? "multi-drag" : "drag"}-${n}`, async () => {
            const result = await b.gesture(async () => {
              await page.mouse.move(at.x, at.y);
              await page.mouse.down();
              for (let step = 1; step <= 20; step++) {
                await page.mouse.move(at.x + step * 6, at.y + step * 3);
                await b.frames(1);
              }
              await page.mouse.up();
              return 20;
            });
            record(`${multi ? "multi-drag" : "drag"}-${n}`, result);
          });
          expect(await page.getByTestId(target).evaluate((el) => el.parentElement?.style.transform)).not.toBe(prior);
          if (otherId)
            expect(await page.getByTestId(otherId).evaluate((el) => el.parentElement?.style.transform)).not.toBe(
              otherBefore,
            );
          await operation(b, `undo-${multi ? "multi-" : ""}${n}`, async () => {
            await page.getByTestId("canvas-wrap").focus();
            await page.keyboard.press("Control+z");
            await expect
              .poll(() => page.getByTestId(target).evaluate((el) => el.parentElement?.style.transform))
              .toBe(prior);
          });
          await operation(b, `redo-${multi ? "multi-" : ""}${n}`, async () => {
            await page.keyboard.press("Control+Shift+z");
            await expect
              .poll(() => page.getByTestId(target).evaluate((el) => el.parentElement?.style.transform))
              .not.toBe(prior);
          });
        }
        await page.keyboard.press("Escape");
        await b.fitDiagram();
        // Two unconnected visible nodes, with their handles exposed at fit-all.
        const from = await b.nodeNearCentre(ids);
        const sourceId = from.slice(5);
        const unavailable = new Set(d.edges.filter((e) => e.from === sourceId).map((e) => e.to));
        const to = await b.nodeNearCentre(ids.filter((id) => id !== sourceId && !unavailable.has(id)));
        await page.getByTestId(from).hover();
        const handle = await page.getByTestId(`handle-${sourceId}-right`).boundingBox();
        const dest = await b.pointOn(to);
        if (!handle) throw Error("missing source dot");
        const edgesBefore = await page.getByTestId(/^edge-/).count();
        await operation(b, `connect-${n}`, async () => {
          await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
          await page.mouse.down();
          await page.mouse.move(dest.x, dest.y, { steps: 8 });
          await page.mouse.up();
          await waitForCount(page, "edge-", edgesBefore + 1);
        });
      } finally {
        await context.close();
      }
    }
  });

  test(`survey2 paste pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b, d } = await open(page, n);
        await b.fitDiagram();
        // Exactly 50 nodes, no copied edges or boundaries, into the unchanged Overview.
        const payload = {
          format: "diagrams/clip-v1",
          groups: [],
          edges: [],
          nodes: d.nodes.slice(0, 50).map((node) => ({ ...node, group: undefined })),
        };
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(payload));
        await page.getByTestId("canvas-wrap").focus();
        const spot = await b.emptySpot();
        await page.mouse.move(spot.x, spot.y);
        await operation(b, `paste50-${n}`, async () => {
          await page.keyboard.press("Control+v");
          await waitForCount(page, "node-", n + 50);
          await b.canvasSettled();
        });
      } finally {
        await context.close();
      }
    }
  });

  test(`survey2 features pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b } = await open(page, n);
        await menu(b, "canvas.auto-layout");
        // Preserve the feature suite's auto-laid-out fixture. Layout has its own
        // independent timing case, so exports do not record duplicate samples.
        await page.getByTestId("context-menu-item-canvas.auto-layout").click();
        await b.canvasSettled();
        await b.settle(1000, 300_000);
        await menu(b, "canvas.run-simulations");
        const before = await page.evaluate(() => (window as AppHooks).__simulations?.finished ?? 0);
        await operation(b, `run-simulations-${n}`, async () => {
          await page.getByTestId("context-menu-item-canvas.run-simulations").click();
          await page.waitForFunction((was) => ((window as AppHooks).__simulations?.finished ?? 0) > was, before, {
            timeout: 300_000,
          });
        });
        await page.keyboard.press("Escape");
        if (n !== 1500) continue;
        await page.getByTestId("file-button").click();
        await operation(b, `export-png-${n}`, () => saveDownload(page, () => page.getByTestId("export-png").click()));
        await page.getByTestId("file-button").click();
        await page.getByTestId("file-more-formats").click();
        await page.getByTestId("export-image").click();
        await page.getByTestId("image-options-toggle").click();
        await page.getByTestId("image-format-svg").click();
        await operation(b, `export-svg-${n}`, () => saveDownload(page, () => page.getByTestId("image-export").click()));
        await htmlDialog(page);
        await operation(b, `export-html-${n}`, () =>
          saveDownload(page, () => page.getByTestId("html-export-download").click()),
        );
      } finally {
        await context.close();
      }
    }
  });

  test(`survey2 live pipeline@${n}`, async ({ browser }) => {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const { b } = await open(page, n);
        await operation(b, `live-entry-${n}`, async () => {
          await page.getByTestId("live-toggle").click();
          await page.getByTestId("live-controls").waitFor();
          await page.getByTestId("live-canvas").waitFor();
        });
        await b.canvasSettled();
        await page.getByTestId("live-view-menu").click();
        await b.fitDiagram();
        await b.frames(60);
        record(
          `live-renderer-${n}`,
          await page.getByTestId("live-canvas").evaluate((canvas) => ({
            renderer: (canvas as HTMLElement).dataset.renderer,
            particles: Number((canvas as HTMLElement).dataset.particles ?? 0),
          })),
        );
        await trace(b, `idle-live-${n}`, async () => {
          record(
            `idle-live-${n}`,
            await b.gesture(async () => {
              await b.frames(20);
              return 20;
            }),
          );
        });
        const spot = await b.emptySpot();
        const prior = await b.viewport();
        await trace(b, `pan-live-${n}`, async () => {
          record(
            `pan-live-${n}`,
            await b.gesture(async () => {
              await b.pan(spot, 20);
              return 20;
            }),
          );
        });
        expect((await b.viewport()).x).not.toBe(prior.x);
        await operation(b, `pause-${n}`, async () => {
          await page.getByTestId("live-play").click();
          await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
        });
        const pausedSpot = await b.emptySpot();
        await trace(b, `pan-paused-${n}`, async () => {
          record(
            `pan-paused-${n}`,
            await b.gesture(async () => {
              await b.pan(pausedSpot, 20);
              return 20;
            }),
          );
        });
        await operation(b, `play-${n}`, async () => {
          await page.getByTestId("live-play").click();
          await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
        });
        await page.getByTestId("live-play").click();
        await page.getByTestId("live-sim-picker").selectOption("steady");
        // Choosing a saved run starts playback. Pause it through the UI before seeking.
        await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
        await page.getByTestId("live-play").click();
        await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
        const slider = page.getByTestId("live-timeline-input");
        await operation(b, `seek-forward-${n}`, async () => {
          await slider.fill("750");
          await slider.press("ArrowRight");
          await expect
            .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
            .toBeGreaterThan(7000);
          await expect(slider).toBeEnabled();
        });
        const forward = Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
        await operation(b, `seek-back-${n}`, async () => {
          await slider.fill("250");
          await slider.press("ArrowRight");
          await expect
            .poll(async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms")))
            .toBeLessThan(forward / 2);
          await expect(slider).toBeEnabled();
        });
        record(`seek-position-${n}`, {
          forward,
          back: Number(await page.getByTestId("live-clock").getAttribute("data-ms")),
        });
      } finally {
        await context.close();
      }
    }
  });
}

test("survey2 viewer pipeline@500", async ({ browser }) => {
  const w = loadWorkload("pipeline", 500);
  const input = join(DIR, "pipeline-500.diagram.json");
  writeFileSync(input, w.text);
  const path = join(DIR, "pipeline-500.html");
  execFileSync(process.execPath, ["skills/livediagrams/scripts/export-html.mjs", input, "--out", path, "--force"]);
  record("viewer-file-bytes-500", statSync(path).size);
  for (let sample = 0; sample < SAMPLES; sample++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const viewer = await context.newPage();
      const v = await SurveyBench.create(viewer);
      await trace(v, "viewer-500", async () => {
        await viewer.goto(pathToFileURL(path).href, { waitUntil: "commit" });
        await viewer.waitForFunction(() => window.__bench?.firstNode > 0);
        const first = (await v.entries()).firstNode;
        await viewer.getByTestId("live-controls").waitFor();
        await v.frames(2);
        record("viewer-load-500", {
          first,
          ready: await viewer.evaluate(() => performance.now()),
          heap: await v.heap(),
        });
      });
    } finally {
      await context.close();
    }
  }
});

async function memory(b: Bench) {
  return { heap: await b.heap(), ...(await b.domCounters()) };
}

test("survey2 memory live five minutes pipeline@1500", async ({ page }) => {
  test.setTimeout(600_000);
  const { b } = await open(page, 1500);
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-canvas").waitFor();
  await b.frames(60);
  const start = Date.now();
  for (let minute = 0; minute <= 5; minute++) {
    while (Date.now() - start < minute * 60_000) await delay(10_000);
    record("memory-live-1500", { minute, wall: Date.now() - start, ...(await memory(b)) });
  }
});

test("survey2 memory reopen five diagrams", async ({ page }) => {
  const { b, d } = await open(page, 500);
  const read = async () => {
    await b.mark();
    return memory(b);
  };
  const slugs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const title = `Survey synthetic pipeline ${i + 1}`;
    let text = JSON.stringify({ ...d, title });
    // Distinct IDs also expose caches accidentally retaining earlier documents.
    for (const id of [...d.nodes, ...d.edges, ...(d.groups ?? [])].map((part) => part.id))
      text = text.replaceAll(JSON.stringify(id), JSON.stringify(`survey${i}-${id}`));
    await page.getByTestId("import-input").setInputFiles({
      name: `survey-${i}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText(title);
    const slug = new globalThis.URL(page.url()).searchParams.get("example");
    if (!slug) throw Error("missing opened diagram slug");
    slugs.push(slug);
    await b.canvasSettled();
  }
  record("memory-five-open-500", await read());
  const close = async () => {
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await waitForCount(page, "node-", 0);
    await b.frames(5);
  };
  await close();
  record("memory-reopen-500", { pass: 0, ...(await read()) });
  for (let pass = 1; pass <= 3; pass++) {
    for (const slug of slugs) {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-library").click();
      await page.getByTestId(`library-open-${slug}`).click();
      await waitForCount(page, "node-", 500);
      await b.canvasSettled();
      if (slug === slugs.at(-1)) record("memory-five-reopened-500", { pass, ...(await read()) });
      await close();
    }
    record("memory-reopen-500", { pass, ...(await read()) });
  }
});
