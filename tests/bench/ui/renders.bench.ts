// React render counts per interaction (docs/BENCHMARKS.md § Metrics, § Gates), on the names build: production React
// and bundling with component names kept, so every count names its component. A render here is one component
// function run in a committed render (tests/bench/ui/instrument.ts); a commit is one React commit.
//
// Counts don't depend on the machine, so they gate: a regression that re-renders the inspector, the canvas or every
// node once more per keystroke changes them by a whole number, which a timing would hide in noise. The budgets are
// today's counts with a little room, in BUDGETS below; raise one only on purpose, in the change that needs it.
//
// What's counted, per workload (the gates on the pipeline at 100 and 500 nodes; the rest report):
// - type-name: twelve keys typed into a node's name in the inspector (per key);
// - select: a click on another node (per click);
// - pan: the empty canvas dragged (per frame); drag: a node dragged (per frame).

import type { Page } from "@playwright/test";
import { Bench, expect, loadWorkload, MODE, NAMES_URL, test, uiSizes, uiSuite } from "./harness";

const s = uiSuite("renders");

/** Per-unit counts of an interaction: commits, renders in all, and renders by component. */
async function counted(b: Bench, units: number, act: () => Promise<void>) {
  await b.settle(500);
  await b.startRenders();
  await act();
  await b.frames(3);
  // Let a debounced follow-up (an autosave, a deferred re-render) land in the same reading.
  await b.page.waitForTimeout(300);
  await b.frames(2);
  const r = await b.renders();
  const per = (x: number) => Math.round((x / units) * 100) / 100;
  const byName = Object.fromEntries(Object.entries(r.byName).map(([k, v]) => [k, per(v)]));
  return { commits: per(r.commits), total: per(r.total), byName };
}

async function typeKeys(page: Page, text: string) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(120);
  }
}

/**
 * Gate budgets per unit of interaction, on the pipeline workload at 100 and 500 nodes: `fixed + perNode × nodes`.
 * Measured on 2026-10-14 (three runs each; docs/BENCHMARKS.md § Baseline), with room for the run-to-run spread of a
 * commit or two (a debounced follow-up landing inside or outside the reading), never for a whole extra render per
 * key. The per-node ones hold today's hotspots (every node wrapper re-renders per key, per selection) from getting
 * worse; when the refactor brings them down, bring the budgets down with them.
 */
const BUDGETS: Record<string, { fixed?: number; perNode?: number; why: string }> = {
  "type-name/commits": { fixed: 4, why: "measured 3.2 to 3.7 commits per key; one more per key is 4.2 or more" },
  "type-name/Inspector": { fixed: 1.75, why: "measured 1.17 to 1.33 per key: the inspector renders once a key" },
  "type-name/DiagramNodeImpl": { fixed: 1.5, why: "only the renamed node's card renders (1 per key)" },
  "type-name/Palette": { fixed: 0, why: "the stencil rail never reacts to typing" },
  "type-name/PaletteItem": { fixed: 0, why: "the stencil rail never reacts to typing" },
  "type-name/NodeWrapper": {
    perNode: 1.6,
    why: "hotspot: every node's React Flow wrapper re-renders per key (1.1 to 1.3 per node today); not another pass",
  },
  "type-name/total": { fixed: 150, perNode: 3, why: "measured 306 to 375 at 100 nodes, 1,283 to 1,374 at 500" },
  "select/commits": { fixed: 10.5, why: "measured 9 to 9.7 commits per click; one more per click is 10 or more" },
  "select/DiagramNodeImpl": { fixed: 3.5, why: "the two cards whose selection changed, and the inspector's preview" },
  "select/NodeWrapper": {
    perNode: 5,
    why: "hotspot: every node's wrapper re-renders about 4 times per click today; not another pass",
  },
  "pan/DiagramNodeImpl": { fixed: 1, why: "panning moves the viewport; only a hovered card may render" },
  "pan/NodeWrapper": { perNode: 0.8, why: "measured 0.4 to 0.6 per node per frame (hotspot); not more" },
};

const GATED = (family: string, n: number) => family === "pipeline" && (n === 100 || n === 500);

const CASES: [string, number[]][] = [
  ["pipeline", [100, 500, 1_500]],
  ["mesh", [100, 500]],
];

