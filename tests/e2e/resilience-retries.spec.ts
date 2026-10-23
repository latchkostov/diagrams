import { openLiveNodeDetails } from "./fixtures";
import { resilienceFixture } from "../../src/lab/resilienceFixture";
import type { RetryPolicy } from "../../src/model/admission";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
  expectNoErrors,
} from "./fixtures";

for (const initiallyOff of [false, true]) {
  test(`re-enabling retries retains custom settings (initially off: ${initiallyOff})`, async ({ page }) => {
    const d = resilienceFixture();
    const custom: RetryPolicy = {
      maxAttempts: initiallyOff ? 1 : 5,
      backoffMs: 370,
      strategy: "exponential",
      maxBackoffMs: 930,
      jitter: 0.3,
      retryOn: ["transient", "timeout"],
      idempotent: true,
      budget: { percent: 37, minPerSec: 4 },
    };
    d.edges[1].props = { ...d.edges[1].props, caller: { wait: "blocking", retry: custom } };
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      d,
    });
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").dblclick();
    await page.getByTestId("inspector-section-edge-simulation").click();
    const retries = page.getByTestId("inspector-field-retries");
    if (!initiallyOff) {
      await retries.focus();
      await retries.press("Enter");
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
        .toMatchObject({ retry: { ...custom, maxAttempts: 1 } });
    }
    await retries.focus();
    await retries.press("Enter");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
      .toMatchObject({ retry: { ...custom, maxAttempts: 3 } });
    await page.getByTestId("inspector-section-retry-details").click();
    await expect(page.getByTestId("inspector-field-retry-backoff")).toHaveValue("370");
    await page.getByTestId("inspector-section-retry-budget-details").click();
    await expect(page.getByTestId("inspector-field-retry-budget-percent")).toHaveValue("37");
  });
}

for (const locale of ["en", "ar", "en-XA"]) {
  test(`retry inspector has keyboard paths and undo in ${locale}`, async ({ page, consoleErrors }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const d = resilienceFixture();
    d.edges[1].props = { ...d.edges[1].props, caller: { wait: "non-blocking" } };
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
      },
      { key: STORAGE_KEYS.autosavePrefix + "blocking-call", d, locale },
    );
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").dblclick();
    await page.getByTestId("inspector-section-edge-simulation").click();
    const retries = page.getByTestId("inspector-field-retries");
    await retries.focus();
    await retries.press("Enter");
    await expect(page.getByTestId("inspector-field-retries-menu")).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
      .toMatchObject({
        retry: { maxAttempts: 3, backoffMs: 100, jitter: 1, budget: { percent: 20 }, retryOn: ["throttled"] },
      });
    await expect(page.getByTestId("inspector-field-retry-backoff")).toHaveCount(0);
    await page.getByTestId("inspector-section-retry-details").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-retry-backoff")).toHaveValue("100");
    await page.getByTestId("inspector-section-retry-budget-details").click();
    await expect(page.getByTestId("inspector-field-retry-budget")).toBeChecked();
    if (locale === "ar") expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    if (locale === "en-XA") await expect(retries).toContainText("[");
    await page.screenshot({ path: test.info().outputPath(`retries-${locale}.png`) });
    await page.getByTestId("undo-button").click();
    await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller).toEqual({ wait: "non-blocking" });
    expectNoErrors(consoleErrors);
  });

  test(`retry pill and Calls hover report amplification in ${locale}`, async ({ page, consoleErrors }) => {
    const d = resilienceFixture();
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
      },
      { key: STORAGE_KEYS.autosavePrefix + "blocking-call", d, locale },
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(2000);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("call-pill-call")).toContainText("↻");
    await page.getByTestId("node-caller").hover();
    await openLiveNodeDetails(page, "caller", "threads");
    await expect(page.getByTestId("calls-detail-caller")).toBeVisible();
    await expect(page.getByTestId("calls-detail-edge-call")).toContainText("×");
    await expect
      .poll(() => page.getByTestId("node-detail-caller").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    await page.screenshot({ path: test.info().outputPath(`retry-calls-${locale}.png`) });
    expectNoErrors(consoleErrors);
  });
}

test("saved retry upgrade previews a policy, keeps it off and undoes in one step", async ({ page }) => {
  const d = resilienceFixture();
  d.planning = { ...d.planning, revision: "p3-w1" };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("retry-upgrade-preview").click();
  await expect(page.getByTestId("retry-upgrade-calls")).toContainText("3 attempts");
  await page.getByTestId("retry-upgrade-keep-off").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w2");
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ retry: { maxAttempts: 1, backoffMs: 100, jitter: 1 } });
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await savedDiagram(page)).planning?.revision).toBe("p3-w1");
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ retry: { maxAttempts: 3 } });
});
