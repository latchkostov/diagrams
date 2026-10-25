import AxeBuilder from "@axe-core/playwright";
import { breakerFixture, resilienceFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  fitDiagram,
  openInspectorLiveDetails,
  STORAGE_KEYS,
  expectNoErrors,
  savedDiagram,
} from "./fixtures";

for (const panel of ["EdgePanel", "lazyEdgePanel", "NodeIdentity"] as const) {
  for (const finish of ["typing", "Enter", "Escape"] as const) {
    test(`held connection ${panel} chunk preserves rename keys and ${finish}`, async ({ page }) => {
      let requested = false;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        new RegExp(`/\\b(?:assets/${panel}-[\\w-]+\\.js|src/canvas/inspector/${panel}\\.tsx)(?:\\?.*)?$`),
        async (route) => {
          requested = true;
          await held;
          await route.continue();
        },
      );
      await page.goto("./?view=canvas&example=blocking-call");
      await expect(page.getByTestId("canvas-view")).toBeVisible();
      await waitForStableViewport(page);
      await page.getByTestId(panel === "NodeIdentity" ? "node-caller" : "edge-call").dblclick({ force: true });
      await expect.poll(() => requested).toBe(true);
      await page.keyboard.type("test label");
      if (finish !== "typing") await page.keyboard.press(finish);
      release();
      const label = page.getByTestId("inspector-field-label");
      await expect(label).toHaveValue("test label");
      await expect(page.getByTestId("inspector-edge-loading")).toHaveCount(0);
      if (finish === "typing") {
        await expect(label).toBeFocused();
        await page.keyboard.type(" extended");
        await expect(label).toHaveValue("test label extended");
      } else await expect(label).not.toBeFocused();
      await expect(page.getByTestId("live-play")).toHaveCount(0);
      await expect(page.getByTestId(/^annotation-text-/)).toHaveCount(0);
    });
  }
}

test("connection Properties Retry retains keyboard focus without a rename request", async ({ page }) => {
  let fail = true;
  await page.route(
    /\/(?:assets\/EdgePanel-[\w-]+\.js|src\/canvas\/inspector\/EdgePanel\.tsx)(?:\?.*)?$/,
    async (route) => {
      if (fail) await route.abort("failed");
      else await route.continue();
    },
  );
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").click({ button: "right", force: true });
  await page.getByTestId("context-menu-item-node.properties").click();
  const retry = page.getByTestId("inspector-edge-retry");
  await expect(retry).toBeVisible();
  await retry.focus();
  fail = false;
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("inspector-edge-loading")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
});

test("running wait overrides agree in node Inspector and hover", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=free-thread&paused=1");
  await pauseClock(page);
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").dblclick();
  await openInspectorLiveDetails(page, "threads");
  const ceiling = page.getByTestId("planning-live-details").getByTestId("thread-ceiling");
  await expect(ceiling).toContainText("reply");
  await expect(page.getByTestId("planning-observed")).toHaveCount(0);
  await expect(page.getByTestId("planning-more-toggle")).toBeVisible();
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  await card.click();
  await card.getByTestId("hover-section-threads").click();
  await expect(card.getByTestId("thread-ceiling")).toContainText("reply");
});

test("request Inspector plots successful-request throughput", async ({ page }) => {
  const d = resilienceFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 0 };
  d.nodes[1].props = { ...d.nodes[1].props, concurrency: 100 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 30, jitter: 0, concurrency: 100, failureRate: 0 };
  d.simulations = [
    {
      id: "successful",
      title: "Successful requests",
      durationMs: 20000,
      traffic: [{ id: "batch", node: "source", shape: { kind: "burst", count: 100, atMs: 5500 } }],
    },
  ];
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=successful&paused=1");
  await pauseClock(page);
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick({ force: true });
  await page.getByTestId("live-play").click();
  await page.clock.runFor(5800);
  await page.getByTestId("live-play").click();
  const area = page.getByTestId("planning-live-details");
  // All 100 burst requests completed within this ten-second window, clear of its bucket boundaries.
  await expect(area.getByTestId("hover-vital-goodput")).toHaveText("10/sGoodput");
  await expect(area.getByTestId("hover-history-values")).toHaveText(/10\/s$/);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(6200);
  await page.getByTestId("live-play").click();
  const samples = (await area.getByTestId("hover-history-values").innerText()).match(/\d+(?:\.\d+)?\/s/g) ?? [];
  expect(samples).toHaveLength(10);
  await expect(area.getByTestId("hover-history-scope")).toHaveText("Last 10 seconds");
});

