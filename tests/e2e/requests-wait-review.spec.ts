import { test, expect, gotoLive, pauseClock, STORAGE_KEYS } from "./fixtures";
import type { DiagramFile } from "../../src/model/types";
import payment from "../../src/examples/slow-payment-provider.json" with { type: "json" };

for (const failureRate of [0, 0.3]) {
  test(`timeout outcomes keep independent loss warnings visible at failure rate ${failureRate}`, async ({ page }) => {
    const d = structuredClone(payment) as DiagramFile;
    const checkout = d.nodes.find((n) => n.id === "checkout");
    if (!checkout) throw new Error("Fixture needs Checkout");
    checkout.props = { ...checkout.props, failureRate };
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
      d,
    });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=timeout-600");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(15000);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("node-alert-checkout")).toBeVisible();
    if (failureRate) {
      await expect(page.getByTestId("trouble-headline")).toContainText("losing");
      await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "events");
    } else await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  });
}

test("a resumed narration still offers the same verified timeout", async ({ page }) => {
  const d = structuredClone(payment) as DiagramFile;
  const simulation = d.simulations?.[0];
  if (!simulation?.timeline) throw new Error("Fixture needs a timeline");
  simulation.timeline.unshift({
    atMs: 0,
    action: { do: "note", text: "Continue to start the lesson", pause: true },
  });
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider",
    d,
  });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts");
  await pauseClock(page);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.getByTestId("live-note-continue").click();
  await page.getByTestId("live-play").click();
  await page.clock.runFor(15000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("data-action", "add-timeout");
});
