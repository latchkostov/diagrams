import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { hpaLesson } from "../../src/model/autoscaling";
import { autoscalingFixture } from "../../src/lab/autoscalingFixture";
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
async function seed(
  page: Page,
  { live = false, fixed = false, locale = "en", dark = false, older = false, replicas = 1, cpuProbe = false } = {},
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  const d = autoscalingFixture();
  const workload = d.nodes[1].props;
  if (fixed && workload) {
    delete workload.resources;
    delete workload.autoscaling;
  }
  if (replicas > 1 && workload) {
    const a = hpaLesson();
    Object.assign(a.controller, { initialReplicas: replicas, minReplicas: replicas, maxReplicas: replicas });
    workload.autoscaling = a;
  }
  if (cpuProbe && workload) {
    d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 1 };
    workload.autoscaling = { mode: "off" };
    workload.resources = {
      ...(workload.resources as ReturnType<typeof import("../../src/model/autoscaling").resourceLesson>),
      cpuMsPerMessage: 500,
    };
  }
  if (older) d.planning = { revision: "p3" };
  await page.addInitScript(
    ({ key, d, locale }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d, locale },
  );
  if (live) await page.clock.install();
  if (live) await gotoLive(page, `./?view=canvas&example=${slug}&live=1`);
  else await gotoCanvas(page, slug);
  await waitForStableViewport(page);
}

test("A1: four main fields, explicit lesson, Advanced policy validation and undo", async ({
  page,
  consoleErrors,
}, info) => {
  await seed(page, { fixed: true });
  await page.getByTestId("node-worker").click();
  await page.getByTestId("autoscaling-preset").selectOption("hpa-service");
  await expect(page.getByTestId("autoscaling-target")).toHaveValue("70");
  for (const field of ["preset", "target", "min", "max"])
    await expect(page.getByTestId(`autoscaling-${field}`)).toBeVisible();
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).not.toBeVisible();
  await expect(page.getByTestId("inspector-field-concurrency")).not.toBeVisible();
  await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
  await page.getByTestId("autoscaling-max").fill("14");
  await page.getByTestId("autoscaling-max").press("Tab");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("10");
  await page.getByTestId("autoscaling-preset").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("a1-inspector-light.png") });
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-startup")).toHaveValue("5000");
  const sync = page.getByTestId("autoscaling-sync");
  await sync.press("Control+a");
  await sync.pressSequentially("5000");
  await expect(sync).toHaveValue("5000");
  await sync.press("Tab");
  await page.getByTestId("autoscaling-advanced-toggle").focus();
  await page.keyboard.press("Control+z");
  await expect(sync).toHaveValue("15000");
  await page.getByTestId("autoscaling-policy").fill('{"up": {}}');
  await expect(page.getByTestId("autoscaling-policy-invalid")).toBeVisible();
  await page.getByTestId("autoscaling-policy").press("Tab");
  await expect(page.getByTestId("autoscaling-policy")).toHaveValue('{"up": {}}');
  const settings = hpaLesson().controller.settings;
  await page.getByTestId("autoscaling-policy").fill(JSON.stringify({ up: settings.up, down: settings.down }));
  await expect(page.getByTestId("autoscaling-policy-invalid")).toBeVisible();
  await page.getByTestId("autoscaling-preset").selectOption("fixed");
  await page.getByTestId("autoscaling-preset").selectOption("hpa-service");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-policy-invalid")).toHaveCount(0);
  const violations = await new AxeBuilder({ page })
    .include('[data-testid="autoscaling-controls"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.violations).toEqual([]);
  expectNoErrors(consoleErrors);
});