for (const [family, sizes] of CASES)
  for (const n of uiSizes(
    sizes,
    sizes.filter((x) => x <= 500),
  ))
    test(`render counts ${family}@${n}`, async ({ page }) => {
      if (MODE === "gates" && !GATED(family, n)) test.skip();
      const w = loadWorkload(family, n);
      const ids = w.d.nodes.map((x) => x.id);
      const services = (w.d.nodes as { id: string; stencil?: string }[])
        .filter((x) => /^(service\.|aws\.lambda|azure\.functions)/.test(x.stencil ?? ""))
        .map((x) => x.id);
      const b = await Bench.create(page, { renders: true });
      await b.open(w, { url: NAMES_URL });
      await b.settle(1_000, 180_000);

      const results: Record<string, Awaited<ReturnType<typeof counted>>> = {};

      // Pan, ten frames.
      const spot = await b.emptySpot({ x: 0.5, y: 0.45 });
      results.pan = await counted(b, 10, async () => {
        await page.mouse.move(spot.x, spot.y);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(spot.x + i * 12, spot.y + i * 4);
          await b.frames(1);
        }
        await page.mouse.up();
      });

      // Select: the first click opens the inspector; count the next six clicks (three nodes, twice: a stray commit is
      // then a sixth of a count per click).
      await b.clickNode(await b.nodeNearCentre(ids));
      const targets: string[] = [];
      for (let i = 0; i < 3; i++) targets.push(await b.nodeNearCentre(ids.filter((_, k) => k % 3 === i)));
      targets.push(...targets);
      results.select = await counted(b, targets.length, async () => {
        for (const t of targets) {
          await b.clickNode(t);
          await b.frames(2);
        }
      });

      // Typing a name: six keys.
      await b.clickNode(await b.nodeNearCentre(services), { double: true });
      await page.getByTestId("inspector-field-label").press("End");
      // Twelve keys: a stray commit is then a twelfth of a count per key, a whole extra render per key is one.
      results["type-name"] = await counted(b, 12, () => typeKeys(page, "-edit1-edit2"));
      await page.getByTestId("inspector-field-label").press("Enter");

      // Drag: ten frames.
      await page.keyboard.press("Escape");
      const grip = await b.pointOn(await b.nodeNearCentre(services));
      results.drag = await counted(b, 10, async () => {
        await page.mouse.move(grip.x, grip.y);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(grip.x + i * 6, grip.y + i * 3);
          await b.frames(1);
        }
        await page.mouse.up();
      });

      // The hook still sees renders: a React upgrade that changed its internals would read as zero everywhere.
      expect(results["type-name"].total, "the render hook counted nothing: check RENDER_HOOK").toBeGreaterThan(0);

      const gated = GATED(family, n);
      for (const [interaction, r] of Object.entries(results)) {
        const unit =
          interaction === "pan" || interaction === "drag"
            ? "per frame"
            : interaction === "select"
              ? "per click"
              : "per key";
        const record = (what: string, value: number) => {
          const budget = gated ? BUDGETS[`${interaction}/${what}`] : undefined;
          const limit = budget && Math.round(((budget.fixed ?? 0) + (budget.perNode ?? 0) * w.info.nodes) * 100) / 100;
          s.count(`${interaction}/${what}`, value, {
            w: w.info,
            unit,
            ...(budget ? { limit, why: budget.why } : {}),
          });
        };
        record("commits", r.commits);
        record("total", r.total);
        // Every component that rendered at least once per unit, and the gated ones even when they didn't.
        const names = new Set([
          ...Object.entries(r.byName)
            .filter(([, v]) => v >= 1)
            .map(([k]) => k),
          ...Object.keys(BUDGETS)
            .filter((k) => k.startsWith(`${interaction}/`))
            .map((k) => k.slice(interaction.length + 1))
            .filter((k) => k !== "commits" && k !== "total"),
        ]);
        for (const name of [...names].sort()) record(name, r.byName[name] ?? 0);
      }
    });

// Live view: what React renders while messages flow, per second (the controller publishes its state every 125 ms).
// Report-only: the count follows the frame rate, which the machine decides.
for (const n of uiSizes([100, 500, 1_500], [100, 500]))
  test(`live render counts pipeline@${n}`, async ({ page }) => {
    test.skip(MODE === "gates", "report-only");
    const w = loadWorkload("pipeline", n);
    const b = await Bench.create(page, { renders: true });
    await b.open(w, { url: NAMES_URL, query: "&live=1" });
    await page.getByTestId("live-controls").waitFor({ timeout: 180_000 });
    await b.settle(1_000, 180_000);
    await page.waitForTimeout(2_000);
    await b.startRenders();
    await page.waitForTimeout(3_000);
    const r = await b.renders();
    const perSecond = (x: number) => Math.round((x / 3) * 10) / 10;
    s.count("live/commits", perSecond(r.commits), { w: w.info, unit: "per second" });
    s.count("live/total", perSecond(r.total), { w: w.info, unit: "per second" });
    s.count("live/rendersPerCommit", Math.round((r.total / Math.max(1, r.commits)) * 10) / 10, { w: w.info });
    for (const [name, count] of Object.entries(r.byName)
      .sort((a, c) => c[1] - a[1])
      .slice(0, 15))
      s.count(`live/${name}`, perSecond(count), { w: w.info, unit: "per second" });
  });
