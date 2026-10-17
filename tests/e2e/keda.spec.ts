import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resourceLesson } from "../../src/model/autoscaling";
import { kedaFixture } from "../../src/lab/kedaFixture";
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

const slug = "keda-render-workers";
async function seed(page: Page, { fixed = false, dark = false, locale = "en", multiple = false, budget = false } = {}) {
  const d = kedaFixture();
  if (fixed) {
    const props = d.nodes[1].props;
    if (props) {
      delete props.autoscaling;
      delete props.resources;
    }
  }
  if (multiple) {
    d.nodes.push({ ...d.nodes[0], id: "other-broker", label: "Other requests", y: 440 });
    d.edges.push({ ...d.edges[0], id: "other-consume", from: "other-broker" });
  }
  if (budget) {
    for (const [i, replicas] of [...Array<number>(9).fill(2500), 2425].entries())
      d.nodes.push({
        id: `budget-${i}`,
        stencil: "service.go",
        label: `Pool ${i}`,
        x: -700 + (i % 3) * 260,
        y: Math.floor(i / 3) * 180,
        props: { replicas, resources: resourceLesson() },
      });
  }
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
test("KEDA: preset is four main fields, pins defaults and supports keyboard edits and Undo", async ({
  page,
  consoleErrors,
}) => {
  await seed(page, { fixed: true });
  await page.getByTestId("autoscaling-preset").selectOption("keda-kafka");
  await expect(page.getByTestId("autoscaling-min")).toHaveValue("0");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("100");
  expect(await page.getByTestId(/^autoscaling-(preset|target|min|max)$/).count()).toBe(4);
  await expect(page.getByTestId("autoscaling-advanced")).not.toHaveAttribute("open");
  await expect(page.getByTestId("autoscaling-binding-hint")).toContainText("Render requests");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-polling")).toHaveValue("30000");
  await expect(page.getByTestId("autoscaling-cooldown")).toHaveValue("300000");
  const field = page.getByTestId("autoscaling-polling");
  await field.fill("1000");
  await field.press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props?.autoscaling)
    .toMatchObject({ controller: { pollingMs: 1000 } });
  await page.getByTestId("canvas-view").press("ControlOrMeta+z");
  await expect(field).toHaveValue("30000");
  expectNoErrors(consoleErrors);
});
test("KEDA: multiple sources require an explicit Advanced binding", async ({ page }) => {
  await seed(page, { fixed: true, multiple: true });
  await page.getByTestId("autoscaling-preset").selectOption("keda-kafka");
  await expect(page.getByTestId("autoscaling-binding")).toBeVisible();
  expect((await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props?.autoscaling).toBeUndefined();
  await page.getByTestId("autoscaling-source-select").selectOption(JSON.stringify(["uploads", "renders"]));
  await expect(page.getByTestId("autoscaling-target")).toHaveValue("10");
  await expect(page.getByTestId("autoscaling-target")).toBeFocused();
});
test("KEDA: a refused source binding announces the budget and keeps the pending choice", async ({ page }) => {
  await seed(page, { fixed: true, multiple: true, budget: true });
  await page.getByTestId("autoscaling-preset").selectOption("keda-kafka");
  await page.getByTestId("autoscaling-source-select").selectOption(JSON.stringify(["uploads", "renders"]));
  await expect(page.getByTestId("autoscaling-commit-error")).toContainText("Resource lifecycle budget exceeded");
  await expect(page.getByTestId("autoscaling-binding")).toBeVisible();
  expect((await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props?.autoscaling).toBeUndefined();
});
for (const dark of [false, true]) {
  test(`KEDA: ${dark ? "dark" : "light"} inspector fits and remains accessible`, async ({ page }, info) => {
    await seed(page, { dark });
    await expect(page.getByTestId("autoscaling-target")).toBeVisible();
    const body = page.getByTestId("inspector-body");
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="autoscaling-controls"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.getByTestId("autoscaling-controls").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`keda-inspector-${dark ? "dark" : "light"}.png`) });
  });
}
test("KEDA: Arabic Advanced policy keeps JSON left to right", async ({ page }) => {
  await seed(page, { locale: "ar" });
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-policy")).toHaveAttribute("dir", "ltr");
  expect(await page.getByTestId("inspector-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
test("KEDA: production playback sleeps, wakes with cold start and returns to zero", async ({
  page,
  consoleErrors,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install();
  await gotoLive(page, `./?view=canvas&example=${slug}&live=1&sim=wake-on-burst&paused=1`);
  await pauseClock(page);
  const badge = page.getByTestId("node-badge-worker");
  await expect(badge).toHaveAttribute("data-ready", "0");
  await page.getByTestId("live-play").click();
  await page.clock.runFor(2500);
  await expect(badge).toHaveAttribute("data-starting", "1");
  await expect(badge).toHaveAttribute("data-ready", "0");
  await page.clock.runFor(1100);
  await expect.poll(async () => Number(await badge.getAttribute("data-ready"))).toBeGreaterThan(0);
  await page.getByTestId("node-worker").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("autoscaling-chart")).toBeVisible();
  await page.getByTestId("autoscaling-why-toggle").click();
  await expect(page.getByTestId("autoscaling-broker-metric")).toBeVisible();
  await page.getByTestId("live-play").click();
  await page.getByTestId("fit-view-button").click();
  await page.clock.runFor(500);
  await waitForStableViewport(page);
  await page.screenshot({ path: info.outputPath("keda-live.png") });
  await page.getByTestId("live-play").click();
  await page.clock.runFor(7000);
  await expect(badge).toHaveAttribute("data-ready", "0");
  await expect(badge).toHaveAttribute("data-desired", "0");
  expectNoErrors(consoleErrors);
});
test("KEDA: imports a complete ScaledObject and owned HPA locally", async ({ page, consoleErrors }) => {
  await page.addInitScript(() =>
    localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true })),
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "scaling.yaml",
    mimeType: "application/yaml",
    buffer: readFileSync("tests/fixtures/imports/autoscaling-a2.yaml"),
  });
  await page.getByTestId("toast-import-details").click();
  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-report")).toContainText("Executable KEDA 2.18");
  await page.getByTestId("import-report-done").click();
  await waitForStableViewport(page);
  await page.getByTestId("node-renderer").click();
  await expect(page.getByTestId("autoscaling-min")).toHaveValue("0");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("20");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await page.getByTestId("autoscaling-use-lesson").focus();
  await page.getByTestId("autoscaling-use-lesson").press("Enter");
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).toBeFocused();
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).toHaveValue("40");
  await expect(page.getByTestId("autoscaling-cpuRequestMilli")).toHaveValue("500");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("20");
  await page.getByTestId("autoscaling-preset").selectOption("fixed");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-cpuRequestMilli")).toHaveValue("500");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "renderer")?.props)
    .toMatchObject({ autoscaling: { mode: "off" }, resources: { modelRevision: "a2", cpuRequestMilli: 500 } });
  expectNoErrors(consoleErrors);
});

