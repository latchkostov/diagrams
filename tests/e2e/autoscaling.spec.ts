import { openInspectorLiveDetails } from "./fixtures";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { makePayload } from "../../src/editor/clipboard";
import { hpaLesson } from "../../src/model/autoscalingLessons";
import { autoscalingFixture, sampledCpuBudgetFixture } from "../../src/lab/autoscalingFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  expectNoErrors,
  STORAGE_KEYS,
  savedDiagram,
} from "./fixtures";

const slug = "kafka-order-pipeline";
async function seed(
  page: Page,
  {
    live = false,
    fixed = false,
    locale = "en",
    dark = false,
    older = false,
    replicas = 1,
    cpuProbe = false,
    readinessDelay = 0,
    twoWorkers = false,
    budget = false,
    cpuBudget = false,
    manualReplicas = false,
    fixedResources = false,
    partialReadiness = false,
  } = {},
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  const d = cpuBudget ? sampledCpuBudgetFixture() : autoscalingFixture();
  const workload = d.nodes[1].props;
  if (partialReadiness && workload?.resources) {
    workload.resources = {
      ...(workload.resources as ReturnType<typeof import("../../src/model/autoscaling").resourceLesson>),
      startup: { delayMs: 5000, jitterFraction: 0.8 },
    };
  }
  if (fixedResources && workload) workload.autoscaling = { mode: "off" };
  if (manualReplicas)
    d.simulations = [
      {
        id: "manual",
        title: "Manual replicas",
        traffic: [],
        durationMs: 30_000,
        timeline: [
          { atMs: 1000, action: { do: "props", node: "worker", props: { replicas: partialReadiness ? 8 : 3 } } },
        ],
      },
    ];
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
  if (twoWorkers) {
    d.nodes = [
      d.nodes[1],
      {
        ...structuredClone(d.nodes[1]),
        id: "worker2",
        x: 800,
        props: { ...d.nodes[1].props, autoscaling: { mode: "off" } },
      },
    ];
    d.edges = [];
  }
  if (budget) {
    const worker = d.nodes[1];
    d.nodes = [
      d.nodes[0],
      ...Array.from({ length: 25 }, (_, i) => ({
        ...structuredClone(worker),
        id: i === 0 ? "worker" : `worker-${i}`,
        x: 440 + (i % 5) * 330,
        y: Math.floor(i / 5) * 180,
        props: { ...worker.props, replicas: 1000, autoscaling: { mode: "off" } },
      })),
    ];
    d.simulations = [
      {
        id: "budget",
        title: "Budget",
        traffic: [],
        durationMs: 10_000,
        timeline: [{ atMs: 1000, action: { do: "props", node: "worker", props: { replicas: 1000 } } }],
      },
    ];
  }
  if (older) d.planning = { revision: "p3" };
  await page.addInitScript(
    ({ key, d, locale }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem(
        "diagrams.inspector.open.v1",
        JSON.stringify({ "node-simulation": true, "multi-simulation": true }),
      );
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d, locale },
  );
  if (live) await page.clock.install();
  if (live) await gotoLive(page, `./?view=canvas&example=${slug}&live=1&paused=1`);
  else await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  if (live) {
    await pauseClock(page);
    // Live is paused: advance the pre-play wall clock without rendering thousands
    // of irrelevant frames. Playback below still delivers every simulation tick.
    if (readinessDelay) {
      const frames = await page.evaluateHandle(() => {
        const state = { count: 0, pending: 0 };
        const tick = () => {
          state.count++;
          state.pending = requestAnimationFrame(tick);
        };
        state.pending = requestAnimationFrame(tick);
        return state;
      });
      try {
        await page.clock.fastForward(readinessDelay);
        // Guard the work, not a wall-clock budget: replaying thousands of paused frames
        // used most of the test timeout on Windows before playback even started.
        expect(await frames.evaluate((state) => state.count)).toBeLessThanOrEqual(1);
      } finally {
        await frames.evaluate((state) => cancelAnimationFrame(state.pending));
        await frames.dispose();
      }
    }
    await page.getByTestId("live-play").click();
  }
}

