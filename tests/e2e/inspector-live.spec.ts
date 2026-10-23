import AxeBuilder from "@axe-core/playwright";
import { breakerFixture } from "../../src/lab/resilienceFixture";
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
} from "./fixtures";

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
  await expect(area.getByTestId("hover-history-summary")).toContainText(/Now [1-9]/);
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
  await expect(area.getByTestId("planning-live-details-toggle")).toHaveText(/Live$/);
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
    await area.getByTestId("inspector-live-section-timeouts").click();
    await expect(area.getByTestId("edge-section-timeouts")).toContainText("Timeouts");
    await expect(area.getByTestId("hover-history-chart")).toHaveAccessibleName("Last 10 seconds");
    const history = (await area.getByTestId("hover-history-values").textContent()) ?? "";
    await page.getByTestId("live-play").click();
    await page.clock.runFor(3000);
    await page.getByTestId("live-play").click();
    await expect(area.getByTestId("hover-history-values")).not.toHaveText(history);
    await expect(area.getByTestId("inspector-live-section-timeouts")).toHaveAttribute("aria-expanded", "true");
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