test("A1: production playback shows starting backlog, ready capacity, real resources and history", async ({
  page,
  consoleErrors,
}, info) => {
  await seed(page, { live: true });
  await pauseClock(page);
  await page.clock.runFor(15_500);
  const badge = page.getByTestId("node-badge-worker");
  await expect(badge).toHaveAttribute("data-ready", "1");
  await expect.poll(async () => Number(await badge.getAttribute("data-starting"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await badge.getAttribute("data-backlog"))).toBeGreaterThan(0);
  await page.clock.runFor(6000);
  await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(1);
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("autoscaling-cpu")).toContainText("of request");
  await expect(page.getByTestId("autoscaling-memory")).toContainText("of limit");
  await expect(page.getByTestId("autoscaling-chart")).toBeVisible();
  await expect(page.getByTestId("autoscaling-history-summary")).toContainText("Peak replicas");
  expect(await page.getByTestId("autoscaling-replica-row").count()).toBeGreaterThan(0);
  expect(await page.getByTestId("autoscaling-replica-row").count()).toBeLessThanOrEqual(50);
  await page.getByTestId("autoscaling-live-details").scrollIntoViewIfNeeded();
  const body = page.getByTestId("inspector-body");
  await expect.poll(() => body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByTestId("fit-view-button").click();
  await page.clock.runFor(1000);
  await waitForStableViewport(page);
  await page.screenshot({ path: info.outputPath("a1-live-resources.png") });
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("node-fleet-worker")).toBeVisible();
  await expect(page.getByTestId("handle-worker-right")).toBeHidden();
  await page.screenshot({ path: info.outputPath("a1-presentation.png") });
  expectNoErrors(consoleErrors);
});

for (const locale of ["de", "ar"])
  test(`A1: translated ${locale} inspector fits dark 1280×800`, async ({ page, consoleErrors }, info) => {
    await seed(page, { locale, dark: true });
    await page.getByTestId("node-worker").click();
    await expect(page.getByTestId("autoscaling-assumption")).not.toContainText("Workload assumption");
    if (locale === "ar") {
      await page.getByTestId("autoscaling-advanced-toggle").click();
      await expect(page.getByTestId("autoscaling-policy")).toHaveCSS("direction", "ltr");
      await page.getByTestId("autoscaling-advanced-toggle").click();
    }
    await page.getByTestId("autoscaling-preset").scrollIntoViewIfNeeded();
    await page.getByTestId("fit-view-button").click();
    await waitForStableViewport(page);
    const body = page.getByTestId("inspector-body");
    await expect.poll(() => body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`a1-inspector-${locale}-dark.png`) });
    expectNoErrors(consoleErrors);
  });

