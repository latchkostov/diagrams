import { test, expect, gotoCanvas, STORAGE_KEYS, waitForCameraIdle, waitForInteractionIdle } from "./fixtures";
import { command, focus, node, activate } from "./keyboard-tutorial-driver";
import { chooseNativeSelect } from "./native-select";
import { zoomIdentity } from "./node-identity";
import { keyboardSelectionFixture } from "../../src/lab/keyboardSelectionFixture";
import type { Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram: keyboardSelectionFixture,
  });
  await gotoCanvas(page, "kafka-order-pipeline");
}
async function pick(page: Page, end: "from" | "to", value: string) {
  await focus(page, `selection-area-${end}`);
  await chooseNativeSelect(page, `selection-area-${end}`, value);
  await expect(page.getByTestId(`selection-area-${end}`)).toHaveValue(value);
}
const selected = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);

for (const step of ["next", "prev"] as const)
  test(`empty selection ${step} starts at the roving destination from the collapsed Inspector menu`, async ({
    page,
  }) => {
    await fixture(page);
    await node(page, "worker");
    await command(page, "action:remove-selection:node:worker", "Remove selection Worker");
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await expect(selected(page, "worker")).not.toHaveClass(/\bselected\b/);
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    await page.getByTestId("inspector-selection-actions").click();
    await focus(page, "context-menu-item-selection.select");
    await page.keyboard.press("ArrowRight");
    await focus(page, "context-menu-item-selection.extend");
    await page.keyboard.press("ArrowRight");
    await focus(page, `context-menu-item-extend:${step}`);
    await page.keyboard.press("Enter");
    await expect(selected(page, "worker")).toBeFocused();
    await expect(selected(page, "worker")).toHaveClass(/\bselected\b/);
    await expect(selected(page, "orders")).not.toHaveClass(/\bselected\b/);
    await expect(page.getByTestId("canvas-announce")).toContainText("Worker added. 1 selected.");
  });

test("extension reveals the destination at 100% when the combined selection exceeds the pane", async ({ page }) => {
  const diagram = structuredClone(keyboardSelectionFixture);
  diagram.nodes.push({ id: "far", label: "Far service", stencil: "service.node", x: 3200, y: 200 });
  diagram.edges.push({ id: "worker-far", from: "worker", to: "far" });
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram,
  });
  await gotoCanvas(page, "kafka-order-pipeline");
  await node(page, "orders");
  await zoomIdentity(page, 1);
  await command(page, "action:extend:node:far", "Extend selection Far service");
  await expect(selected(page, "far")).toBeFocused();
  await waitForCameraIdle(page);
  for (const id of ["orders", "far"]) await expect(selected(page, id)).toHaveClass(/\bselected\b/);
  const pane = await page.getByTestId("canvas-wrap").boundingBox();
  const origin = await selected(page, "orders").boundingBox();
  const destination = await selected(page, "far").boundingBox();
  if (!pane || !origin || !destination) throw new Error("Missing selection bounds");
  expect(destination.x + destination.width - origin.x).toBeGreaterThan(pane.width);
  expect(destination.x).toBeGreaterThanOrEqual(pane.x);
  expect(destination.x + destination.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(destination.y).toBeGreaterThanOrEqual(pane.y);
  expect(destination.y + destination.height).toBeLessThanOrEqual(pane.y + pane.height);
  await expect(page.getByTestId("zoom-100")).toHaveText("100%");
});

