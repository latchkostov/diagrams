// Same pan/zoom and task-time counters as interact/live, with most of the drawing off screen.
// The fitted benchmarks remain useful controls: fitting a whole diagram leaves nothing to cull.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outDir } from "../results";
import { Bench, loadWorkload, MODE, NAMES_URL, test, uiSizes, uiSuite } from "./harness";

const s = uiSuite("viewport");
test.skip(MODE === "gates", "report-only");

for (const n of uiSizes([500, 1500]))
  test(`viewport pipeline@${n}`, async ({ browser }) => {
    const w = loadWorkload("pipeline", n);
    const values: Record<string, number[]> = {};
    const record = (key: string, value: number) => (values[key] ??= []).push(value);
    for (let sample = 0; sample < 3; sample++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const b = await Bench.create(page);
        await b.open(w, { url: NAMES_URL });
        await b.canvasSettled();
        await page.getByTestId("zoom-100").click();
        await b.canvasSettled();
        const spot = await b.emptySpot();
        await b.zoom(spot, 4, "out");
        await b.canvasSettled();
        await b.frames(8);
        const share = await page.getByTestId("canvas-wrap").evaluate((root) => {
          const pane = root.getBoundingClientRect();
          const cards = [...root.querySelectorAll('[data-testid="card-title"]')];
          const outside = cards.filter((card) => {
            const r = card.getBoundingClientRect();
            return r.right < pane.left || r.left > pane.right || r.bottom < pane.top || r.top > pane.bottom;
          });
          return (outside.length / cards.length) * 100;
        });
        record("offscreenPct", share);
        await b.cdp.send("Profiler.enable");
        const saveProfile = async (phase: string) => {
          const { profile } = await b.cdp.send("Profiler.stop");
          const dir = join(outDir(), "profiles");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `viewport-${n}-${sample}-${phase}.cpuprofile`), JSON.stringify(profile));
        };
        await b.cdp.send("Profiler.start");
        const pan = await b.gesture(async () => {
          await b.pan(spot, 20);
          return 20;
        });
        record("pan-taskMsPerStep", pan.taskMsPerStep);
        record("pan-frameP90", pan.frameP90);
        await saveProfile("pan");
        await b.cdp.send("Profiler.start");
        const zoom = await b.gesture(async () => {
          await b.zoom(spot, 6, "in");
          return 6;
        });
        record("zoom-taskMsPerStep", zoom.taskMsPerStep);
        record("zoom-frameP90", zoom.frameP90);
        await b.canvasSettled();
        await b.frames(8);
        await saveProfile("zoom");
        await b.goLive(0);
        await b.canvasSettled();
        await b.frames(60);
        await b.cdp.send("Profiler.start");
        const before = await b.metrics();
        await b.frames(180);
        const after = await b.metrics();
        record("mainMsPerFrame", (after.TaskDuration - before.TaskDuration) / 180);
        await saveProfile("live");
      } finally {
        await context.close();
      }
    }
    for (const [key, samples] of Object.entries(values))
      if (key === "offscreenPct")
        s.count(key, samples.reduce((a, b) => a + b) / samples.length, { w: w.info, unit: "%" });
      else s.time(key, samples, w.info);
  });