test("A1: an old model previews an explicit upgrade and Undo restores it", async ({ page, consoleErrors }) => {
  await seed(page, { fixed: true, older: true });
  await page.getByTestId("node-worker").click();
  await expect(page.getByTestId("autoscaling-controls")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await page.getByTestId("autoscaling-upgrade-preview").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toContainText("Resource costs are added only");
  await page.getByTestId("planning-upgrade").click();
  await page.getByTestId("node-worker").click();
  await expect(page.getByTestId("autoscaling-preset")).toBeVisible();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("autoscaling-controls")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("A1: a large selected fleet has accessible pagination and stable decision announcements", async ({
  page,
}, info) => {
  await seed(page, { live: true, dark: true, replicas: 60 });
  await pauseClock(page);
  await page.clock.runFor(1000);
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  const next = page.getByTestId("autoscaling-page-next");
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeEnabled();
  const contrast = await next.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Missing color context");
    const luminance = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const c = Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    };
    const style = getComputedStyle(el),
      fg = luminance(style.color),
      bg = luminance(style.backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(3);
  expect(await page.getByTestId("autoscaling-replica-row").count()).toBe(50);
  const status = page.getByTestId("autoscaling-announcement"),
    before = await status.innerText();
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("Orders");
  await page.clock.runFor(1000);
  await expect(status).toHaveText(before);
  await page.clock.resume();
  const violations = await new AxeBuilder({ page })
    .include('[data-testid="autoscaling-live-details"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.violations).toEqual([]);
  await next.click();
  expect(await page.getByTestId("autoscaling-replica-row").count()).toBe(10);
  await expect(next).toBeDisabled();
  await page.getByTestId("fit-view-button").click();
  await waitForStableViewport(page);
  await page.screenshot({ path: info.outputPath("a1-pagination-dark.png") });
});

test("A1: public Kafka showcase starts workers and drains its burst within ten simulated seconds", async ({
  page,
  consoleErrors,
}) => {
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=autoscaling-image-workers&live=1&sim=upload-burst&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(2000);
  const worker = page.getByTestId("node-badge-worker");
  const topic = page.getByTestId("node-badge-uploads");
  await expect(worker).toHaveAttribute("data-ready", "1");
  await expect(worker).toHaveAttribute("data-starting", "1");
  await expect.poll(async () => Number(await topic.getAttribute("data-backlog"))).toBeGreaterThan(0);
  await page.clock.runFor(4000);
  await expect.poll(async () => Number(await worker.getAttribute("data-ready"))).toBeGreaterThan(1);
  await page.clock.runFor(4000);
  await expect(topic).toHaveAttribute("data-backlog", "0");
  await expect(worker).toHaveAttribute("data-backlog", "0");
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("autoscaling-chart")).toBeVisible();
  await expect(page.getByTestId("autoscaling-history-summary")).toContainText("Peak replicas");
  await expect(page.getByTestId("autoscaling-counts")).toContainText("Ready: 5");
  expectNoErrors(consoleErrors);
});

test("A1: incomplete optional numbers retain saved resources on Tab", async ({ page }) => {
  await seed(page);
  await page.getByTestId("node-worker").click();
  await page.getByTestId("autoscaling-advanced-toggle").click();
  for (const name of ["cpuLimitMilli", "cpuRequestMilli", "memoryLimitMiB"]) {
    const field = page.getByTestId(`autoscaling-${name}`);
    const saved = await field.inputValue();
    await field.focus();
    await field.press("Control+a");
    await field.pressSequentially("1e");
    await field.press("Tab");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId(`autoscaling-limit-${name}`)).toBeVisible();
    await field.fill(saved);
    await field.press("Tab");
    await expect(field).toHaveValue(saved);
    await expect(field).toHaveAttribute("aria-invalid", "false");
  }
  // Undo remains unavailable: invalid drafts never created a document edit.
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("A1: valid Advanced JSON recovers and commits atomically", async ({ page }) => {
  await seed(page);
  await page.getByTestId("node-worker").click();
  await page.getByTestId("autoscaling-advanced-toggle").click();
  const field = page.getByTestId("autoscaling-policy");
  const before = hpaLesson().controller.settings;
  const settings = structuredClone(before);
  settings.syncMs = 5000;
  settings.metrics[0].metricDelayMs = 1000;
  settings.down.stabilizationMs = 60_000;
  await field.fill('{"up": {}}');
  await expect(page.getByTestId("autoscaling-policy-invalid")).toBeVisible();
  await field.fill(JSON.stringify(settings));
  await field.press("Tab");
  await expect(page.getByTestId("autoscaling-policy-invalid")).toHaveCount(0);
  await expect(page.getByTestId("autoscaling-sync")).toHaveValue("5000");
  const saved = () =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("Missing saved diagram");
      const d = JSON.parse(raw);
      return d.nodes.find((n: { id: string }) => n.id === "worker").props.autoscaling.controller.settings;
    }, STORAGE_KEYS.autosavePrefix + slug);
  await expect.poll(saved).toEqual(settings);
  await page.getByTestId("undo-button").click();
  await expect.poll(saved).toEqual(before);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("A1: numeric policy edits validate the complete candidate and retain rejected drafts", async ({ page }) => {
  await seed(page);
  await page.getByTestId("node-worker").click();
  await page.getByTestId("autoscaling-advanced-toggle").click();
  const policy = page.getByTestId("autoscaling-policy");
  const settings = hpaLesson().controller.settings;
  settings.metrics[0].metricDelayMs = 1000;
  await policy.fill(JSON.stringify(settings));
  await policy.press("Tab");
  const window = page.getByTestId("autoscaling-window");
  await window.fill("600000");
  await window.press("Tab");
  await expect(window).toHaveAttribute("aria-invalid", "true");
  await expect(window).toHaveValue("600000");
  await expect(page.getByTestId("autoscaling-limit-window")).toBeVisible();
  await expect(page.getByTestId("autoscaling-policy-invalid")).toHaveCount(0);
  expect(JSON.parse(await policy.inputValue())).toEqual(settings);
  await window.fill("599000");
  await window.press("Tab");
  await expect(window).toHaveAttribute("aria-invalid", "false");
  settings.metrics[0].windowMs = 599000;
  expect(JSON.parse(await policy.inputValue())).toEqual(settings);
});

test("A1: exact replica CPU reflects aggregate work before and after fifteen seconds", async ({ page }) => {
  await seed(page, { live: true, cpuProbe: true });
  await pauseClock(page);
  await page.clock.runFor(5000);
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  const aggregate = page.getByTestId("autoscaling-cpu"),
    replica = page.getByTestId("autoscaling-replica-cpu").first();
  const check = async () => {
    const cpu = Number((await aggregate.innerText()).match(/[\d.]+/)?.[0]);
    expect(cpu).toBeGreaterThan(0);
    expect(Number(await replica.innerText())).toBeCloseTo(cpu, 1);
  };
  await check();
  await page.clock.runFor(11_000);
  await check();
});