test("Shift extends node and edge navigation; unshifted navigation still replaces the selection", async ({ page }) => {
  await fixture(page);
  await node(page, "orders");
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  // eslint-disable-next-line no-restricted-syntax -- The existing navigation family uses literal Control on every platform.
  await page.keyboard.press("Control+Alt+Shift+ArrowRight");
  await expect(selected(page, "worker")).toBeFocused();
  for (const id of ["orders", "worker"]) await expect(selected(page, id)).toHaveClass(/\bselected\b/);
  await expect(page.getByTestId("edge-orders-worker")).not.toHaveClass(/is-selected/);
  await expect(page.getByTestId("canvas-announce")).toContainText("Worker added. 2 selected.");
  // eslint-disable-next-line no-restricted-syntax -- Literal Control is the navigation modifier, including on macOS.
  await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
  await expect(selected(page, "orders")).toBeFocused();
  await expect(page.getByTestId("canvas-announce")).toContainText("2 selected");
  // eslint-disable-next-line no-restricted-syntax -- Extends the existing literal-Control connection shortcut.
  await page.keyboard.press("Control+Alt+Shift+]");
  await expect(page.getByTestId("relationship-wrapper-orders-worker")).toBeFocused();
  await expect(page.getByTestId("canvas-announce")).toContainText("3 selected.");
  for (const id of ["orders", "worker"]) await expect(selected(page, id)).toHaveClass(/\bselected\b/);
  // eslint-disable-next-line no-restricted-syntax -- Preserve the existing unshifted literal-Control shortcut.
  await page.keyboard.press("Control+Alt+]");
  for (const id of ["orders", "worker"]) await expect(selected(page, id)).not.toHaveClass(/\bselected\b/);
  await expect(page.getByTestId("edge-orders-worker")).toHaveClass(/is-selected/);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("searchable extension and selected-only removal return focus to the next selection or canvas", async ({
  page,
}) => {
  await fixture(page);
  await node(page, "orders");
  await command(page, "action:extend:node:worker", "Extend selection Worker");
  await expect(selected(page, "worker")).toBeFocused();
  await page.getByTestId("inspector-selection-actions").click();
  await focus(page, "context-menu-item-selection.select");
  await page.keyboard.press("ArrowRight");
  await focus(page, "context-menu-item-selection.remove");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("context-menu-item-remove-selection:node:audit")).toHaveCount(0);
  await focus(page, "context-menu-item-remove-selection:node:worker");
  await page.keyboard.press("Enter");
  await expect(selected(page, "orders")).toBeFocused();
  await expect(page.getByTestId("canvas-announce")).toHaveText("Worker removed. 1 selected.");
  await command(page, "action:remove-selection:node:orders", "Remove selection Orders");
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await expect(page.getByTestId("canvas-announce")).toHaveText("Orders API removed. 0 selected.");
  await page.getByTestId("inspector-selection-actions").click();
  await expect(page.getByTestId("context-menu-item-selection.select")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-selection-actions")).toBeFocused();
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
  await expect(page.getByTestId("inspector-selection-actions")).toBeVisible();
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("area preview uses full bounds and does not select until applied; Escape restores the selection", async ({
  page,
}) => {
  await fixture(page);
  await node(page, "orders");
  await command(page, "action:selection.area", "Inside this area");
  await expect(page.getByTestId("selection-area-from")).toHaveValue("orders");
  await expect(page.getByTestId("selection-area-to")).toHaveValue("orders");
  await expect(page.getByTestId("selection-area-wholly")).toBeChecked();
  await expect(page.getByTestId("selection-area-add")).not.toBeChecked();
  await pick(page, "to", "worker");
  await expect(page.getByTestId("selection-area-outline")).toBeVisible();
  expect(
    await page
      .getByTestId("selection-area")
      .evaluate((el) => el.parentElement && getComputedStyle(el.parentElement).backdropFilter),
  ).toBe("none");
  await expect(page.getByTestId("selection-area-preview")).toHaveText("3 selected");
  await expect(selected(page, "worker")).not.toHaveClass(/\bselected\b/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-area")).toHaveCount(0);
  await expect(page.getByTestId("selection-area-outline")).toHaveCount(0);
  await expect(selected(page, "orders")).toBeFocused();
  await expect(selected(page, "worker")).not.toHaveClass(/\bselected\b/);
  await command(page, "action:selection.area", "Inside this area");
  await pick(page, "to", "worker");
  await activate(page, "selection-area-wholly");
  await expect(page.getByTestId("selection-area-preview")).toHaveText("4 selected");
  await activate(page, "selection-area-select");
  await expect(selected(page, "orders")).toBeFocused();
  await expect(selected(page, "partial-note")).toHaveClass(/\bselected\b/);
  await expect(page.getByTestId("edge-orders-worker")).toHaveClass(/is-selected/);
  await expect(page.getByTestId("canvas-announce")).toHaveText("4 selected");
  await waitForInteractionIdle(page);
  await waitForCameraIdle(page);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("Add to selection unions the area with existing items before inferring connections", async ({ page }) => {
  await fixture(page);
  await node(page, "audit");
  await command(page, "action:selection.area", "Inside this area");
  await pick(page, "from", "orders");
  await pick(page, "to", "worker");
  await activate(page, "selection-area-add");
  await expect(page.getByTestId("selection-area-preview")).toHaveText("4 selected");
  await activate(page, "selection-area-select");
  for (const id of ["audit", "orders", "worker"]) await expect(selected(page, id)).toHaveClass(/\bselected\b/);
  await expect(selected(page, "partial-note")).not.toHaveClass(/\bselected\b/);
  await expect(page.getByTestId("edge-orders-worker")).toHaveClass(/is-selected/);
  await expect(selected(page, "orders")).toBeFocused();
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});
