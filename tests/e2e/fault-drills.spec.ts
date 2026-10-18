import type { Page } from "@playwright/test";
import { faultDrillFixture } from "../../src/lab/faultDrillFixture";
import {
  test,
  expect,
  gotoLive,
  waitForCameraIdle,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";

const item = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
async function seed(page: Page, diagram = faultDrillFixture()) {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&traffic=0&paused=1");
  await waitForCameraIdle(page);
}
async function faultMenu(page: Page, target: string) {
  await waitForCameraIdle(page);
  await page.getByTestId(target).click({ button: "right" });
  await item(page, "sim.fault").click();
}
const nodeCount = (page: Page, id: string, field: string) =>
  page.getByTestId(`node-badge-${id}`).getAttribute(`data-${field}`).then(Number);

test("boundary Fault takes every member down, greys the boundary, restores it and clears on leaving Live", async ({
  page,
  consoleErrors,
}) => {
  await seed(page);
  await faultMenu(page, "node-worker");
  await item(page, "sim.kill").click();
  await faultMenu(page, "group-label-zone-b");
  await expect(item(page, "sim.boundary-down")).toHaveText("Take down");
  await item(page, "sim.boundary-down").click();
  for (const id of ["worker", "store"])
    await expect(page.getByTestId(`node-badge-${id}`)).toHaveAttribute("data-status", "down");
  await faultMenu(page, "node-worker");
  await expect(item(page, "sim.kill")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "sim.kill")).toContainText("Restore Zone b first.");
  await page.keyboard.press("Escape");
  const boundary = page.getByTestId("group-zone-b");
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("grayscale(1)");
  await faultMenu(page, "group-label-zone-b");
  await expect(item(page, "sim.boundary-down")).toHaveText("Restore");
  await item(page, "sim.boundary-down").click();
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-status", "down");
  await expect(page.getByTestId("node-badge-store")).toHaveAttribute("data-status", "up");
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  await faultMenu(page, "node-worker");
  await expect(item(page, "sim.kill")).not.toHaveAttribute("aria-disabled", "true");
  await item(page, "sim.kill").click();
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-status", "up");
  await faultMenu(page, "group-label-zone-b");
  await item(page, "sim.boundary-down").click();
  await page.getByTestId("live-toggle").click();
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  expectNoErrors(consoleErrors);
});

test("node Fault applies slowdown and failures, keeps them checked, and clears overlays without saving props", async ({
  page,
}) => {
  await seed(page);
  await faultMenu(page, "node-worker");
  await item(page, "sim.slow").click();
  await item(page, "sim.slow:10").click();
  await faultMenu(page, "node-worker");
  await item(page, "sim.slow").click();
  await expect(item(page, "sim.slow:10")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await faultMenu(page, "node-worker");
  await item(page, "sim.failure").click();
  await item(page, "sim.failure:0.5").click();
  await faultMenu(page, "node-worker");
  await item(page, "sim.failure").click();
  await expect(item(page, "sim.failure:0.5")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await faultMenu(page, "node-worker");
  await item(page, "sim.clear-faults").click();
  expect((await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props).toMatchObject({
    latencyMs: 100,
    failureRate: 0,
  });
});

test("Cut link fails pushed Requests, retains broker deliveries and restores the link", async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await pauseClock(page);
  await faultMenu(page, "edge-label-request");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("node-caller").click({ button: "right" });
  await item(page, "sim.inject").click();
  await item(page, "sim.inject:10").click();
  await expect.poll(() => nodeCount(page, "worker", "dropped")).toBe(10);
  await faultMenu(page, "edge-label-delivery");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("node-queue").click({ button: "right" });
  await item(page, "sim.inject").click();
  await item(page, "sim.inject:10").click();
  await expect.poll(() => nodeCount(page, "queue", "backlog")).toBe(10);
  // Playback advances only through explicit steps, independent of the machine's frame rate.
  await faultMenu(page, "edge-label-delivery");
  await expect(item(page, "sim.cut-link")).toHaveText("Restore link");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-step").click();
  await expect.poll(() => nodeCount(page, "worker", "processed")).toBe(10);
});

test("Add step offers all four named drill presets with editable targets and persists the fault timeline", async ({
  page,
}) => {
  const diagram = faultDrillFixture();
  const worker = diagram.nodes.find((node) => node.id === "worker");
  if (!worker) throw new Error("The fault drill fixture has no worker node");
  worker.stencil = "nginx";
  await seed(page, diagram);
  await page.getByTestId("node-worker").click({ button: "right" });
  await item(page, "sim.storm").click();
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  const presets = ["zone-outage", "region-connectivity", "slow-dependency", "error-spike"];
  for (const [i, preset] of presets.entries()) {
    await page.getByTestId("sim-panel-add-step").selectOption(preset);
    await expect(page.getByTestId(`sim-panel-step-${i + 1}-action`)).toHaveValue("fault");
    await expect(page.getByTestId(`sim-panel-step-${i + 1}-fault-target`)).toHaveAccessibleName("Target");
    if (preset === "slow-dependency" || preset === "error-spike")
      await expect(page.getByTestId(`sim-panel-step-${i + 1}-fault-target`)).toHaveValue("worker");
  }
  await page.getByTestId("sim-panel-step-1-fault-target").selectOption("zone-b");
  await page.getByTestId("sim-panel-step-2-fault-target").selectOption("request");
  await page.getByTestId("sim-panel-save").click();
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.at(-1)?.timeline?.map((s) => s.action.do))
    .toEqual(["note", "fault", "fault", "fault", "fault"]);
});

test("Zone outage drill shifts traffic by 5 s without loss; the second simulation visibly loses requests", async ({
  page,
}) => {
  await gotoLive(page, "./?view=canvas&example=zone-outage-drill&sim=health-checks&paused=1");
  const seek = page.getByTestId("live-timeline-input");
  await seek.fill("560");
  await seek.press("ArrowRight");
  await expect(page.getByTestId("node-badge-api-b")).toHaveAttribute("data-status", "down");
  await expect
    .poll(() => page.getByTestId("group-zone-b").evaluate((el) => getComputedStyle(el).filter))
    .toBe("grayscale(1)");
  expect(await nodeCount(page, "api-b", "dropped")).toBe(0);
  await expect(page.getByTestId("node-loss-api-b")).toHaveCount(0);
  expect(await nodeCount(page, "api-a", "processed")).toBeGreaterThan(await nodeCount(page, "api-b", "processed"));
  await page.getByTestId("live-sim-picker").selectOption("no-health-checks");
  await seek.fill("560");
  await seek.press("ArrowRight");
  await expect.poll(() => nodeCount(page, "api-b", "dropped")).toBeGreaterThan(0);
  await expect(page.getByTestId("node-loss-api-b")).toBeVisible();
  await expect(page.getByTestId("trouble-action")).toBeDisabled();
  await expect(page.getByTestId("trouble-action")).toHaveAttribute("title", "Restore Zone b first.");
  await expect(page.getByTestId("node-loss-api-b")).toHaveAttribute("title", /messages? dropped/);
  await expect
    .poll(() => page.getByTestId("group-zone-b").evaluate((el) => getComputedStyle(el).filter))
    .toBe("grayscale(1)");
  await page.screenshot({ path: test.info().outputPath("zone-outage.png") });
});