test("a held connection Inspector keeps its frame usable and restores naming after Retry", async ({ page }) => {
  let requested = false;
  let fail = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/EdgePanel-[\w-]+\.js|src\/canvas\/inspector\/EdgePanel\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      if (fail) await route.abort("failed");
      else await route.continue();
    },
  );
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick({ force: true });
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByTestId("inspector-title")).toHaveText("Edge");
  await expect(page.getByTestId("inspector-toggle")).toBeVisible();
  await expect(page.getByTestId("inspector-edge-loading")).toBeVisible();
  release();
  await expect(page.getByTestId("inspector-edge-retry")).toBeVisible();
  fail = false;
  await page.getByTestId("inspector-edge-retry").click();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await expect(page.getByTestId("inspector-live-waiting")).toBeVisible();
});

test("deferred Advanced properties keep the connection's Live area and fields usable", async ({ page }) => {
  let requested = false;
  let fail = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/EdgeAdvanced-[\w-]+\.js|src\/canvas\/inspector\/EdgeAdvanced\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      if (fail) await route.abort("failed");
      else await route.continue();
    },
  );
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick({ force: true });
  await expect.poll(() => requested).toBe(true);
  await page.getByTestId("inspector-field-label").fill("Scoring request");
  await expect(page.getByTestId("planning-live-details")).toBeVisible();
  release();
  await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
  fail = false;
  await page.getByTestId("lazy-load-retry").click();
  await expect(page.getByTestId("inspector-live-waiting")).toBeVisible();
  await expect(page.getByTestId("inspector-field-label")).toHaveValue("Scoring request");
  await page.getByTestId("inspector-section-edge-advanced").click();
  const side = page.getByTestId("inspector-field-sourceSide");
  await expect(side).toBeVisible();
  await side.selectOption("bottom");
  await expect(side).toHaveValue("bottom");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((edge) => edge.id === "call")?.sourceSide)
    .toBe("bottom");
});

test("Message connections plot observed deliveries without request semantics", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await waitForStableViewport(page);
  await page.getByTestId("edge-publish").dblclick({ force: true });
  const area = page.getByTestId("planning-live-details");
  await expect(area.getByTestId("inspector-live-waiting")).toBeVisible();
  await page.getByTestId("live-play").click();
  await page.clock.runFor(3000);
  await page.getByTestId("live-play").click();
  // Rates are bidi-isolated in translated prose; still require a nonzero observed delivery rate.
  await expect(area.getByTestId("hover-history-summary")).toContainText(/Now \u2068[1-9]/);
  await expect(area.getByTestId("hover-vitals")).toContainText("Delivered");
  await expect(area.getByTestId("inspector-live-section-retries")).toHaveCount(0);
});

test("a held node section keeps the docked summary readable and retries within Properties", async ({ page }) => {
  let requested = false;
  let fail = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:assets\/NodeDetailSections-[\w-]+\.js|src\/live\/NodeDetailSections\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      if (fail) await route.abort("failed");
      else await route.continue();
    },
  );
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").dblclick();
  const area = page.getByTestId("planning-live-details");
  await openInspectorLiveDetails(page, "threads");
  await expect.poll(() => requested).toBe(true);
  await expect(area.getByTestId("hover-verdict")).toBeVisible();
  await expect(area.getByTestId("inspector-live-details-loading")).toBeVisible();
  release();
  await expect(area.getByTestId("inspector-live-details-retry")).toBeVisible();
  fail = false;
  await area.getByTestId("inspector-live-details-retry").click();
  await expect(area.getByTestId("thread-detail-caller")).toBeVisible();
});

