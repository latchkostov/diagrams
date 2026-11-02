import type { DiagramFile } from "../../src/model/types";
import { zoomIdentity } from "./node-identity";
import { focus, command } from "./keyboard-tutorial-driver";
import { keyboardSelectionFixture, keyboardBoundaryFarFixture } from "../../src/lab/keyboardSelectionFixture";
import { test, expect, gotoCanvas, STORAGE_KEYS, waitForCameraIdle, flowPoint, waitForHistoryIdle } from "./fixtures";
import type { Page } from "@playwright/test";

async function openFixture(page: Page, diagram: DiagramFile = keyboardSelectionFixture) {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram,
  });
  await gotoCanvas(page, "kafka-order-pipeline");
}

async function positions(page: Page) {
  await waitForCameraIdle(page);
  const points = [];
  for (const id of ["orders", "worker", "audit"]) {
    const box = await page.getByTestId(`rf__node-${id}`).boundingBox();
    if (!box) throw new Error("Missing node");
    points.push(await flowPoint(page, box));
  }
  return points.map((p) => ({ x: Math.round(p.x) || 0, y: Math.round(p.y) || 0 }));
}

test("boundary commands move a rigid subset, announce and undo in one step", async ({ page }) => {
  await openFixture(page);
  await page.getByTestId("node-orders").click();
  await page.getByTestId("node-worker").click({ modifiers: ["Shift"] });
  const before = await positions(page);
  await page.getByTestId("rf__node-worker").focus();
  await page.keyboard.press("Shift+F10");
  await focus(page, "context-menu-item-selection.boundary");
  await page.keyboard.press("ArrowRight");
  await focus(page, "context-menu-item-selection.add-to-boundary");
  await page.keyboard.press("ArrowRight");
  await focus(page, "context-menu-item-add-to-boundary:region");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Added 2 nodes to Region A. 2 selected.");
  await expect(page.getByTestId("rf__node-worker")).toBeFocused();
  const inside = await positions(page);
  expect(inside[0].x).toBeGreaterThan(before[0].x);
  expect(inside[1].x - inside[0].x).toBe(before[1].x - before[0].x);
  expect(inside[1].y - inside[0].y).toBe(before[1].y - before[0].y);
  expect(inside[2]).toEqual(before[2]);
  await waitForHistoryIdle(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("canvas-announce")).toContainText("Undone.");
  expect(await positions(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => positions(page)).toEqual(inside);
  await page.getByTestId("inspector-selection-actions").click();
  await focus(page, "context-menu-item-selection.remove-from-boundary");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Removed 2 nodes from boundaries. 2 selected.");
  await expect(page.getByTestId("inspector-selection-actions")).toBeFocused();
  await page.getByTestId("node-orders").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("");
});

test("Ctrl+K finds boundary adoption and removal without new shortcuts", async ({ page }) => {
  await openFixture(page);
  await page.getByTestId("node-orders").click();
  await command(page, "action:add-to-boundary:region", "Add to boundary");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Added 1 node to Region A. 1 selected.");
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("region");
  await command(page, "action:selection.remove-from-boundary", "Remove from boundary");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Removed 1 node from boundaries. 1 selected.");
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("");
});

test("a far transfer reveals the invocation's focused node in a mixed selection at 100%", async ({ page }) => {
  await openFixture(page, keyboardBoundaryFarFixture);
  await page.getByTestId("group-label-source").click();
  await page.getByTestId("node-orders").click({ modifiers: ["Shift"] });
  await page.getByTestId("node-worker").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
  const focused = page.getByTestId("rf__node-worker");
  await focused.focus();
  await zoomIdentity(page, 1);
  await page.keyboard.press("Shift+F10");
  await focus(page, "context-menu-item-selection.boundary");
  await page.keyboard.press("ArrowRight");
  await focus(page, "context-menu-item-selection.add-to-boundary");
  await page.keyboard.press("ArrowRight");
  await focus(page, "context-menu-item-add-to-boundary:region");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Added 2 nodes to Far region. 3 selected.");
  await expect(focused).toBeFocused();
  await waitForCameraIdle(page);
  const node = await focused.boundingBox();
  const canvas = await page.getByTestId("canvas-wrap").boundingBox();
  const inspector = await page.getByTestId("inspector").boundingBox();
  if (!node || !canvas || !inspector) throw new Error("Missing transfer geometry");
  expect(node.x).toBeGreaterThanOrEqual(canvas.x);
  expect(node.y).toBeGreaterThanOrEqual(canvas.y);
  expect(node.x + node.width).toBeLessThanOrEqual(inspector.x);
  expect(node.y + node.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  expect(node.width).toBeCloseTo(220, 0);
  await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
  await page.getByTestId("inspector-selection-actions").click();
  await focus(page, "context-menu-item-selection.remove-from-boundary");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Removed 2 nodes from boundaries. 3 selected.");
  await expect(page.getByTestId("inspector-selection-actions")).toBeFocused();
});
