import { savedDiagram } from "./fixtures";
import type { Page } from "@playwright/test";
import { planningP3Fixture, planningP3BulkFixture } from "../../src/lab/planningP3Fixture";
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
async function seed(page: Page, stencil: string, live = false, locale = "en", inherited = false, emits = false) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const d = planningP3Fixture(stencil);
  if (inherited) d.nodes[1].props = {};
  if (emits) d.nodes[1].props = { ...d.nodes[1].props, emits: { "*": "Processed" } };
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
  await page.clock.install();
  await seed(page, "generic.external-api", true);
  await pauseClock(page);
  // Only progress driven by this clock counts, rather than traffic before the page was paused.
  await page.getByTestId("live-restart").click();
  const badge = page.getByTestId("node-badge-api");
  await expect(badge).toHaveAttribute("data-rejected", "0");
  await page.clock.runFor(5000);
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
  await page.keyboard.press("ControlOrMeta+z");
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
  await expect(page.getByTestId("admission-rate")).toHaveAttribute("aria-invalid", "true");
  const feedback = page.getByTestId("admission-limit-rate");
  await expect(feedback).toContainText("Kept: 1");
  await expect(page.getByTestId("admission-rate")).toHaveAttribute(
    "aria-describedby",
    (await feedback.getAttribute("id")) as string,
  );
  await page.getByTestId("admission-rate").press("Tab");
  await expect(page.getByTestId("admission-rate")).toHaveValue("1");
  await expect(feedback).toBeVisible();
  expectNoErrors(consoleErrors);
});
test("P3: invalid numeric drafts explain the range and retained setting", async ({ page, consoleErrors }, info) => {
  await seed(page, "aws.lambda");
  await page.getByTestId("node-api").click();
  const allocation = page.getByTestId("admission-allocation");
  await allocation.fill("1200");
  await allocation.pressSequentially("0");
  await expect(allocation).toHaveValue("12000");
  await expect(allocation).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("admission-limit-allocation")).toContainText("10,000");
  await expect(page.getByTestId("admission-limit-allocation")).toContainText("Kept: 1,200");
  await page.getByTestId("admission-limit-allocation").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("admission-limit-allocation")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("p3-invalid-allocation.png") });
  await allocation.press("Tab");
  await expect(allocation).toHaveValue("1200");
  await expect(page.getByTestId("admission-limit-allocation")).toBeVisible();
  expectNoErrors(consoleErrors);
});
test("P3: admission undo groups slow typing by field", async ({ page, consoleErrors }) => {
  await page.clock.install(); // Install before mounting history, so every debounce timer uses this clock.
  await seed(page, "generic.external-api");
  await page.getByTestId("node-api").click();
  const latency = page.getByTestId("admission-latency");
  await expect(latency).toBeVisible(); // Let the pointer-up Inspector reveal finish before freezing its frame.
  await pauseClock(page);
  await latency.fill("1");
  await page.clock.runFor(1000); // Advance the history clock beyond its debounce, without a wall-clock wait.
  await latency.pressSequentially("2");
  await latency.press("Tab");
  await page.getByTestId("admission-concurrency").fill("3");
  await page.getByTestId("admission-concurrency").press("Tab");
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("admission-concurrency")).toHaveValue("2");
  await expect(latency).toHaveValue("12");
  await page.getByTestId("undo-button").click();
  await expect(latency).toHaveValue("1000");
  expectNoErrors(consoleErrors);
});
for (const stencil of ["aws.lambda", "openai"])
  test(`P3: ${stencil} keeps Emits editable under Advanced`, async ({ page, consoleErrors }) => {
    await seed(page, stencil, false, "en", false, true);
    await page.getByTestId("node-api").click();
    await page.getByTestId("admission-advanced-toggle").click();
    const emits = page.getByTestId("inspector-field-emits");
    await expect(emits).toHaveValue("* → Processed");
    await emits.fill("Renamed");
    await emits.press("Tab");
    await expect(emits).toHaveValue("Renamed");
    await emits.fill("");
    await emits.press("Tab");
    await expect(emits).toHaveValue("");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(emits).toHaveValue("* → Processed");
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
  await rate.press("ControlOrMeta+a");
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

test("P3: managed bulk editing uses applicable admission fields and preserves each account", async ({
  page,
  consoleErrors,
}, info) => {
  const d = planningP3BulkFixture();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(
    ({ key, d }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "multi-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d },
  );
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("node-other").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("bulk-admission-controls")).toBeVisible();
  await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-concurrency")).toHaveCount(0);
  await expect(page.getByTestId("admission-concurrency")).toHaveAttribute("placeholder", "Mixed");
  await page.getByTestId("admission-concurrency").fill("10001");
  await expect(page.getByTestId("admission-limit-concurrency")).toContainText("Kept: Mixed");
  await page.getByTestId("admission-concurrency").fill("3");
  await page.getByTestId("admission-concurrency").press("Tab");
  await expect
    .poll(async () => {
      const saved = await savedDiagram(page);
      return saved.nodes.filter((node) => node.id !== "source").map((node) => node.props?.api);
    })
    .toEqual([
      expect.objectContaining({ maxInFlight: 3, sharedConcurrency: "first", costPerRequest: { tokens: 2 } }),
      expect.objectContaining({ maxInFlight: 3, sharedConcurrency: "second", costPerRequest: { tokens: 2 } }),
    ]);
  await page.screenshot({ path: info.outputPath("p3-bulk.png") });
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("admission-concurrency")).toHaveAttribute("placeholder", "Mixed");
  await expect
    .poll(async () => {
      const saved = await savedDiagram(page);
      return saved.nodes.filter((node) => node.id !== "source").map((node) => node.props?.api?.maxInFlight);
    })
    .toEqual([2, 4]);
  expectNoErrors(consoleErrors);
});
test("P3: automatic function bulk selection hides fleet controls", async ({ page, consoleErrors }) => {
  const d = planningP3BulkFixture("aws.lambda");
  await page.addInitScript(
    ({ key, d }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "multi-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d },
  );
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("node-other").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("bulk-admission-controls")).toBeVisible();
  await expect(page.getByTestId("admission-allocation")).toHaveValue("10");
  await expect(page.getByTestId("admission-concurrency")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-concurrency")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
