// Pan/drag scaling controls: fitted and mostly off-screen drawings, Edit and Live.
// BENCH_PAN_TRACE=1 captures Chrome traces on the names build separately from timing runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outDir } from "../results";
import { Bench, expect, loadWorkload, MODE, NAMES_URL, test, uiSizes, uiSuite } from "./harness";

const s = uiSuite("panScale");
const tracing = process.env.BENCH_PAN_TRACE === "1";
test.skip(MODE === "gates", "report-only");

for (const n of uiSizes([500, 1500]))
  for (const view of ["fitted", "offscreen"])
    test(`pan-scale ${view} pipeline@${n}`, async ({ browser }) => {
      const w = loadWorkload("pipeline", n);
      const values: Record<string, number[]> = {};
      for (let sample = 0; sample < (tracing ? 1 : Number(process.env.BENCH_PAN_SAMPLES ?? 3)); sample++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        try {
          const page = await context.newPage();
          const b = await Bench.create(page);
          await b.open(w, tracing ? { url: NAMES_URL } : {});
          await b.canvasSettled();
          if (view === "fitted") await b.fitDiagram();
          else {
            await page.getByTestId("zoom-100").click();
            await b.canvasSettled();
            await b.zoom(await b.emptySpot(), 4, "out");
            await b.canvasSettled();
          }
          await b.frames(8);
          const measure = async (name: string, act: () => Promise<void>) => {
            const key = `${name}-${view}`;
            const events: unknown[] = [];
            const collected = ({ value }: { value: unknown[] }) => events.push(...value);
            if (tracing) {
              b.cdp.on("Tracing.dataCollected", collected);
              await b.cdp.send("Tracing.start", {
                categories: "devtools.timeline,v8,disabled-by-default-v8.cpu_profiler",
                options: "sampling-frequency=1000",
              });
              await b.cdp.send("Profiler.enable");
              await b.cdp.send("Profiler.start");
            }
            const before = await b.metrics();
            const result = await b.gesture(async () => {
              await act();
              return 20;
            });
            const after = await b.metrics();
            console.log(
              `${name}/${view}@${n} sample ${sample + 1}: task ${result.taskMsPerStep}, frame p90 ${result.frameP90}`,
            );
            for (const [metric, value] of Object.entries({
              taskMsPerStep: result.taskMsPerStep,
              frameP90: result.frameP90,
              scriptMsPerStep: (after.ScriptDuration - before.ScriptDuration) / 20,
              styleMsPerStep: (after.RecalcStyleDuration - before.RecalcStyleDuration) / 20,
              layoutMsPerStep: (after.LayoutDuration - before.LayoutDuration) / 20,
            }))
              (values[`${key}-${metric}`] ??= []).push(value);
            if (tracing) {
              const { profile } = await b.cdp.send("Profiler.stop");
              const completed = new Promise<void>((resolve) => b.cdp.once("Tracing.tracingComplete", () => resolve()));
              await b.cdp.send("Tracing.end");
              await completed;
              b.cdp.off("Tracing.dataCollected", collected);
              const dir = join(outDir(), "profiles");
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, `${key}-${n}.trace.json`), JSON.stringify({ traceEvents: events }));
              writeFileSync(join(dir, `${key}-${n}.cpuprofile`), JSON.stringify(profile));
            }
          };
          const pan = async (mode: string) => {
            const spot = await b.emptySpot();
            const before = await b.viewport();
            await measure(`pan-${mode}`, () => b.pan(spot, 20));
            const after = await b.viewport();
            expect(after.k).toBe(before.k);
            expect(after.x).not.toBe(before.x);
            // Return to the measured starting frame before locating a card for the next gesture.
            await page.getByTestId("canvas-pane").dispatchEvent("wheel", {
              deltaX: after.x - before.x,
              deltaY: after.y - before.y,
              bubbles: true,
            });
            await b.frames(8);
          };
          await pan("edit");
          if (n === 1500) {
            const id = await b.nodeNearCentre(w.d.nodes.map((node) => node.id));
            // Select first and let the Inspector's reveal/camera finish before measuring the grip.
            await b.clickNode(id);
            await b.selectionSettled();
            const grip = await b.pointOn(id);
            const position = await page.getByTestId(id).evaluate((node) => node.parentElement?.style.transform);
            await measure("drag-edit", async () => {
              await page.mouse.move(grip.x, grip.y);
              await page.mouse.down();
              for (let i = 1; i <= 20; i++) {
                await page.mouse.move(grip.x + i * 6, grip.y + i * 3);
                await b.frames(1);
              }
              await page.mouse.up();
            });
            expect(await page.getByTestId(id).evaluate((node) => node.parentElement?.style.transform)).not.toBe(
              position,
            );
          }
          if (process.env.BENCH_PAN_LIVE === "0") continue;
          await b.goLive(0);
          await b.canvasSettled();
          await b.frames(60);
          await pan("live");
          // In Live nodes are read-only: dragging a card pans the camera.
          if (n === 1500) {
            const grip = await b.pointOn(await b.nodeNearCentre(w.d.nodes.map((node) => node.id)));
            const before = await b.viewport();
            await measure("drag-live", async () => {
              await page.mouse.move(grip.x, grip.y);
              await page.mouse.down();
              for (let i = 1; i <= 20; i++) {
                await page.mouse.move(grip.x + i * 6, grip.y + i * 3);
                await b.frames(1);
              }
              await page.mouse.up();
            });
            const after = await b.viewport();
            expect(after.k).toBe(before.k);
            expect(after.x).not.toBe(before.x);
          }
        } finally {
          await context.close();
        }
      }
      for (const [key, samples] of Object.entries(values)) s.time(key, samples, w.info);
    });
