// Focused Live diagnosis: steady samples use the production timing build. The separate trace
// retains Chrome's script/style/layout/paint slices and sampled JavaScript stacks for attribution.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outDir } from "../results";
import { Bench, loadWorkload, MODE, test, uiSizes, uiSuite } from "./harness";

const s = uiSuite("live-scale");
test.skip(MODE === "gates", "report-only");

for (const n of uiSizes([500, 1500]))
  test(`live scale pipeline@${n}`, async ({ page }) => {
    test.setTimeout(600_000);
    const w = loadWorkload("pipeline", n);
    const b = await Bench.create(page);
    await b.open(w);
    await b.settle(3000, 300_000);
    await b.goLive();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__bench.startFrames());
      const before = await b.metrics();
      await page.waitForTimeout(5000);
      const after = await b.metrics();
      const frames = (await page.evaluate(() => window.__bench.stopFrames())).length;
      for (const key of ["TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration"])
        s.time(
          key === "TaskDuration" ? "mainMsPerFrame" : key,
          [(after[key] - before[key]) / frames],
          w.info,
          String(i),
        );
    }
    await b.cdp.send("Tracing.start", {
      categories:
        "devtools.timeline,v8.execute,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires,blink.user_timing",
      transferMode: "ReturnAsStream",
    });
    await page.waitForTimeout(5000);
    const complete = new Promise<string>((resolve) =>
      b.cdp.once("Tracing.tracingComplete", (e) => {
        if (e.stream) resolve(e.stream);
      }),
    );
    await b.cdp.send("Tracing.end");
    const handle = await complete;
    let trace = "";
    for (;;) {
      const chunk = await b.cdp.send("IO.read", { handle });
      trace += chunk.data;
      if (chunk.eof) break;
    }
    await b.cdp.send("IO.close", { handle });
    const dir = join(outDir(), "profiles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `live-pipeline-${n}.trace.json`), trace);
  });
