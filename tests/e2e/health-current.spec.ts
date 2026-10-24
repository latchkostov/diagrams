import AxeBuilder from "@axe-core/playwright";
import { healthFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  STORAGE_KEYS,
  openInspectorLiveDetails,
  expectNoErrors,
} from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`recovered breaker is healthy with past timeouts in Outcomes, ${theme}`, async ({ page, consoleErrors }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      ({ diagram, key, theme }) => {
        localStorage.setItem(key, JSON.stringify(diagram));
        localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme }));
      },
      { diagram: healthFixture(), key: STORAGE_KEYS.autosavePrefix + "blocking-call", theme },
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=health&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(100);
          return (await page.getByTestId("call-pill-call").allTextContents()).join("");
        },
        { intervals: [0] },
      )
      .toContain("Open");
    await page.clock.runFor(15000);
    await page.getByTestId("live-play").click();
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
    await page.keyboard.press("Enter");
    const card = page.getByTestId("edge-detail-call");
    await expect(card.getByTestId("hover-status")).toContainText("Healthy");
    await expect(card.getByTestId("hover-verdict")).toContainText("Closed · calls succeeding");
    await card.getByTestId("hover-section-outcomes").click();
    await expect(card.getByTestId("edge-outcomes-scope")).toHaveText("Since restart");
    await expect(card.getByTestId("edge-section-outcomes")).toContainText(/Timeouts: [1-9]/);
    await expect(page.getByTestId("call-pill-call")).not.toHaveClass(/is-timeout/);
    await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
    await expect(page.getByTestId("trouble-announce")).toBeEmpty();
    await card.screenshot({ path: test.info().outputPath("recovered-hover.png") });
    await page.clock.resume();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="edge-detail-call"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByTestId("edge-call").dblclick({ force: true });
    const inspector = page.getByTestId("planning-live-details");
    await expect(inspector.getByTestId("hover-status")).toContainText("Healthy");
    await expect(inspector.getByTestId("hover-verdict")).toContainText("Closed · calls succeeding");
    await openInspectorLiveDetails(page, "outcomes");
    await expect(inspector.getByTestId("edge-outcomes-scope")).toHaveText("Since restart");
    await expect(inspector.getByTestId("edge-section-outcomes")).toContainText(/Timeouts: [1-9]/);
    expectNoErrors(consoleErrors);
  });
}

test("healthy 300/s service has no attention in its hover, badge or Inspector", async ({ page }) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(3000);
  const badge = page.getByTestId("node-badge-checkout");
  const threads = page.getByTestId("thread-meter-checkout");
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return {
          backlog: Number(await badge.getAttribute("data-backlog")),
          busy: Number(await threads.getAttribute("aria-valuenow")),
        };
      },
      { intervals: [0] },
    )
    .toEqual({ backlog: 5, busy: 5 });
  await page.getByTestId("live-play").click();
  await expect(threads).toHaveAttribute("aria-valuemax", "400");
  await expect.poll(async () => Number(await badge.getAttribute("data-processed"))).toBeGreaterThan(600);
  const node = page.getByTestId("node-checkout");
  expect(await node.evaluate((el) => el.parentElement?.getAttribute("data-live-heat"))).toBeNull();
  await node.hover();
  const card = page.getByTestId("node-detail-checkout");
  await expect(card.getByTestId("hover-status")).toContainText("Healthy");
  await expect(card).not.toContainText("Needs attention");
  await expect(page.getByTestId("node-alert-checkout")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await node.dblclick();
  await expect(page.getByTestId("planning-live-details").getByTestId("hover-status")).toContainText("Healthy");
});

for (const simulation of ["three-quick-retries", "jittered-backoff", "retry-budget", "circuit-breaker"]) {
  test(`retry lesson says what to watch early: ${simulation}`, async ({ page }) => {
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=retry-storm&live=1&sim=${simulation}&paused=1`);
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(1500);
    await expect(page.getByTestId("live-note-text")).toHaveText(/^Watch /);
    await expect(page.getByTestId("live-note")).toContainText("At 3 s");
    await expect(page.getByTestId("live-clock")).toHaveAttribute("title", "of 1:00");
  });
}
