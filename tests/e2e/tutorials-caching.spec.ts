import { test, expect, pauseClock, expectNoErrors, pageLoadTimeout } from "./fixtures";
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
const recaps: Record<string, string> = {
  "cdn-cache":
    "You added a cache rule; the hit ratio and origin counts showed less origin work. A hit can return older data: what freshness would your readers accept?",
  "derived-hit-ratio":
    "You lowered demand and raised the TTL; Inputs explained the expected hit ratio. More hits trade freshness for reuse, and popularity matters too.",
  "cache-latency":
    "You compared the source's p95 with copies and with Don't store; both retained the miss tail. Offload and tail latency answer different questions.",
  "cache-stampede":
    "You applied one fetch per item (request coalescing); the replay's outcomes showed a bounded herd and backlog. Waiting readers still wait for freshness, so what could a stale copy change?",
  "stale-while-revalidate":
    "You added a stale window (stale-while-revalidate); the hit ratio showed expiry waits disappear. Product readers may receive old data, and refresh failures can outlast the window.",
  "cold-cache":
    "You authored a cold-cache Drill and replaced its hard purge with a soft purge; origin backlog showed the difference. Soft purge needs stale copies and a stale window, so it cannot rescue a cache that has never been filled.",
};

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach("tutorial-context", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          snapshot: window.__tutorial?.snapshot(),
          diagram: window.__tutorial?.diagram(),
          runs: window.__tutorial?.runs(),
        })),
      ),
      contentType: "application/json",
    });
});

test("caching lessons have chapter numbers, seal credit and a scoped reset in the hub", async ({ page }) => {
  await page.addInitScript((ids) => {
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({
        progress: Object.fromEntries(ids.map((id) => [id, { version: 1, step: 0, completed: true }])),
      }),
    );
  }, cachingIds);
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorials-overall")).toContainText("6 of 66 core lessons · 0 of 8 seals", {
    timeout: pageLoadTimeout(),
  });
  for (const [chapter, lessons] of [
    ["blocks", [["cdn-cache", "2.6"]]],
    ["simulation", [["derived-hit-ratio", "3.2"]]],
    ["waiting", [["cache-latency", "4.1"]]],
    [
      "resilience",
      [
        ["cache-stampede", "5.1"],
        ["stale-while-revalidate", "5.2"],
        ["cold-cache", "5.3"],
      ],
    ],
  ] as const) {
    const section = page.getByTestId(`tutorials-chapter-${chapter}`);
    if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
    for (const [id, number] of lessons)
      await expect(page.getByTestId(`tutorial-open-${id}`)).toHaveAccessibleName(
        new RegExp(`^Review ${number.replace(".", "\\.")} .*Done`),
      );
  }
  await page.getByTestId("tutorials-seals").click();
  for (const [chapter, credit] of [
    ["blocks", "1 of 14"],
    ["simulation", "1 of 11"],
    ["waiting", "1 of 8"],
    ["resilience", "3 of 11"],
    ["whole-syllabus", "6 of 66"],
  ])
    await expect(
      page.getByTestId(
        chapter === "whole-syllabus" ? "tutorials-seal-whole-syllabus" : `tutorials-seal-chapter-${chapter}`,
      ),
    ).toContainText(`Not yet · ${credit}`);
  await page.getByTestId("tutorials-seals-back").click();
  await page.getByTestId("tutorials-reset-resilience").click();
  await expect(page.getByTestId("tutorials-reset-counts")).toHaveText(
    "3 finished lessons, 0 in progress and 0 seals will be reset.",
  );
  await page.getByTestId("tutorials-reset-confirm").click();
  await expect(page.getByTestId("tutorials-overall")).toContainText("3 of 66 core lessons");
  await expect(page.getByTestId("tutorial-status-cold-cache")).toHaveText("5 min · Level 3");
  await page.getByTestId("tutorials-reset-undo").click();
  await expect(page.getByTestId("tutorials-overall")).toContainText("6 of 66 core lessons");
  await page.reload();
  await expect(page.getByTestId("tutorials-overall")).toContainText("6 of 66 core lessons");
  await expectNothingSaved(page);
});

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
    // This case deliberately aborts the module and its preload. Keep every other error fatal.
    expectNoErrors(
      consoleErrors.filter((error) => error !== "console.error: Failed to load resource: net::ERR_FAILED"),
    );
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
  test(`${id}: caching Skip repairs and completes`, async ({ page, consoleErrors }) => {
    await runPointerSkipAll(page, consoleErrors, id);
    await expect(page.getByTestId("tutorial-handoff-recap")).toHaveText(recaps[id]);
    await expect(page.getByTestId("tutorial-handoff-heading")).toBeFocused();
  });
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
    await page.clock.resume();
    for (const action of example.actions) await play(page, action);
    await expect(strip(page)).toHaveAttribute("data-step", example.step);
    await page.getByTestId("coach-hint").click();
    await expect(page.getByTestId("tutorial-hint")).toBeVisible();
    await page.getByTestId("tutorial-show-me").click();
    await expect(page.getByTestId("coach-card")).toBeVisible();
    await pauseClock(page);
    await page.getByTestId("tutorial-skip").click();
    await advanceTutorialClock(page, async () => (await strip(page).getAttribute("data-step")) !== example.step);
    await skipAll(page, true);
    await expect(page.getByTestId("tutorial-handoff-recap")).toBeVisible();
    await expectNothingSaved(page);
    expectNoErrors(consoleErrors);
  });
