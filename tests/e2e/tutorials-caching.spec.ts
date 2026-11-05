import { test, expect, pauseClock, expectNoErrors } from "./fixtures";
import {
  openTutorial,
  play,
  advanceTutorialClock,
  expectNothingSaved,
  skipAll,
  strip,
  runPointerSolution,
  runPointerSkipAll,
} from "./pointer-tutorial-driver";
import type { ResolvedUiStep } from "../../src/tutorials/solution";
import { holdChunk } from "./chunk";
import { surfaceChunk } from "./lazy-surface-helpers";

const cachingIds = [
  "cdn-cache",
  "derived-hit-ratio",
  "cache-latency",
  "cache-stampede",
  "stale-while-revalidate",
  "cold-cache",
];

test("caching tutorial retries a failed runtime without advancing its Live step", async ({ page, consoleErrors }) => {
  const held = await holdChunk(page, surfaceChunk("live.cache"));
  held.fail = true;
  try {
    await openTutorial(page, "cache-latency");
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(strip(page)).toHaveAttribute("data-step", "live");
    held.fail = false;
    held.release();
    await page.getByTestId("lazy-load-retry").click();
    await expect(page.getByTestId("live-sim-picker")).toBeVisible();
    await page.getByTestId("live-sim-picker").selectOption("cache-traffic");
    await expect(strip(page)).toHaveAttribute("data-step", "cached-tail");
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  } finally {
    held.release();
  }
});

test("Exit cancels a superseded caching runtime load", async ({ page, consoleErrors }) => {
  const held = await holdChunk(page, surfaceChunk("live.cache"));
  try {
    await openTutorial(page, "cache-latency");
    await page.getByTestId("tutorial-start").click();
    await page.getByTestId("live-toggle").click();
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("tutorial-exit").click();
    held.release();
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
    await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  } finally {
    held.release();
  }
});
for (const id of cachingIds) {
  test(`${id}: caching solution through the real UI`, async ({ page, consoleErrors }) =>
    runPointerSolution(page, consoleErrors, id));
  test(`${id}: caching Skip repairs and completes`, async ({ page, consoleErrors }) =>
    runPointerSkipAll(page, consoleErrors, id));
}

const properties: ResolvedUiStep[] = [
  { dblclick: "node-edge" },
  { open: "dock-edit-properties" },
  { open: "inspector-section-node-cache" },
  { click: "cache-rule-products" },
];
const nearMisses: { id: string; index: number; step: string; actions: ResolvedUiStep[] }[] = [
  { id: "cdn-cache", index: 1, step: "rule", actions: [{ rightclick: "node-edge" }, { press: "Escape" }] },
  {
    id: "derived-hit-ratio",
    index: 2,
    step: "less-traffic",
    actions: [{ click: "live-capacity" }, { click: "capacity-traffic-mult" }, { press: "Home" }],
  },
  {
    id: "cache-latency",
    index: 2,
    step: "dont-store",
    actions: [...properties, { click: "cache-rule-products-ttl-60000" }],
  },
  {
    id: "cache-stampede",
    index: 2,
    step: "one-fetch",
    actions: [
      { dblclick: "node-cdn" },
      { open: "dock-edit-properties" },
      { open: "inspector-section-node-cache" },
      { click: "cache-rule-launch" },
      { click: "cache-rule-launch-ttl-60000" },
    ],
  },
  {
    id: "stale-while-revalidate",
    index: 2,
    step: "stale-window",
    actions: [
      ...properties,
      { open: "cache-rule-products-expires-toggle" },
      { select: "cache-rule-products-stale-window", value: "custom" },
      { fill: "cache-rule-products-stale-ms", text: "5000" },
      { press: "Enter" },
    ],
  },
  {
    id: "cold-cache",
    index: 1,
    step: "author",
    actions: [
      { click: "live-more" },
      { click: "live-edit-sims" },
      { click: "sim-panel-back" },
      { click: "sim-panel-new" },
      { click: "sim-panel-section-timeline" },
      { select: "sim-panel-add-step", value: "cold-cache" },
      { select: "sim-panel-step-0-fault-value", value: "soft" },
      { click: "sim-panel-section-details" },
      { fill: "sim-panel-duration", text: "10" },
      { click: "sim-panel-save" },
    ],
  },
];
for (const example of nearMisses)
  test(`${example.id}: Continue reconstructs, a near miss stays active, and escalating help repairs it`, async ({
    page,
    consoleErrors,
  }) => {
    test.slow();
    await page.clock.install();
    await page.addInitScript(
      ({ id, step }) =>
        localStorage.setItem(
          "diagrams.tutorials.v1",
          JSON.stringify({ progress: { [id]: { version: 1, step, completed: false } } }),
        ),
      { id: example.id, step: example.index },
    );
    await openTutorial(page, example.id);
    await expect(page.getByTestId("tutorial-start")).toContainText("Continue");
    await page.getByTestId("tutorial-start").click();
    await pauseClock(page);
    await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) === example.step);
    for (const action of example.actions) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-step", example.step);
    await page.getByTestId("coach-hint").click();
    await expect(page.getByTestId("tutorial-hint")).toBeVisible();
    await page.getByTestId("tutorial-show-me").click();
    await expect(page.getByTestId("coach-card")).toBeVisible();
    await page.getByTestId("tutorial-skip").click();
    await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) !== example.step);
    await skipAll(page, true);
    await expect(page.getByTestId("tutorial-handoff-recap")).toBeVisible();
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });
