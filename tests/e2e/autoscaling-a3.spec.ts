import { openInspectorLiveDetails } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { cloudFixture } from "../../src/lab/cloudFixture";
import type { CloudPreset } from "../../src/model/autoscaling";
import type { DiagramFile } from "../../src/model/types";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  savedDiagram,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";

// A3 cloud adapters in the inspector, the Cloud Run showcase's playback with scenario sizing, and the sizing fix
// in Checks. Selectors are data-testid only; time is the page clock.

const slug = "cloud-run-timetable-api";
async function seed(page: Page, d: DiagramFile, { dark = false, locale = "en" } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(
    ({ key, d, locale }) => {
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true }));
    },
    { key: STORAGE_KEYS.autosavePrefix + slug, d, locale },
  );
  await gotoCanvas(page, slug);
  await waitForStableViewport(page);
  await page.getByTestId("node-worker").click();
}
/** The platform's service, its policy removed: Fixed, ready for a preset. */
function fixed(preset: CloudPreset): DiagramFile {
  const d = cloudFixture(preset);
  const props = d.nodes.find((n) => n.id === "worker")?.props;
  if (!props) throw new Error("fixture has no worker");
  delete props.autoscaling;
  delete props.resources;
  return d;
}
const policyOf = async (page: Page) =>
  (await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props?.autoscaling as
    { controller: Record<string, unknown> } | undefined;

test("Cloud Run preset: four main fields, pinned concurrency, keyboard edit and Undo", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, fixed("cloud-run"));
  await page.getByTestId("autoscaling-preset").selectOption("cloud-cloud-run");
  await expect(page.getByTestId("autoscaling-target")).toHaveValue("80");
  await expect(page.getByTestId("autoscaling-min")).toHaveValue("0");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("100");
  expect(await page.getByTestId(/^autoscaling-(preset|target|min|max)$/).count()).toBe(4);
  await expect(page.getByTestId("autoscaling-advanced")).not.toHaveAttribute("open");
  await expect(page.getByTestId("autoscaling-approximate")).toContainText("Cloud Run");
  await expect
    .poll(async () => (await policyOf(page))?.controller)
    .toMatchObject({ kind: "cloudRun", maxReplicas: 100 });
  const max = page.getByTestId("autoscaling-max");
  await max.fill("12");
  await max.press("Tab");
  await expect.poll(async () => (await policyOf(page))?.controller).toMatchObject({ maxReplicas: 12 });
  await page.getByTestId("canvas-view").press("ControlOrMeta+z");
  await expect(max).toHaveValue("100");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-concurrencyTarget")).toHaveValue("60");
  await expect(page.getByTestId("autoscaling-source")).toHaveAttribute("href", /cloud\.google\.com/);
  expectNoErrors(consoleErrors);
});

test("ECS ALB preset waits for an explicit load balancer, then focuses the target", async ({ page, consoleErrors }) => {
  const d = fixed("ecs-alb");
  d.nodes.push({ id: "lb2", stencil: "aws.elb", label: "Internal ALB", x: 260, y: 420, props: {} });
  d.edges.push({ id: "internal", from: "lb2", to: "worker", kind: "sync", props: { travelMs: 10 } });
  await seed(page, d);
  await page.getByTestId("autoscaling-preset").selectOption("cloud-ecs-alb");
  await expect(page.getByTestId("autoscaling-binding")).toBeVisible();
  expect(await policyOf(page)).toBeUndefined();
  await page.getByTestId("autoscaling-source-select").selectOption("lb2");
  await expect(page.getByTestId("autoscaling-target")).toHaveValue("1000");
  await expect(page.getByTestId("autoscaling-target")).toBeFocused();
  await expect(page.getByTestId("autoscaling-binding-hint")).toContainText("Internal ALB");
  await expect
    .poll(async () => (await policyOf(page))?.controller)
    .toMatchObject({ kind: "ecs", targetTracking: [{ metric: "albRequestCountPerTarget", source: { node: "lb2" } }] });
  expectNoErrors(consoleErrors);
});

for (const [preset, option, dark] of [
  ["ecs-cpu", "cloud-ecs-cpu", false],
  ["aca-http", "cloud-aca-http", false],
  ["app-service", "cloud-app-service", false],
  ["cloud-run", "cloud-cloud-run", true],
] as const) {
  test(`A3: ${preset} inspector fits at 1280×800 and is accessible${dark ? " in dark" : ""}`, async ({
    page,
  }, info) => {
    await seed(page, cloudFixture(preset), { dark });
    await expect(page.getByTestId("autoscaling-preset")).toHaveValue(option);
    await expect(page.getByTestId("autoscaling-target")).toBeVisible();
    const body = page.getByTestId("inspector-body");
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByTestId("autoscaling-advanced-toggle").click();
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="autoscaling-controls"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.getByTestId("autoscaling-advanced-toggle").click();
    await page.getByTestId("autoscaling-controls").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`a3-${preset}-inspector${dark ? "-dark" : ""}.png`) });
  });
}

test("A3: Arabic Advanced policy keeps JSON left to right and the inspector fits", async ({ page }) => {
  await seed(page, cloudFixture("aca-http"), { locale: "ar" });
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-policy")).toHaveAttribute("dir", "ltr");
  expect(await page.getByTestId("inspector-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("Cloud Run showcase: sleeps, wakes on demand, hits its maximum with scenario sizing, returns to zero", async ({
  page,
  consoleErrors,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install();
  await gotoLive(page, `./?view=canvas&example=${slug}&live=1&sim=morning-rush&paused=1`);
  await pauseClock(page);
  const badge = page.getByTestId("node-badge-worker");
  await expect(badge).toHaveAttribute("data-ready", "0");
  await expect(badge).toHaveAttribute("data-desired", "0");
  await page.getByTestId("live-play").click();
  await page.clock.runFor(5500);
  // The first requests wait while instances start on demand: nothing ready yet.
  await expect.poll(async () => Number(await badge.getAttribute("data-starting"))).toBeGreaterThan(0);
  await expect(badge).toHaveAttribute("data-ready", "0");
  await page.clock.runFor(15_500);
  await expect(badge).toHaveAttribute("data-desired", "6");
  await page.getByTestId("live-play").click();
  await page.getByTestId("node-worker").dblclick();
  await openInspectorLiveDetails(page, "resources");
  // Playback shows the planner's own verified suggestion, the same words Checks uses.
  await openInspectorLiveDetails(page, "scaling");
  await expect(page.getByTestId("autoscaling-plan-text")).toContainText("Raise the maximum to 11");
  await openInspectorLiveDetails(page, "resources");
  await page.getByTestId("autoscaling-why-toggle").click();
  await expect(page.getByTestId("autoscaling-reason")).toBeVisible();
  await expect(page.getByTestId("autoscaling-metric")).toContainText("CPU");
  await page.getByTestId("fit-view-button").click();
  await page.clock.runFor(500);
  await waitForStableViewport(page);
  await page.screenshot({ path: info.outputPath("a3-cloud-run-live.png") });
  await page.getByTestId("live-play").click();
  // Idle retention ends at about 52 simulated seconds; advance the page clock until playback gets there.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(5000);
        return [await badge.getAttribute("data-desired"), await badge.getAttribute("data-ready")];
      },
      { timeout: 120_000 },
    )
    .toEqual(["0", "0"]);
  expectNoErrors(consoleErrors);
});

test("Checks: the scenario sizing fix raises the maximum in one undo step", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoCanvas(page, slug);
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning", {
    timeout: 30_000,
  });
  await page.getByTestId("checks-count").click();
  const fix = page.getByTestId("check-fix-capacity:worker");
  await expect(fix).toHaveText(/Raise maximum to 11/);
  await fix.click();
  await expect.poll(async () => (await policyOf(page))?.controller).toMatchObject({ maxReplicas: 11 });
  await expect(page.getByTestId("checks-warning-badge")).toHaveCount(0);
  await page.getByTestId("check-fix-undo").click();
  await expect.poll(async () => (await policyOf(page))?.controller).toMatchObject({ maxReplicas: 6 });
  expectNoErrors(consoleErrors);
});

test("Container Apps event preset: an explicit Service Bus choice focuses the target", async ({
  page,
  consoleErrors,
}) => {
  const d = fixed("aca-event");
  d.nodes.push({ id: "queue2", stencil: "azure.service-bus.queue", label: "Refund jobs", x: 80, y: 420, props: {} });
  d.edges.push({ id: "consume2", from: "queue2", to: "worker", kind: "async", props: { travelMs: 10 } });
  await seed(page, d);
  await page.getByTestId("autoscaling-preset").selectOption("cloud-aca-event");
  await expect(page.getByTestId("autoscaling-binding")).toContainText("Service Bus queue");
  expect(await policyOf(page)).toBeUndefined();
  await page.getByTestId("autoscaling-source-select").selectOption(JSON.stringify(["queue2", undefined]));
  await expect(page.getByTestId("autoscaling-target")).toBeFocused();
  await expect(page.getByTestId("autoscaling-target")).toHaveValue("5");
  await expect
    .poll(async () => (await policyOf(page))?.controller)
    .toMatchObject({ kind: "aca", triggers: [{ type: "azure-servicebus", source: { node: "queue2" } }] });
  expectNoErrors(consoleErrors);
});

test("ECS ALB preset without a load balancer explains how to connect one and saves nothing", async ({ page }) => {
  const d = fixed("ecs-alb");
  d.edges = d.edges.filter((e) => e.id !== "requests");
  await seed(page, d);
  await page.getByTestId("autoscaling-preset").selectOption("cloud-ecs-alb");
  await expect(page.getByTestId("autoscaling-binding")).toContainText("Connect a load balancer");
  await expect(page.getByTestId("autoscaling-source-select")).toBeDisabled();
  expect(await policyOf(page)).toBeUndefined();
});

test("Checks and live playback show the same scenario sizing sentence", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoCanvas(page, slug);
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("1 warning", {
    timeout: 30_000,
  });
  await page.getByTestId("checks-count").click();
  const checks = (await page.getByTestId("check-select-capacity:worker").textContent()) ?? "";
  await page.clock.install();
  await gotoLive(page, `./?view=canvas&example=${slug}&live=1&sim=morning-rush&paused=1`);
  await pauseClock(page);
  await page.getByTestId("node-worker").dblclick();
  await openInspectorLiveDetails(page, "resources");
  await openInspectorLiveDetails(page, "scaling");
  const live = page.getByTestId("autoscaling-plan-text");
  await expect(live).toContainText("Raise the maximum to 11");
  expect(checks).toContain((await live.textContent()) ?? "missing");
});

test("Terraform import: cloud scaling policies arrive executable, with the report saying so", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true })),
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.json",
    mimeType: "application/json",
    buffer: readFileSync("tests/fixtures/imports/terraform/autoscaling-a3.json"),
  });
  await page.getByTestId("toast-import-details").click();
  const report = page.getByTestId("import-report");
  await expect(report).toContainText("Executable Cloud Run policy imported");
  await expect(report).toContainText("Executable ECS policy imported");
  await page.getByTestId("import-report-done").click();
  const d = await savedDiagram(page);
  const policy = (label: string) =>
    (d.nodes.find((n) => n.label === label)?.props?.autoscaling as { mode?: string; controller?: { kind?: string } })
      ?.controller?.kind;
  expect(policy("checkout")).toBe("cloudRun");
  expect(d.planning).toEqual({ revision: "p3-a1" });
  expectNoErrors(consoleErrors);
});
