import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
async function seed(page: Page, { fixed = false, dark = false, locale = "en", multiple = false } = {}) {
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
  await page.getByTestId("canvas-view").press("Control+z");
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
  await page.getByTestId("autoscaling-use-lesson").click();
  await expect(page.getByTestId("autoscaling-cpuMsPerMessage")).toHaveValue("40");
  await expect(page.getByTestId("autoscaling-cpuRequestMilli")).toHaveValue("500");
  await expect(page.getByTestId("autoscaling-max")).toHaveValue("20");
  expectNoErrors(consoleErrors);
});
