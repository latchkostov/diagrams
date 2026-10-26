import { planningFixture } from "../../src/lab/planningFixture";
import { newPlanningProps } from "../../src/model/planning";
import { deviceValues } from "../../src/model/planningPresets";
import {
  test,
  expect,
  gotoLive,
  waitForStableViewport,
  STORAGE_KEYS,
  expectNoErrors,
  openEditProperties,
} from "./fixtures";

test("P1 inspector follows live inputs at sampling scale and applies the shared fix", async ({
  page,
  consoleErrors,
}) => {
  const slug = "kafka-order-pipeline";
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + slug,
    JSON.stringify(planningFixture()),
  ] as const);
  await gotoLive(page, `./?view=canvas&example=${slug}&live=1`);
  await waitForStableViewport(page);
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("scale-override").selectOption("50");
  await page.getByTestId("capacity-rate-checkout").fill("6");
  await page.getByTestId("capacity-rate-checkout").press("Enter");
  await page.getByTestId("capacity-close").click();
  await page.getByTestId("node-orders").click({ button: "right" });
  await page.getByTestId("context-menu-item-node.properties").click();
  await openEditProperties(page);
  await page.getByTestId("inspector-section-node-simulation").click();
  const x = page.getByTestId("inspector").getByTestId("planning-explanation-orders");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("receives 6 req/s");
  await expect(x.getByTestId("planning-target")).toContainText("12 replicas at the 50% target");
  await expect(page.getByTestId("inspector").getByTestId("planning-connections")).not.toContainText("Retry:");
  await x.getByTestId("planning-apply").focus();
  await page.keyboard.press("Enter");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("12 replicas × 4 slots");
  await expect(x.getByTestId("planning-arithmetic")).toContainText("receives 6 req/s");
  await page.getByTestId("undo-button").click();
  await expect(x.getByTestId("planning-arithmetic")).toContainText("1 replica × 4 slots");
  await page.getByTestId("node-checkout").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await page.getByTestId("node-orders").click({ button: "right" });
  await page.getByTestId("context-menu-item-node.properties").click();
  await openEditProperties(page);
  await expect(x.getByTestId("planning-apply")).toBeDisabled();
  await expect(x).toContainText("Exit slow motion (Esc) first");
  // Properties focuses its label input, which keeps Escape. Collapse it and move focus
  // to the canvas before backing out of the selection and then replay.
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await page.getByTestId("node-orders").focus();
  await page.keyboard.press("Escape");
  await page.getByTestId("live-play").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-play")).not.toHaveAttribute("data-state", "slowmo");
  await page.getByTestId("node-orders").click({ button: "right" });
  await page.getByTestId("context-menu-item-node.properties").click();
  await openEditProperties(page);
  await expect(x.getByTestId("planning-apply")).toBeEnabled();
  expectNoErrors(consoleErrors);
});

test("P1 inspector changes a pinned device size as one preset choice", async ({ page, consoleErrors }) => {
  const slug = "kafka-order-pipeline";
  const d = planningFixture();
  d.format = "diagrams/v2";
  d.planning = { revision: "p1" };
  d.nodes.push({
    id: "device",
    stencil: "f5.bigip",
    label: "F5",
    x: 320,
    y: 420,
    props: newPlanningProps("gateway", d.planning, "f5.bigip"),
  });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + slug,
    JSON.stringify(d),
  ] as const);
  await page.goto(`./?view=canvas&example=${slug}`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await waitForStableViewport(page);
  await page.getByTestId("node-device").click();
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("inspector-field-size").selectOption("branch");
  await expect(page.getByTestId("inspector-field-gbps")).toHaveValue(String(deviceValues("f5.bigip", "branch")?.gbps));
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("inspector-field-gbps")).toHaveValue(String(deviceValues("f5.bigip", "campus")?.gbps));
  expectNoErrors(consoleErrors);
});