test("KEDA: an imported fixed Deployment keeps resource editing and the lesson focus target", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("diagrams.inspector.open.v1", JSON.stringify({ "node-simulation": true })),
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "fixed.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(readFileSync("tests/fixtures/imports/autoscaling-a2.yaml", "utf8").split("---")[0]),
  });
  await waitForStableViewport(page);
  await page.getByTestId("node-renderer").click();
  await expect(page.getByTestId("autoscaling-preset")).toHaveValue("fixed");
  await page.getByTestId("autoscaling-advanced-toggle").click();
  await expect(page.getByTestId("autoscaling-cpuRequestMilli")).toHaveValue("500");
  await page.getByTestId("autoscaling-use-lesson").focus();
  await page.getByTestId("autoscaling-use-lesson").press("Enter");
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).toBeFocused();
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).toHaveValue("40");
  await expect(page.getByTestId("autoscaling-cpuRequestMilli")).toHaveValue("500");
  await expect(page.getByTestId("autoscaling-target")).toHaveCount(0);
  await page.getByTestId("autoscaling-cpuMsPerMessage").fill("60");
  await page.getByTestId("autoscaling-cpuMsPerMessage").press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "renderer")?.props?.resources)
    .toMatchObject({ cpuMsPerMessage: 60, cpuRequestMilli: 500 });
  expectNoErrors(consoleErrors);
});

test("KEDA: a large namespace pick includes its scaler source and explains the selected boundaries", async ({
  page,
  consoleErrors,
}) => {
  const yaml = readFileSync("tests/fixtures/imports/autoscaling-a2.yaml", "utf8")
    .replace(
      "name: render-jobs, namespace: studio",
      "name: render-jobs, namespace: brokers, labels: {strimzi.io/cluster: events}",
    )
    .replace(
      "topic: render-jobs",
      "bootstrapServers: events-kafka-bootstrap.brokers.svc.cluster.local:9092\n        topic: render-jobs",
    );
  const filler = Array.from(
    { length: 299 },
    (_, i) => `---
apiVersion: apps/v1
kind: Deployment
metadata: {name: filler-${i}, namespace: studio}
spec: {template: {spec: {containers: [{name: worker, image: example.invalid/worker:1}]}}}
`,
  ).join("\n");
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "namespaces.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(yaml + "\n" + filler),
  });
  await page.getByTestId("toast-import-details").click();
  await expect(page.getByTestId("import-report-pick")).toContainText("Boundaries (1 of 2 selected)");
  await expect(page.getByTestId("import-report-note").filter({ hasText: "included automatically" })).toHaveCount(1);
  await expect(page.getByTestId("import-report-pick-0")).toBeChecked();
  await expect(page.getByTestId("import-report-pick-1")).not.toBeChecked();
  await page.getByTestId("import-report-pick-1").check();
  await expect(page.getByTestId("import-report-pick")).toContainText("Boundaries (2 of 2 selected)");
  await page.getByTestId("import-report-pick-1").uncheck();
  await expect(page.getByTestId("import-report-pick")).toContainText("Boundaries (1 of 2 selected)");
  const d = await savedDiagram(page);
  expect(d.nodes).toHaveLength(301);
  const broker = d.nodes.find((n) => n.label === "render-jobs");
  if (!broker) throw new Error("Imported scaler source is missing");
  expect(d.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).toMatchObject({
    mode: "on",
    controller: { triggers: [{ source: { node: broker.id, group: "renderers" } }] },
  });
  expectNoErrors(consoleErrors);
});
