// Interactions on an open diagram (docs/BENCHMARKS.md § Metrics), on the e2e build at the pinned CPU throttle:
// - pan (a middle-button drag on the empty canvas) and zoom (Control and the wheel), each checked to have moved or
//   scaled the viewport: main-thread ms per step, frame intervals, longest frame;
// - select: a click on a node until the inspector shows it, the first one opening the folded inspector (input to
//   the frame it's painted in);
// - typing: a node's name (the label field), its secondary line and a number (latency) in the inspector, a key every
//   120 ms like a quick typist: input to next paint per key (p50, p90, max), Event Timing's longest event per key,
//   main-thread ms per key, and how many check runs, planning analyses and diagram copies the typing caused;
// - drag: a node moved a frame at a time: main-thread ms per frame, frame intervals, input to next paint.
// Every number is report-only: render counts and the per-keystroke work counts gate (renders.bench.ts).

import { Bench, MODE, loadWorkload, repeat, round, runsFor, test, uiSizes, uiSuite, type AppHooks } from "./harness";
import type { Page } from "@playwright/test";

const s = uiSuite("interact");

// Report-only: the gates are elsewhere (renders.bench.ts, memory.bench.ts).
test.skip(MODE === "gates", "report-only");

/** The time from the last trusted pointerdown to the painted frame in which the inspector's label shows `label`. */
async function selectionVisible(page: Page, label: string, act: () => Promise<void>): Promise<number> {
  await page.evaluate((want) => {
    const w = window as unknown as { __shown: Promise<number> };
    w.__shown = new Promise((resolve) => {
      let down = NaN;
      const onDown = (e: PointerEvent) => {
        if (e.isTrusted) down = e.timeStamp;
      };
      window.addEventListener("pointerdown", onDown, true);
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        window.removeEventListener("pointerdown", onDown, true);
        resolve(performance.now() - down);
      };
      const tick = () => {
        const field = document.querySelector<HTMLInputElement>('[data-testid="inspector-field-label"]');
        if (field?.value === want && !Number.isNaN(down)) channel.port2.postMessage(0);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, label);
  await act();
  return page.evaluate(() => (window as unknown as { __shown: Promise<number> }).__shown);
}

const counters = (page: Page) =>
  page.evaluate(() => {
    const w = window as AppHooks;
    return {
      checks: w.__checks?.started ?? 0,
      planningReads: w.__planning?.reads ?? 0,
      analyses: w.__planning?.analyses ?? 0,
      simulations: w.__simulations?.started ?? 0,
    };
  });

/** Types `text` into the focused field a key every `gapMs`, and reads what each key cost. */
async function typing(b: Bench, text: string, gapMs = 120) {
  await b.frames(2);
  await b.mark();
  const c0 = await counters(b.page);
  const m0 = await b.metrics();
  for (const ch of text) {
    const t = Date.now();
    await b.page.keyboard.type(ch);
    const wait = gapMs - (Date.now() - t);
    if (wait > 0) await b.page.waitForTimeout(wait);
  }
  await b.frames(3);
  const m1 = await b.metrics();
  const c1 = await counters(b.page);
  const e = await b.entries();
  const keys = e.paints.filter((p) => p.type === "keydown").map((p) => p.ms);
  const perKey = new Map<number, number>();
  for (const ev of e.events) if (ev.id) perKey.set(ev.id, Math.max(perKey.get(ev.id) ?? 0, ev.duration));
  // Keys under Event Timing's 16 ms threshold aren't reported: they count as 16 (an upper bound).
  const event = [...perKey.values()];
  while (event.length < text.length) event.push(16);
  return {
    keys,
    event,
    taskMsPerKey: round((m1.TaskDuration - m0.TaskDuration) / text.length, 2),
    longestFrame: Math.max(0, ...e.loaf.map((f) => f.duration)),
    checks: c1.checks - c0.checks,
    planningReads: c1.planningReads - c0.planningReads,
    analyses: c1.analyses - c0.analyses,
  };
}

const FAMILIES: [string, number[]][] = [
  ["pipeline", [100, 500, 1_500, 5_000]],
  // The mesh at 5,000 nodes takes minutes to open and seconds a frame to drag (routing): its load is measured, its
  // interactions stop at 1,500.
  ["mesh", [100, 500, 1_500]],
  // Not the Kubernetes import: at 1,500 nodes it takes minutes to show its first node (routing), see load.bench.ts.
  ["annotated", [1_500]],
];

for (const [family, sizes] of FAMILIES)
  for (const n of uiSizes(sizes))
    test(`interactions ${family}@${n}`, async ({ browser }) => {
      const w = loadWorkload(family, n);
      const ids = w.d.nodes.map((x) => x.id);
      // Typing and dragging act on a service (every one has a latency field), selection on any node.
      const services = (w.d.nodes as { id: string; stencil?: string }[])
        .filter((x) => /^(service.|aws.lambda|azure.functions|k8s.deployment|generic.service)/.test(x.stencil ?? ""))
        .map((x) => x.id);
      const label = (testId: string) =>
        (w.d.nodes.find((x) => `node-${x.id}` === testId) as { label?: string })?.label ?? "";
      const v: Record<string, number[]> = {};
      const push = (k: string, ...x: number[]) => (v[k] ??= []).push(...x);
      const counts: Record<string, number> = {};
      // Fewer steps where each one is slow (a drag frame re-routes edges; see the layout benchmarks).
      const steps = n >= 5_000 ? 4 : n >= 1_500 ? 8 : 20;
      await repeat(runsFor(n), async () => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        try {
          const page = await context.newPage();
          const b = await Bench.create(page);
          await b.open(w);
          await b.settle(3_000, 300_000);

          // Pan: the empty canvas dragged with the middle button, a frame at a time.
          const spot = await b.emptySpot({ x: 0.5, y: 0.45 });
          const before = await b.viewport();
          const pan = await b.gesture(async () => {
            await b.pan(spot, steps);
            return steps;
          });
          const panned = await b.viewport();
          if (panned.k !== before.k || (panned.x === before.x && panned.y === before.y))
            throw new Error(`the pan didn't pan: ${JSON.stringify([before, panned])}`);
          push("pan-taskMsPerStep", pan.taskMsPerStep);
          push("pan-frameP90", pan.frameP90);
          push("pan-longestFrame", pan.longestFrame);
          push("pan-inputToPaint", ...pan.paints);
          await b.settle(500);

          // Zoom: Control and the wheel at the canvas centre, in, then back out (not measured).
          const centre = await b.emptySpot();
          const zoom = await b.gesture(async () => {
            await b.zoom(centre, 6, "in");
            return 6;
          });
          const zoomed = await b.viewport();
          if (!(zoomed.k > panned.k)) throw new Error(`the zoom didn't zoom: ${JSON.stringify([panned, zoomed])}`);
          await b.zoom(centre, 6, "out");
          push("zoom-taskMsPerStep", zoom.taskMsPerStep);
          push("zoom-frameP90", zoom.frameP90);
          push("zoom-longestFrame", zoom.longestFrame);
          push("zoom-inputToPaint", ...zoom.paints);
          await b.settle(500);

          // Select: three nodes in turn; the first click also unfolds the inspector.
          for (let i = 0; i < 3; i++) {
            const target = await b.nodeNearCentre(ids.filter((_, k) => k % 3 === i));
            await b.mark();
            const ms = await selectionVisible(page, label(target), () => b.clickNode(target));
            push(i === 0 ? "select-first" : "select", ms);
            await b.settle(300);
          }

          // Typing: the name, the secondary line, then a number.
          const node = await b.nodeNearCentre(services, ids);
          await b.clickNode(node, { double: true });
          const name = page.getByTestId("inspector-field-label");
          await name.press("End");
          await b.settle(300);
          const typedName = await typing(b, " renamed, v2");
          push("type-name-inputToPaint", ...typedName.keys);
          push("type-name-event", ...typedName.event);
          push("type-name-taskMsPerKey", typedName.taskMsPerKey);
          push("type-name-longestFrame", typedName.longestFrame);
          counts["type-name-checkRuns"] = typedName.checks;
          counts["type-name-planningReads"] = typedName.planningReads;
          counts["type-name-planningAnalyses"] = typedName.analyses;
          await name.press("Enter");
          await b.settle(500);

          await page.getByTestId("inspector-field-sublabel").click();
          await b.settle(300);
          const typedSub = await typing(b, "orders.v2");
          push("type-sublabel-inputToPaint", ...typedSub.keys);
          push("type-sublabel-taskMsPerKey", typedSub.taskMsPerKey);
          await page.keyboard.press("Tab");
          await b.settle(500);

          await page.getByTestId("inspector-section-node-simulation").click();
          const latency = page.getByTestId("inspector-field-latencyMs");
          await latency.click();
          await latency.press("Control+a");
          await b.settle(300);
          const typedNumber = await typing(b, "1250");
          push("type-number-inputToPaint", ...typedNumber.keys);
          push("type-number-taskMsPerKey", typedNumber.taskMsPerKey);
          counts["type-number-planningAnalyses"] = typedNumber.analyses;
          await page.keyboard.press("Tab");
          await b.settle(500);

          // Drag: a node near the centre, a frame at a time.
          await page.keyboard.press("Escape");
          const dragged = await b.nodeNearCentre(services, ids);
          const grip = await b.pointOn(dragged);
          const drag = await b.gesture(async () => {
            const { x, y } = grip;
            await page.mouse.move(x, y);
            await page.mouse.down();
            for (let i = 1; i <= steps; i++) {
              await page.mouse.move(x + i * 6, y + i * 3);
              await b.frames(1);
            }
            await page.mouse.up();
            return steps;
          });
          push("drag-taskMsPerStep", drag.taskMsPerStep);
          push("drag-frameP90", drag.frameP90);
          push("drag-longestFrame", drag.longestFrame);
          push("drag-inputToPaint", ...drag.paints);
        } finally {
          await context.close();
        }
      });
      for (const [k, values] of Object.entries(v)) s.time(k, values, w.info);
      for (const [k, value] of Object.entries(counts)) s.count(k, value, { w: w.info });
    });
