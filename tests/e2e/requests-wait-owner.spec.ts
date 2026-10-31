import { openInspectorLiveDetails } from "./fixtures";
import type { Page } from "@playwright/test";
import { openLiveNodeDetails } from "./fixtures";
import { test, expect, gotoLive, pauseClock, savedDiagram, fitDiagram, STORAGE_KEYS } from "./fixtures";
import busy from "../../src/examples/scale-on-busy-threads.json" with { type: "json" };
import payment from "../../src/examples/slow-payment-provider.json" with { type: "json" };
import {
  installThreadVerification,
  waitForThreadVerification,
  installScenarioPlan,
  waitForScenarioPlan,
  releaseVerificationOnce,
} from "./thread-verification";

async function openVerifiedCallout(page: Page, holdPlan = false, inspectorRequested?: () => void) {
  await installThreadVerification(page);
  await installScenarioPlan(page, holdPlan);
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "scale-on-busy-threads",
    d: busy,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=scale-on-busy-threads&live=1&paused=1&sim=blocking");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  const simulation = busy.simulations.find((simulation) => simulation.id === "blocking");
  if (!simulation) throw new Error("Fixture needs the blocking simulation");
  // Keep eight samples and the same 15-second endpoint, spanning the ten-second trouble window at the final state.
  // An earlier crossing verifies an intermediate revision, then makes that complete replay stale on the next seek.
  for (const second of [5, 6, 7, 8, 9, 10, 12, 15]) {
    await page.getByTestId("live-timeline-input").fill(String((second * 1_000_000) / simulation.durationMs));
    await page.getByTestId("live-play").focus();
  }
  await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "15000");
  await page.getByTestId("live-play").click();
  const action = page.getByTestId("trouble-action");
  await waitForThreadVerification(page);
  await expect(action).toHaveAttribute("data-action", "scale-threads");
  await page.getByTestId("node-caller").dblclick();
  inspectorRequested?.();
  await waitForScenarioPlan(page);
  return action;
}

test("agreement setup waits for real scenario sizing while the page clock is paused", async ({ page }) => {
  const releasePlan = releaseVerificationOnce(async () => {
    await page.evaluate(() => window.__scenarioPlan?.release?.());
  });
  let inspectorRequested!: () => void;
  const inspector = new Promise<void>((resolve) => (inspectorRequested = resolve));
  let finished = false;
  const opening = openVerifiedCallout(page, true, inspectorRequested).then((action) => {
    finished = true;
    return action;
  });
  try {
    await Promise.race([inspector, opening]);
    await page.evaluate(() => window.__scenarioPlan?.whenRequested());
    await expect(page.getByTestId("inspector-live-section-resources")).toBeVisible();
    expect(await page.evaluate(() => window.__threadVerification?.requests.map(({ time }) => time))).toEqual([15000]);
    expect(finished, "fix verification does not establish that scenario sizing has replied").toBe(false);
    await releasePlan();
    const action = await opening;
    await openInspectorLiveDetails(page, "scaling");
    await expect(page.getByTestId("autoscaling-plan-text")).toContainText((await action.innerText()).trim());
  } finally {
    await releasePlan();
    await opening;
  }
});

test("the callout and planner offer the same verified fix; keyboard apply names its simulation and Undo restores it", async ({
  page,
}) => {
  const action = await openVerifiedCallout(page);
  await openInspectorLiveDetails(page, "resources");
  await openInspectorLiveDetails(page, "scaling");
  await expect(page.getByTestId("autoscaling-plan-text")).toContainText((await action.innerText()).trim());
  const before = await savedDiagram(page);
  await action.focus();
  await action.press("Enter");
  await expect(page.getByTestId("toast")).toContainText(
    "Scale on busy threads in “Threads held: CPU says all is well”",
  );
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.props?.caller)
    .toHaveProperty("autoscaling");
  expect((await savedDiagram(page)).nodes).toEqual(before.nodes);
  await page.getByTestId("thread-fix-undo").focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(400);
  await expect.poll(async () => (await savedDiagram(page)).simulations?.[0].setup).toBeUndefined();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("retired pool links keep their exact story in the merged example", async ({ page }) => {
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
    d: payment,
  });
  await gotoLive(page, "./?view=canvas&example=pool-of-40&live=1&paused=1&sim=blocking-pool");
  await expect(page).toHaveURL(/example=slow-payment-provider/);
  await expect(page).toHaveURL(/sim=blocking-pool/);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.map((s) => s.id))
    .toEqual(["no-timeouts", "timeout-600", "pool-40", "blocking-pool", "three-retries-hold-threads"]);
});

for (const locale of ["en", "ar", "en-XA"]) {
  test(`one loss count and one keyboard-readable outcome in ${locale}`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=timeout-600");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(15000);
    await page.getByTestId("live-play").click();
    const badge = page.getByTestId("node-badge-checkout");
    const lost = Number(await badge.getAttribute("data-dropped")) + Number(await badge.getAttribute("data-dlq"));
    expect(Number(await badge.getAttribute("data-failed"))).toBe(lost);
    await fitDiagram(page);
    await page.getByTestId("node-checkout").hover();
    const detail = page.getByTestId("node-detail-checkout");
    const outcome = page.getByTestId("node-outcome-checkout");
    await openLiveNodeDetails(page, "checkout", "outcomes");
    await expect(outcome).toBeVisible();
    // Close the pointer-opened detail before testing the independent keyboard path.
    await page.keyboard.press("Escape");
    await page.getByTestId("brand").hover();
    await page.getByTestId("live-play").focus();
    await expect(outcome).toHaveCount(0);
    await openLiveNodeDetails(page, "checkout", "outcomes");
    await expect(outcome).toBeVisible();
    await expect(outcome).toHaveCount(1);
    await expect(page.getByTestId("node-loss-total")).toHaveCount(0);
    await expect(page.getByTestId("node-failed-total")).toHaveCount(0);
    await expect(page.getByTestId("node-outcomes-scope")).toHaveCount(1);
    if (locale === "en") {
      await expect(page.getByTestId("node-outcomes-scope")).toHaveText("Since restart");
      // Cumulative loss belongs in one outcome, rather than the current-window alert badge.
      await expect(outcome).toContainText(`${lost.toLocaleString("en")} lost`);
      await expect(outcome).toContainText("all timed out after 0.6 s");
      await expect(outcome).toContainText("late replies discarded");
      await expect(detail).not.toContainText("Failed attempts");
      await expect(detail).not.toContainText("Dropped");
    } else {
      await expect(outcome).not.toContainText("all timed out after");
    }
  });
}