for (const [width, columns] of [
  [312, 2],
  [452, 3],
]) {
  test(`Live wraps reader names in a ${width}px panel`, async ({ page }) => {
    await page.addInitScript((width) => localStorage.setItem("diagrams.inspector.width.v1", String(width)), width);
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
    await pauseClock(page);
    await waitForStableViewport(page);
    await page.getByTestId("node-order-events").dblclick();
    await page.getByTestId("live-play").click();
    await page.clock.runFor(3000);
    await page.getByTestId("live-play").click();
    const area = page.getByTestId("planning-live-details");
    await expect(area.getByTestId("inspector-live-section-readers")).toContainText("inventory-reservations");
    await expect
      .poll(() =>
        area.getByTestId("hover-vitals").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
      )
      .toBe(columns);
    await expect.poll(() => area.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await openInspectorLiveDetails(page, "readers");
    await expect(area.getByTestId("planning-live-lag-inventory-reservations")).toBeVisible();
  });
}

test("node Live is docked, opens the verdict section, and updates without resetting disclosure", async ({
  page,
  consoleErrors,
}) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=blocking&paused=1");
  await pauseClock(page);
  await waitForStableViewport(page);
  await page.getByTestId("node-caller").dblclick();
  const area = page.getByTestId("planning-live-details");
  await expect(area.getByTestId("inspector-live-title")).toHaveText("Live");
  await expect(area.getByTestId("planning-live-details-toggle")).toHaveAccessibleName("Live Healthy");
  await expect(area.getByTestId("inspector-live-waiting")).toHaveText("Waiting for the first second of traffic");
  await expect(area.getByTestId("hover-vitals")).toHaveCount(0);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(5000);
  await page.getByTestId("live-play").click();
  await expect(area.getByTestId("hover-vitals")).toContainText("Throughput");
  await expect(area.getByTestId("hover-vitals")).toContainText("p95");
  await expect(area.getByTestId("hover-vitals")).toContainText("Threads");
  await expect(area.getByTestId("hover-verdict")).toContainText("threads are busy");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  await expect(area.getByTestId("hover-verdict")).toHaveText(
    (await card.getByTestId("hover-verdict").textContent()) ?? "",
  );
  const warningBackground = await card
    .getByTestId("hover-vital-threads")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect
    .poll(() => area.getByTestId("hover-vital-threads").evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(warningBackground);
  // Re-selecting initializes the default from the current verdict.
  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("node-caller").dblclick();
  await expect(area.getByTestId("inspector-live-section-threads")).toHaveAttribute("aria-expanded", "true");
  await area.getByTestId("inspector-live-section-outcomes").click();
  const processed = area.getByTestId("inspector-live-outcome-processed");
  await expect(processed).toBeVisible();
  await expect(area.getByTestId("inspector-live-outcome-failed")).toHaveCount(0);
  await expect(area.getByTestId("inspector-live-outcome-lost")).toHaveCount(0);
  await expect(area.getByTestId("inspector-live-no-failures")).toBeVisible();
  const before = (await processed.textContent()) ?? "";
  await page.getByTestId("live-play").click();
  await page.clock.runFor(3000);
  await page.getByTestId("live-play").click();
  await expect(processed).not.toHaveText(before);
  await expect(area.getByTestId("inspector-live-section-outcomes")).toHaveAttribute("aria-expanded", "true");
  await expect(area.getByTestId("hover-history-summary")).toContainText(/Now .*low .*peak/);
  await expect(area.getByTestId("hover-history-chart")).toHaveAccessibleName("Last 10 seconds");
  expectNoErrors(consoleErrors);
});

for (const theme of ["light", "dark"] as const) {
  test(`connection Live shares breaker verdict, tiles and rows, with accessible ${theme} markup`, async ({
    page,
    consoleErrors,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      ({ key, diagram, theme }) => {
        localStorage.setItem(key, JSON.stringify(diagram));
        localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme }));
      },
      { key: STORAGE_KEYS.autosavePrefix + "blocking-call", diagram: breakerFixture(), theme },
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(1200);
    await page.getByTestId("live-play").click();
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").dblclick({ force: true });
    const area = page.getByTestId("planning-live-details");
    await expect(area.getByTestId("hover-verdict")).toContainText("Breaker open");
    for (const text of ["Requests", "Attempts", "Goodput", "In flight"])
      await expect(area.getByTestId("hover-vitals")).toContainText(text);
    await expect(area.getByTestId("inspector-live-section-breaker")).toHaveAttribute("aria-expanded", "true");
    await expect(area.getByTestId("edge-breaker-call")).toHaveAttribute("data-state", "open");
    await area.getByTestId("inspector-live-section-retries").click();
    await expect(area.getByTestId("edge-section-retries")).toContainText("Retries");
    await area.getByTestId("inspector-live-section-outcomes").click();
    await expect(area.getByTestId("edge-section-outcomes")).toContainText("Timeouts");
    await expect(area.getByTestId("hover-history-chart")).toHaveAccessibleName("Last 10 seconds");
    const history = (await area.getByTestId("hover-history-values").textContent()) ?? "";
    await page.getByTestId("live-play").click();
    await page.clock.runFor(3000);
    await page.getByTestId("live-play").click();
    await expect(area.getByTestId("hover-history-values")).not.toHaveText(history);
    await expect(area.getByTestId("inspector-live-section-outcomes")).toHaveAttribute("aria-expanded", "true");
    await page.clock.resume();
    const violations = (
      await new AxeBuilder({ page })
        .include('[data-testid="planning-live-details"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations;
    expect(violations).toEqual([]);
    await fitDiagram(page);
    await page.getByTestId("node-partner").dblclick();
    await expect(area.getByTestId("inspector-live-section-outcomes")).toHaveAttribute("aria-expanded", "true");
    await expect(area.getByTestId("inspector-live-outcome-failed")).toContainText(/Failed[1-9]/);
    await expect(area.getByTestId("inspector-live-outcome-deadLettered")).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="planning-live-details"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expectNoErrors(consoleErrors);
  });
}