test("A1: keyboard Save flushes a focused numeric draft before downloading", async ({ page }, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined }),
  );
  await seed(page);
  await page.getByTestId("node-worker").click();
  const field = page.getByTestId("autoscaling-max");
  await field.fill("14");
  await expect(field).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent("download"), field.press("ControlOrMeta+s")]);
  const path = info.outputPath("keyboard-save.json");
  await download.saveAs(path);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved.nodes.find((n: { id: string }) => n.id === "worker").props.autoscaling.controller.maxReplicas).toBe(14);
  await expect(field).toBeFocused();
});

test("A1: scaling announcements remain in the accessibility tree with Live details closed", async ({ page }) => {
  await seed(page, { live: true });
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("planning-live-details-toggle")).toHaveAttribute("aria-expanded", "false");
  const status = page.getByTestId("autoscaling-announcement");
  await expect(status).toMatchAriaSnapshot('- status: "Orders · Ready: 1 → Desired: 1"');
  await page.clock.runFor(15_500);
  await expect(status).toContainText("Desired: 2");
  expect(await status.ariaSnapshot()).toContain("Desired: 2");
  await expect(page.getByTestId("planning-live-details-toggle")).toHaveAttribute("aria-expanded", "false");
});

test("A1: coalesces partial jittered readiness until completion", async ({ page }) => {
  await seed(page, { live: true, manualReplicas: true, partialReadiness: true });
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("live-sim-picker").selectOption("manual");
  await page.clock.runFor(1500);
  const status = page.getByTestId("autoscaling-announcement"),
    badge = page.getByTestId("node-badge-worker");
  await expect(status).toContainText("Desired: 8");
  const announcement = await status.textContent();
  if (!announcement) throw new Error("Missing scaling announcement");
  await expect(badge).toHaveAttribute("data-ready", "1");
  // Observe every published readiness change in the page. Do not spend eighty browser round trips
  // and trace snapshots discovering the first partial fleet on the small native runners.
  const publications = await badge.evaluateHandle((el) => {
    const samples: { ready: number; announcement: string | null }[] = [];
    const observer = new MutationObserver(() => {
      samples.push({
        ready: Number(el.getAttribute("data-ready")),
        announcement: document.querySelector('[data-testid="autoscaling-announcement"]')?.textContent ?? null,
      });
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-ready"] });
    return { samples, stop: () => observer.disconnect() };
  });
  try {
    await page.clock.runFor(8000);
    const partial = (await publications.evaluate(({ samples }) => samples)).filter((s) => s.ready > 1 && s.ready < 8);
    expect(partial.length).toBeGreaterThan(0);
    for (const sample of partial) expect(sample.announcement).toBe(announcement);
  } finally {
    await publications.evaluate(({ stop }) => stop());
    await publications.dispose();
  }
  await page.clock.runFor(10_000);
  await expect(badge).toHaveAttribute("data-ready", "8");
  await expect(status).toContainText("Ready: 8 → Desired: 8");
});

for (const fixedResources of [false, true])
  test(`A1: manual replicas announce completion with suspended syncs (fixed=${fixedResources})`, async ({ page }) => {
    await seed(page, { live: true, manualReplicas: true, fixedResources });
    await page.getByTestId("node-worker").dblclick();
    await page.getByTestId("live-sim-picker").selectOption("manual");
    await page.clock.runFor(1500);
    const status = page.getByTestId("autoscaling-announcement");
    await expect(status).toContainText("Ready: 1 → Desired: 3");
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-ready", "3");
    await expect(status).toContainText("Ready: 3 → Desired: 3");
  });

test("A1: running an over-budget draft preserves the previous run and recovers after correction", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, { live: true, budget: true });
  await page.getByTestId("live-sim-picker").selectOption("budget");
  await page.clock.runFor(300);
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await expect(page.getByTestId("sim-panel-title")).toHaveValue("Budget");
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  const field = page.getByTestId("sim-panel-step-0-value");
  await field.fill("1001");
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  const clock = page.getByTestId("live-clock"),
    before = await clock.getAttribute("data-ms");
  await page.getByTestId("sim-panel-run").click();
  await expect(page.getByTestId("live-notice")).toContainText("Resource lifecycle budget exceeded");
  await expect(clock).toHaveAttribute("data-ms", before ?? "");
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("budget");
  await field.fill("999");
  await page.getByTestId("sim-panel-run").click();
  await expect(page.getByTestId("live-notice")).toHaveCount(0);
  await page.clock.runFor(1500);
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-desired", "999");
  expectNoErrors(consoleErrors);
});

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
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("10");
  await page.getByTestId("autoscaling-preset").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("a1-inspector-light.png") });
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-startup")).toHaveValue("5000");
  const sync = page.getByTestId("autoscaling-sync");
  await sync.press("ControlOrMeta+a");
  await sync.pressSequentially("5000");
  await expect(sync).toHaveValue("5000");
  await sync.press("Tab");
  await page.getByTestId("autoscaling-advanced-toggle").focus();
  await page.keyboard.press("ControlOrMeta+z");
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
  test.slow();
  await seed(page, { live: true });
  await pauseClock(page);
  await page.getByTestId("live-restart").click();
  await page.clock.runFor(15_500);
  const badge = page.getByTestId("node-badge-worker");
  await expect(badge).toHaveAttribute("data-ready", "1");
  await expect.poll(async () => Number(await badge.getAttribute("data-starting"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await badge.getAttribute("data-backlog"))).toBeGreaterThan(0);
  await page.clock.runFor(6000);
  await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(1);
  await page.getByTestId("node-worker").dblclick();
  await openInspectorLiveDetails(page, "resources");
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
  await page.keyboard.press("ControlOrMeta+k");
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
  await openInspectorLiveDetails(page, "resources");
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
  await gotoLive(page, "./?view=canvas&example=autoscaling-basics&live=1&sim=upload-burst&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(2000);
  const worker = page.getByTestId("node-badge-image-workers");
  const topic = page.getByTestId("node-badge-uploads");
  await expect(worker).toHaveAttribute("data-ready", "1");
  await expect(worker).toHaveAttribute("data-starting", "1");
  await expect.poll(async () => Number(await topic.getAttribute("data-backlog"))).toBeGreaterThan(0);
  await page.clock.runFor(4000);
  await expect.poll(async () => Number(await worker.getAttribute("data-ready"))).toBeGreaterThan(1);
  await page.clock.runFor(4000);
  await expect(topic).toHaveAttribute("data-backlog", "0");
  await expect(worker).toHaveAttribute("data-backlog", "0");
  await page.getByTestId("node-image-workers").dblclick();
  await openInspectorLiveDetails(page, "resources");
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
    await field.press("ControlOrMeta+a");
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
  const saved = async () => {
    const d = await savedDiagram(page);
    const policy = d.nodes.find((n) => n.id === "worker")?.props?.autoscaling as ReturnType<typeof hpaLesson>;
    return policy.controller.settings;
  };
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
  await openInspectorLiveDetails(page, "resources");
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

test("A1 startup timing is independent of page readiness", async ({ page }) => {
  await seed(page, { live: true, readinessDelay: 30_000 });
  const badge = page.getByTestId("node-badge-worker");
  await expect(badge).toHaveAttribute("data-ready", "1");
  await expect(badge).toHaveAttribute("data-starting", "0");
  await page.clock.runFor(15_500);
  await expect(badge).toHaveAttribute("data-ready", "1");
  await expect.poll(async () => Number(await badge.getAttribute("data-starting"))).toBeGreaterThan(0);
  await page.clock.runFor(6000);
  await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(1);
});

test("A1 model disclosures switch to the requested preview and expose their own state", async ({ page }) => {
  await seed(page, { fixed: true, older: true });
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  const a1 = page.getByTestId("autoscaling-upgrade-preview"),
    legacy = page.getByTestId("planning-preview");
  await a1.click();
  await expect(a1).toHaveAttribute("aria-expanded", "true");
  await expect(legacy).toHaveAttribute("aria-expanded", "false");
  await expect(a1).toHaveAttribute("aria-controls", "planning-a1-content");
  await expect(legacy).toHaveAttribute("aria-controls", "planning-legacy-content");
  await legacy.click();
  await expect(page.getByTestId("planning-legacy-preview")).toBeVisible();
  await expect(page.getByTestId("planning-upgrade-preview")).toHaveCount(0);
  await expect(a1).toHaveAttribute("aria-expanded", "false");
  await expect(legacy).toHaveAttribute("aria-expanded", "true");
  await a1.click();
  await expect(page.getByTestId("planning-upgrade-preview")).toBeVisible();
  await expect(page.getByTestId("planning-legacy-preview")).toHaveCount(0);
  await a1.click();
  await expect(a1).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("planning-upgrade-preview")).toHaveCount(0);
});

test("A1 refused paste announces model compatibility and opens the upgrade preview", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seed(page, { fixed: true, older: true });
  const payload = makePayload(autoscalingFixture(), ["worker"]);
  if (!payload) throw new Error("Missing A1 clipboard fixture");
  await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(payload));
  await page.getByTestId("node-worker").click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByTestId("toast-model-upgrade")).toBeVisible();
  await page.getByTestId("toast-model-upgrade").click();
  await expect(page.getByTestId("planning-upgrade-preview")).toBeVisible();
  await expect(page.getByTestId("autoscaling-upgrade-preview")).toBeFocused();
  await page.getByTestId("node-worker").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("diagram properties");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("autoscaling-upgrade-preview")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("planning-upgrade-preview")).toHaveCount(0);
});

