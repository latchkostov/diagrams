import type { Page } from "@playwright/test";
import { planningP3Fixture } from "../../src/lab/planningP3Fixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
} from "./fixtures";
const slug = "kafka-order-pipeline";
async function seed(page: Page, stencil: string, live = false, locale = "en", inherited = false) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const d = planningP3Fixture(stencil);
  if (inherited) d.nodes[1].props = {};
  await page.addInitScript(
    ({ key, d, locale }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d, locale },
  );
  if (live) await gotoLive(page, `./?view=canvas&example=${slug}&live=1`);
  else await gotoCanvas(page, slug);
  await waitForStableViewport(page);
}
test("P3: external admission reports rejections separately with no caller cascade", async ({
  page,
  consoleErrors,
}, info) => {
  await seed(page, "generic.external-api", true);
  await pauseClock(page);
  await page.clock.runFor(5000);
  const badge = page.getByTestId("node-badge-api");
  await expect.poll(async () => Number(await badge.getAttribute("data-rejected"))).toBeGreaterThan(0);
  await expect(badge).toHaveAttribute("data-failed", "0");
  await expect(page.getByTestId("node-badge-source")).toHaveAttribute("data-failed", "0");
  await expect(page.getByTestId("node-rejected-api")).toContainText("Rejected");
  await expect(page.getByTestId("node-alert-api")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("p3-live.png") });
  expectNoErrors(consoleErrors);
});
test("P3: a preset and four main controls; editing a local cap is undoable", async ({ page, consoleErrors }, info) => {
  await seed(page, "stripe");
  await page.getByTestId("node-api").click();
  await expect(page.getByTestId("admission-preset")).toHaveValue("stripe-live");
  await expect(page.getByTestId("admission-rate")).toHaveValue("");
  await expect(page.getByTestId("admission-account-rate")).toContainText("100 req/s");
  for (const field of ["rate", "concurrency", "latency", "errors"])
    await expect(page.getByTestId(`admission-${field}`)).toBeVisible();
  await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
  await page.getByTestId("admission-concurrency").fill("2");
  await page.getByTestId("admission-concurrency").press("Tab");
  await expect(page.getByTestId("admission-concurrency")).toHaveValue("2");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("admission-concurrency")).toHaveValue("50");
  await page.getByTestId("admission-advanced-toggle").click();
  await expect(page.getByTestId("admission-source")).toHaveAttribute("href", "https://docs.stripe.com/rate-limits");
  await page.screenshot({ path: info.outputPath("p3-stripe.png") });
  expectNoErrors(consoleErrors);
});
test("P3: zero local rate is invalid and cannot silently remove the existing budget", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, "stripe");
  await page.getByTestId("node-api").click();
  await page.getByTestId("admission-rate").fill("1");
  await page.getByTestId("admission-rate").press("Tab");
  await page.getByTestId("admission-rate").fill("0");
  await page.getByTestId("admission-rate").press("Tab");
  await expect(page.getByTestId("admission-rate")).toHaveValue("1");
  expectNoErrors(consoleErrors);
});
test("P3: numeric keyboard drafts survive clearing and fractional entry", async ({ page, consoleErrors }) => {
  await seed(page, "generic.external-api");
  await page.getByTestId("node-api").click();
  const duration = page.getByTestId("admission-latency");
  await duration.fill("");
  await expect(duration).toHaveValue("");
  await duration.pressSequentially("12");
  await duration.press("Tab");
  await expect(duration).toHaveValue("12");
  const rate = page.getByTestId("admission-rate");
  await rate.fill("");
  await rate.pressSequentially("0.5");
  await rate.press("Tab");
  await expect(rate).toHaveValue("0.5");
  expectNoErrors(consoleErrors);
});
test("P3: an unfinished numeric exponent cannot remove a committed local cap", async ({ page, consoleErrors }) => {
  await seed(page, "generic.external-api");
  await page.getByTestId("node-api").click();
  const rate = page.getByTestId("admission-rate");
  await rate.fill("1");
  await rate.press("Tab");
  await rate.focus();
  await rate.press("Control+a");
  await rate.pressSequentially("1e");
  await rate.press("Tab");
  await expect(rate).toHaveValue("1");
  expectNoErrors(consoleErrors);
});
test("P3: omitted and cleared Lambda overrides show inherited effective settings", async ({ page, consoleErrors }) => {
  await seed(page, "aws.lambda", false, "en", true);
  await page.getByTestId("node-api").click();
  await expect(page.getByTestId("admission-allocation")).toHaveValue("1000");
  await expect(page.getByTestId("admission-concurrency")).toHaveCount(0);
  await page.getByTestId("admission-advanced-toggle").click();
  await expect(page.getByTestId("admission-scaling")).toHaveValue("auto");
  await page.getByTestId("admission-allocation").fill("");
  await page.getByTestId("admission-allocation").press("Tab");
  await expect(page.getByTestId("admission-allocation")).toHaveValue("1000");
  expectNoErrors(consoleErrors);
});
test("P3: unknown evidence stays visible and never promises unlimited vendor capacity", async ({
  page,
  consoleErrors,
}, info) => {
  await seed(page, "paypal");
  await page.getByTestId("node-api").click();
  await expect(page.getByTestId("admission-unknown")).toContainText("Limits unknown");
  await expect(page.getByTestId("planning-arithmetic")).toContainText("Limits unknown");
  await expect(page.getByTestId("admission-controls")).not.toContainText(/unlimited/i);
  await page.screenshot({ path: info.outputPath("p3-unknown.png") });
  expectNoErrors(consoleErrors);
});
test("P3: translated rejection labels fit the event log", async ({ page, consoleErrors }) => {
  await seed(page, "generic.external-api", true, "de");
  await pauseClock(page);
  await page.clock.runFor(5000);
  await page.getByTestId("node-api").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.behaviour").click();
  await page.getByTestId("context-menu-item-sim.events").click();
  const kind = page.getByTestId("live-event-kind").filter({ hasText: "Abgelehnt" }).first();
  await expect(kind).toBeVisible();
  expect(await kind.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expectNoErrors(consoleErrors);
});
for (const locale of ["ar", "en-XA"])
  test(`P3: translated controls fit in ${locale}`, async ({ page, consoleErrors }, info) => {
    await seed(page, "aws.lambda", false, locale);
    await page.getByTestId("node-api").click();
    await expect(page.getByTestId("admission-controls")).toBeVisible();
    await page.getByTestId("admission-advanced-toggle").click();
    await expect(page.getByTestId("admission-scaling")).toHaveValue("auto");
    await expect(page.getByTestId("admission-auto-assumption")).toBeVisible();
    expect(await page.getByTestId("admission-auto-assumption").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const overflow = await page.getByTestId("admission-controls").evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`p3-${locale}.png`) });
    expectNoErrors(consoleErrors);
  });
