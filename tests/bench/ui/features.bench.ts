// Whole features through the UI (docs/BENCHMARKS.md § Metrics), on the e2e build at the pinned CPU throttle. Each one
// from the input that starts it to the painted frame (or the download) that finishes it, with the main-thread task
// time it took and its longest animation frame:
// - autoLayout (canvas menu ▸ Auto-layout) and tidy (Select all, then a node's menu ▸ Tidy up);
// - runSimulations (the canvas menu ▸ Run simulations, played in a worker);
// - exportPng, exportSvg (Export image…) and exportHtml (Interactive HTML…), to the download;
// - language (View ▸ Language ▸ Deutsch), to the frame the File button reads "Datei".

import type { Page } from "@playwright/test";
import { Bench, MODE, loadWorkload, round, test, uiSizes, uiSuite, type AppHooks } from "./harness";

const s = uiSuite("features");

// Report-only: the gates are elsewhere (renders.bench.ts, memory.bench.ts).
test.skip(MODE === "gates", "report-only");

/** Runs `act` and reads the main-thread time, the longest frame and the wall time until `done` resolves. */
async function feature(b: Bench, act: () => Promise<void>, done: () => Promise<unknown>) {
  await b.settle(500);
  await b.mark();
  const m0 = await b.metrics();
  const t0 = Date.now();
  await act();
  await done();
  const wall = Date.now() - t0;
  await b.frames(2);
  const m1 = await b.metrics();
  const e = await b.entries();
  return {
    wall,
    task: round(m1.TaskDuration - m0.TaskDuration, 1),
    longest: Math.max(0, ...e.loaf.map((f) => f.duration)),
  };
}

/** Until the canvas has had no long animation frame for half a second. */
const quiet = (b: Bench) => () => b.settle(500, 180_000);

async function canvasMenu(b: Bench, item: string) {
  const spot = await b.emptySpot({ x: 0.5, y: 0.92 });
  await b.page.mouse.click(spot.x, spot.y, { button: "right" });
  await b.page.getByTestId(`context-menu-item-${item}`).waitFor();
}

const download = (page: Page) => page.waitForEvent("download", { timeout: 300_000 });

for (const n of uiSizes([100, 500, 1_500]))
  test(`features pipeline@${n}`, async ({ page }) => {
    const w = loadWorkload("pipeline", n);
    const b = await Bench.create(page);
    await b.open(w);
    await b.settle(3_000, 300_000);
    const record = (name: string, r: { wall: number; task: number; longest: number }) => {
      s.time(name, [r.wall], w.info, undefined, "input to done, wall clock");
      s.time(`${name}-mainThread`, [r.task], w.info);
      s.time(`${name}-longestFrame`, [r.longest], w.info);
    };

    // Auto-layout, from the canvas menu.
    await canvasMenu(b, "canvas.auto-layout");
    record(
      "autoLayout",
      await feature(b, () => page.getByTestId("context-menu-item-canvas.auto-layout").click(), quiet(b)),
    );

    // Tidy up everything: Select all, then a selected node's menu.
    await b.page.keyboard.press("Control+a");
    const node = await b.nodeNearCentre(w.d.nodes.map((x) => x.id));
    const at = await b.pointOn(node);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const tidy = page.getByTestId("context-menu-item-selection.tidy");
    if (await tidy.isVisible()) record("tidy", await feature(b, () => tidy.click(), quiet(b)));
    else await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Run simulations (the pipeline saves two), from the canvas menu.
    await canvasMenu(b, "canvas.run-simulations");
    const before = await page.evaluate(() => (window as AppHooks).__simulations?.finished ?? 0);
    record(
      "runSimulations",
      await feature(
        b,
        () => page.getByTestId("context-menu-item-canvas.run-simulations").click(),
        () =>
          page.waitForFunction((was) => ((window as AppHooks).__simulations?.finished ?? 0) > was, before, {
            timeout: 300_000,
          }),
      ),
    );
    await page.keyboard.press("Escape");

    // Exports: PNG straight from the File menu; SVG and Interactive HTML through their dialogs.
    await page.getByTestId("file-button").click();
    record(
      "exportPng",
      await feature(
        b,
        async () => {
          void page.getByTestId("export-png").click();
        },
        () => download(page),
      ),
    );
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    record(
      "exportSvg",
      await feature(
        b,
        async () => {
          void page.getByTestId("image-export").click();
        },
        () => download(page),
      ),
    );
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-html").click();
    await page.getByTestId("html-export-download").waitFor();
    // The viewer template downloads when the dialog opens; give it a moment so the export measures the export.
    await page.waitForLoadState("networkidle");
    record(
      "exportHtml",
      await feature(
        b,
        async () => {
          void page.getByTestId("html-export-download").click();
        },
        () => download(page),
      ),
    );
    await page.keyboard.press("Escape");

    // Language: View ▸ Language ▸ Deutsch, until the File button reads Datei.
    await page.getByTestId("view-button").click();
    await page.getByTestId("view-language").click();
    await page.getByTestId("language-option-de").waitFor();
    const shown = page.evaluate(() =>
      window.__bench.when("file-button", (el) => /Datei/.test(el.textContent ?? ""), 120_000),
    );
    const lang = await feature(
      b,
      () => page.getByTestId("language-option-de").click(),
      () => shown,
    );
    record("language", lang);
  });