for (const live of [false, true])
  test(`A1: mixed bulk selection hides HPA-owned replicas (live=${live})`, async ({ page, consoleErrors }) => {
    await seed(page, { twoWorkers: true });
    await page.getByTestId("node-worker").click();
    await page.keyboard.press("ControlOrMeta+a");
    if (live) {
      await page.getByTestId("live-toggle").click();
      await expect(page.getByTestId("live-controls")).toBeVisible();
      await page.getByTestId("inspector-toggle").click();
    }
    await expect(page.getByTestId("inspector-field-latencyMs")).toBeVisible();
    await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

test("A1: capacity input budget refusals are announced and recover without losing prior inputs", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, { live: true, budget: true });
  await page.getByTestId("live-capacity").click();
  await expect(page.getByTestId("capacity-panel")).toBeVisible();
  const field = page.getByTestId("capacity-replicas-worker");
  await field.fill("1001");
  await field.press("Tab");
  await expect(page.getByTestId("capacity-input-error")).toContainText("Resource lifecycle budget exceeded");
  await page.getByTestId("capacity-close").click();
  await page.getByTestId("live-capacity").click();
  await expect(field).toHaveValue("1000");
  await field.fill("999");
  await field.press("Tab");
  await expect(page.getByTestId("capacity-input-error")).toHaveCount(0);
  await expect(field).toHaveValue("999");
  expectNoErrors(consoleErrors);
});

test("A1: scripted CPU refusal uses the live notice with traffic off and clears on restart", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, { live: true, cpuBudget: true });
  await pauseClock(page);
  await page.getByTestId("live-sim-picker").selectOption("cpu-budget");
  if ((await page.getByTestId("live-play").getAttribute("data-state")) === "paused")
    await page.getByTestId("live-play").click();
  await page.clock.runFor(6000);
  await expect(page.getByTestId("live-notice")).toContainText("New messages are waiting");
  await page.getByTestId("live-restart").click();
  await expect(page.getByTestId("live-notice")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
