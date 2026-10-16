// Where the time goes (docs/BENCHMARKS.md § Hotspots): a CPU profile of the main thread (Chrome DevTools Protocol's
// sampling profiler) during the interactions the other benchmarks find slowest, on the names build so every frame
// names its function. Each profile's self time is summed by function, and the top ones are recorded (report-only:
// a profile is evidence for the hotspot list, not a gate). The .cpuprofile files are kept beside the results; open
// one in Chrome DevTools (Performance ▸ Load profile) to see the whole picture.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { outDir } from "../results";
import { Bench, loadWorkload, MODE, NAMES_URL, round, test, uiSuite } from "./harness";

const s = uiSuite("profile");

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}
interface Profile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

/** Self time per function (ms), the profile's total, and its idle share. */
function selfTimes(p: Profile) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const node = byId.get(p.samples[i]);
    const dt = (p.timeDeltas[i + 1] ?? p.timeDeltas[i] ?? 0) / 1000;
    if (!node) continue;
    total += dt;
    const f = node.callFrame;
    const file =
      f.url
        .split("/")
        .pop()
        ?.replace(/-[\w-]{8}\.js$/, ".js") ?? "";
    // V8's own entries: (idle), (program) (time in the browser outside JavaScript: style, layout, paint and the rest)
    // and (garbage collector).
    const key = /^\(.*\)$/.test(f.functionName)
      ? f.functionName
      : f.functionName
        ? `${f.functionName} (${file || "native"})`
        : `(anonymous in ${file || "?"})`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  return { total, self: [...self.entries()].sort((a, b) => b[1] - a[1]) };
}

async function profiled(b: Bench, name: string, act: () => Promise<void>) {
  await b.cdp.send("Profiler.enable");
  await b.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await b.cdp.send("Profiler.start");
  await act();
  const { profile } = (await b.cdp.send("Profiler.stop")) as { profile: Profile };
  const dir = join(outDir(), "profiles");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.cpuprofile`), JSON.stringify(profile));
  const { total, self } = selfTimes(profile);
  const busy = self.filter(([k]) => k !== "(idle)");
  const busyMs = busy.reduce((sum, [, v]) => sum + v, 0);
  s.time(`${name}/profiled`, [total], undefined, undefined, "wall time profiled");
  s.time(`${name}/busy`, [busyMs], undefined, undefined, "main-thread time not idle");
  for (const [fn, ms] of busy.slice(0, 15)) s.time(`${name}/self`, [round(ms, 1)], undefined, fn);
}

async function open(page: Page, family: string, n: number, query = "") {
  const w = loadWorkload(family, n);
  const b = await Bench.create(page);
  await b.open(w, { url: NAMES_URL, query });
  await b.settle(3_000, 300_000);
  return { b, w };
}

test.skip(MODE !== "full", "report-only, at 500 and 1,500 nodes: full runs only");

test("profile: typing a name, mesh@500", async ({ page }) => {
  const { b, w } = await open(page, "mesh", 500);
  const services = (w.d.nodes as { id: string; stencil?: string }[]).filter((x) => /^service\./.test(x.stencil ?? ""));
  await b.clickNode(await b.nodeNearCentre(services.map((x) => x.id)), { double: true });
  await page.getByTestId("inspector-field-label").press("End");
  await b.settle(500);
  await profiled(b, "typeName-mesh@500", async () => {
    for (const ch of "-renamed") {
      await page.keyboard.type(ch);
      await page.waitForTimeout(120);
    }
    await b.settle(500, 60_000);
  });
});

test("profile: dragging a node, pipeline@500", async ({ page }) => {
  const { b, w } = await open(page, "pipeline", 500);
  const grip = await b.pointOn(await b.nodeNearCentre(w.d.nodes.map((x) => x.id)));
  await profiled(b, "drag-pipeline@500", async () => {
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(grip.x + i * 6, grip.y + i * 3);
      await b.frames(1);
    }
    await page.mouse.up();
    await b.settle(500, 60_000);
  });
});

test("profile: selecting nodes, pipeline@1500", async ({ page }) => {
  const { b, w } = await open(page, "pipeline", 1_500);
  const ids = w.d.nodes.map((x) => x.id);
  await b.clickNode(await b.nodeNearCentre(ids));
  await b.settle(500, 60_000);
  // Found before profiling: the search (elementFromPoint over the canvas) is the benchmark's, not the app's.
  const targets: { x: number; y: number }[] = [];
  for (let i = 0; i < 3; i++) targets.push(await b.clickableNear(ids.filter((_, k) => k % 3 === i)));
  await profiled(b, "select-pipeline@1500", async () => {
    for (const t of targets) {
      await page.mouse.click(t.x, t.y);
      await b.settle(300, 60_000);
    }
  });
});

test("profile: live view, pipeline@500", async ({ page }) => {
  const { b } = await open(page, "pipeline", 500);
  await b.goLive();
  await profiled(b, "live-pipeline@500", () => page.waitForTimeout(4_000));
});

test("profile: cold load, pipeline@1500", async ({ page }) => {
  const w = loadWorkload("pipeline", 1_500);
  const b = await Bench.create(page);
  await b.cdp.send("Profiler.enable");
  await profiled(b, "load-pipeline@1500", async () => {
    await b.open(w, { url: NAMES_URL });
    await b.settle(3_000, 300_000);
  });
});
