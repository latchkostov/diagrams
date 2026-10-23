import { resilienceFixture, breakerFixture } from "../../src/lab/resilienceFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  STORAGE_KEYS,
  openLiveNodeDetails,
} from "./fixtures";

test("circuit breaker search advertises the shared comparison", async ({ page }) => {
  await gotoCanvas(page, "blocking-call");
  await page.getByTestId("example-picker").click();
  await page.getByTestId("picker-browse-examples").click();
  await page.getByTestId("examples-search").fill("circuit breaker");
  const card = page.getByTestId("example-card-retry-storm");
  await expect(card).toBeVisible();
  await expect(card).toContainText("compare repeated calls, retry limits and a breaker that pauses failing calls");
});

test("Request groups expose plain associated explanations and preserve collapsed tuning", async ({ page }) => {
  const d = breakerFixture();
  const caller = d.edges[1].props?.caller as NonNullable<import("../../src/sim/types").EdgeSimProps["caller"]>;
  if (!caller.retry) throw new Error("Fixture needs retries");
  caller.retry.budget = { percent: 20, minPerSec: 10 };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(page.getByTestId("inspector-group-waiting-limits")).toHaveAccessibleName("Waiting limits");
  await expect(page.getByTestId("inspector-group-retries")).toHaveAccessibleDescription(
    /Each attempt has its own timeout/,
  );
  await expect(page.getByTestId("retry-limit-summary")).toHaveText("Extra calls capped at 20% over 10 seconds");
  await expect(page.getByTestId("inspector-field-retry-backoff")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-breaker-minimumCalls")).toHaveCount(0);
  await page.getByTestId("inspector-section-retry-details").click();
  await expect(page.getByTestId("inspector-content-retry-details")).toHaveAccessibleDescription(
    /Wait between attempts/,
  );
  await expect(page.getByTestId("inspector-field-retry-backoff")).toHaveAccessibleName("Wait before retrying ms");
  await page.getByTestId("inspector-section-breaker-details").click();
  await expect(page.getByTestId("inspector-content-breaker-details")).toHaveAccessibleDescription(
    /at least 1 calls.*wait 1 seconds, then try 5 calls/,
  );
  await expect(page.getByTestId("inspector-section-edge-advanced")).toHaveText("Appearance & routing");
});

test("timeline events form one roving keyboard stop and retain pointer access", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&sim=payments-outage&paused=1");
  const markers = page.getByTestId(/^live-marker-\d+$/);
  const tabs = () => markers.evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length);
  expect(await tabs()).toBe(1);
  await expect(page.getByTestId("live-timeline-input")).toHaveAttribute("tabindex", "-1");
  await page.getByTestId("live-marker-0").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("live-marker-1")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("live-marker-2")).toBeFocused();
  await expect(page.getByTestId("live-marker-2")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("live-marker-2")).toHaveAccessibleName(/Payments/);
  await expect(page.getByTestId("live-note")).toContainText("Payments is offline");
  expect(await tabs()).toBe(1);
  await page.keyboard.press("Home");
  await expect(page.getByTestId("live-marker-0")).toBeFocused();
  await page.getByTestId("live-marker-2").click();
  await expect(page.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
});

test("hover verdict appears once and recent throughput belongs to Outcomes", async ({ page }) => {
  const d = resilienceFixture();
  d.nodes[2].props = { ...d.nodes[2].props, latencyMs: 500 };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(1000);
  await page.getByTestId("live-play").click();
  await openLiveNodeDetails(page, "caller", "resources");
  const card = page.getByTestId("node-detail-caller");
  const verdict = await page.getByTestId("hover-verdict").innerText();
  expect((await card.innerText()).split(verdict).length - 1).toBe(1);
  await expect(page.getByTestId("hover-history")).toHaveCount(0);
  await page.getByTestId("hover-section-outcomes").click();
  await expect(page.getByTestId("hover-history-scope")).toHaveText("Last 10 seconds while pinned");
  await expect(page.getByTestId("hover-history-summary")).toBeVisible();
});

test("Arabic readout isolates rates and Esc restores a focused unpinned summary", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "ar"));
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
  const card = page.getByTestId("node-detail-caller");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-pinned", "false");
  expect(
    await page.getByTestId("hover-vitals").evaluate((el) => {
      const values = [...el.getElementsByTagName("bdi")];
      return values.length === 4 && values.every((value) => value.dir === "ltr");
    }),
  ).toBe(true);
  await card.focus();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  expect(await page.getByTestId("node-caller").evaluate((el) => el.parentElement === document.activeElement)).toBe(
    true,
  );
});
