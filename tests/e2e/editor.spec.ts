import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Editor UX: context menus, keyboard, undo / redo, clipboard, inspector, arrange.
// Selectors are data-testid only. Uses the Kafka example (ids from src/examples/kafka-order-pipeline.json).

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** A point on the empty pane: top-centre of the canvas (fit view keeps ~150px clear there). */
async function emptySpot(page: Page, dx = 0) {
  const box = (await page.getByTestId("canvas-wrap").boundingBox())!;
  return { x: box.width / 2 + dx, y: 90 };
}

async function openCanvasMenu(page: Page, dx = 0) {
  await page.getByTestId("canvas-wrap").click({ button: "right", position: await emptySpot(page, dx) });
  await expect(page.getByTestId("context-menu")).toBeVisible();
}

async function clickEmpty(page: Page) {
  await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page) });
}

const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

test.describe("editor", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
  });

  test("right-click shows the app menu for canvas, node and edge (browser menu suppressed)", async ({ page, consoleErrors }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __prevented: boolean[] };
      w.__prevented = [];
      window.addEventListener("contextmenu", (e) => w.__prevented.push(e.defaultPrevented));
    });
    const prevented = () => page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);

    await openCanvasMenu(page);
    await expect(menuItem(page, "canvas.add-node")).toBeVisible();
    await expect(menuItem(page, "canvas.fit")).toBeVisible();
    await expect(menuItem(page, "node.rename")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);

    await page.getByTestId("node-payments").click({ button: "right" });
    await expect(menuItem(page, "node.rename")).toBeVisible();
    await expect(menuItem(page, "item.delete")).toBeVisible();
    await expect(menuItem(page, "canvas.add-node")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Edge labels open the edge menu too (a straight edge's <g> has no height to click).
    await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
    await expect(menuItem(page, "edge.toggle-kind")).toBeVisible();
    await expect(menuItem(page, "edge.from-side")).toBeVisible();

    // The Simulation section stays hidden until the sim UI registers actions.
    await expect(page.getByTestId("context-menu")).not.toContainText("Simulation");
    // Outside click closes it.
    await clickEmpty(page);
    await expect(page.getByTestId("context-menu")).toHaveCount(0);

    expect(await prevented()).toEqual([true, true, true]);
    expectNoErrors(consoleErrors);
  });

  test("menu keyboard navigation: arrows skip disabled items, → opens a searchable submenu", async ({ page }) => {
    await openCanvasMenu(page);
    await page.keyboard.press("ArrowDown");
    await expect(menuItem(page, "canvas.add-node")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowDown");
    // "Paste here" is disabled with an empty clipboard, so it is skipped.
    await expect(menuItem(page, "canvas.paste")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "canvas.select-all")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("context-menu-sub")).toBeVisible();
    await expect(page.getByTestId("context-menu-sub-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await expect(menuItem(page, "add-node:kafka.topic")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
    await expect(page.getByTestId("node-topic-1")).toBeVisible();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("Kafka Topic");

    // Esc closes a submenu first, then the menu. (Open away from the node just added.)
    await openCanvasMenu(page, 250);
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("context-menu-sub")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu-sub")).toHaveCount(0);
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
  });

  test("rename a node from its context menu", async ({ page }) => {
    await page.getByTestId("node-payments").click({ button: "right" });
    await menuItem(page, "node.rename").click();
    const input = page.getByTestId("node-editor-label");
    await expect(input).toBeFocused();
    await input.fill("Payments API");
    await input.press("Enter");
    await expect(page.getByTestId("node-payments")).toContainText("Payments API");
  });

  test("delete, undo and redo (keyboard and buttons)", async ({ page }) => {
    await page.getByTestId("node-payments").click({ button: "right" });
    await menuItem(page, "item.delete").click();
    await expect(page.getByTestId("node-payments")).toHaveCount(0);
    await expect(page.getByTestId("edge-order-events-to-payments")).toHaveCount(0);

    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await expect(page.getByTestId("edge-order-events-to-payments")).toBeAttached();

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(page.getByTestId("node-payments")).toHaveCount(0);

    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await page.getByTestId("redo-button").click();
    await expect(page.getByTestId("node-payments")).toHaveCount(0);

    // Delete key on a selection, then undo.
    await page.getByTestId("node-inventory").click();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("node-inventory")).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-inventory")).toBeVisible();
  });

  test("copy / paste keeps edges between copied nodes and remaps ids", async ({ page }) => {
    await page.getByTestId("node-orders").click();
    await page.getByTestId("node-order-events").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId("node-orders-1")).toBeVisible();
    await expect(page.getByTestId("node-order-events-1")).toBeVisible();
    await expect(page.getByTestId("edge-orders-to-order-events-1")).toBeAttached();
    // Only the edge between the two copied nodes came along.
    await expect(page.getByTestId("edge-gateway-to-orders-1")).toHaveCount(0);
    await expect(page.getByTestId("diagram-card")).toContainText("17 nodes, 16 edges");
    // The pasted copy is the new selection; Ctrl+D duplicates it again.
    await page.keyboard.press(`${MOD}+d`);
    await expect(page.getByTestId("node-orders-2")).toBeVisible();
  });

  test("toggle an edge between async and sync", async ({ page }) => {
    await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
    await expect(menuItem(page, "edge.toggle-kind")).toContainText("Make async");
    await menuItem(page, "edge.toggle-kind").click();
    await expect(page.getByTestId("inspector-field-kind-async")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("edge-shopper-to-gateway")).toHaveAttribute("class", /fe-async/);
    await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
    await expect(menuItem(page, "edge.toggle-kind")).toContainText("Make sync");
    await page.keyboard.press("Escape");
    // Pin a side from the inspector and back to auto.
    await page.getByTestId("inspector-field-sourceSide").selectOption("bottom");
    await expect(page.getByTestId("inspector-field-sourceSide")).toHaveValue("bottom");
    await page.getByTestId("inspector-field-sourceSide").selectOption("");
  });

  test("inspector edits update the node and are undoable", async ({ page }) => {
    await page.getByTestId("node-orders").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await page.getByTestId("inspector-field-label").fill("Order API");
    await expect(page.getByTestId("node-orders")).toContainText("Order API");
    // Simulation fields follow the stencil's role (processor).
    await expect(page.getByTestId("inspector-field-concurrency")).toBeVisible();
    await expect(page.getByTestId("inspector-field-ratePerSec")).toHaveCount(0);
    await page.getByTestId("inspector-field-failureRate").fill("0.2");

    await clickEmpty(page);
    await expect(page.getByTestId("inspector-title")).toHaveText("Diagram");
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-orders")).toContainText("Order service");

    // Diagram fields when nothing is selected.
    await page.getByTestId("inspector-field-title").fill("Renamed pipeline");
    await expect(page.getByTestId("diagram-title")).toHaveText("Renamed pipeline");
  });

  test("align a multi-selection from the menu", async ({ page }) => {
    await page.getByTestId("node-orders").click();
    await page.getByTestId("node-inventory").click({ modifiers: [MOD] });
    await page.getByTestId("node-inventory").click({ button: "right" });
    await expect(menuItem(page, "selection.align")).toBeVisible();
    await menuItem(page, "selection.align").click();
    await menuItem(page, "align:top").click();
    await expect
      .poll(async () => {
        const a = await page.getByTestId("node-orders").boundingBox();
        const b = await page.getByTestId("node-inventory").boundingBox();
        return Math.abs(a!.y - b!.y);
      })
      .toBeLessThan(1);
  });

  test("group a selection into a boundary and rename it", async ({ page }) => {
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("node-gateway").click({ modifiers: [MOD] });
    await page.keyboard.press(`${MOD}+g`);
    const input = page.getByTestId("group-label-input");
    await expect(input).toBeFocused();
    await input.fill("Edge zone");
    await input.press("Enter");
    await expect(page.getByTestId("group-label-boundary-1")).toHaveText("Edge zone");
    await page.getByTestId("group-label-boundary-1").click({ button: "right" });
    await expect(menuItem(page, "group.ungroup")).toBeVisible();
    await menuItem(page, "group.ungroup").click();
    await expect(page.getByTestId("group-boundary-1")).toHaveCount(0);
    await expect(page.getByTestId("node-shopper")).toBeVisible();
  });

  test("double-click the canvas to quick-add, ? opens the shortcuts", async ({ page }) => {
    await page.getByTestId("canvas-wrap").dblclick({ position: await emptySpot(page) });
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await expect(page.getByTestId("quick-add-search")).toBeFocused();
    await page.keyboard.type("postgres");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("node-postgres-1")).toBeVisible();

    await clickEmpty(page);
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
  });

  test("arrow keys nudge the selection", async ({ page }) => {
    const node = page.getByTestId("node-payments");
    await node.click();
    const before = (await node.boundingBox())!;
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    // 20 flow px; on screen that is 20 × zoom.
    await expect.poll(async () => (await node.boundingBox())!.x - before.x).toBeGreaterThan(3);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => Math.abs((await node.boundingBox())!.x - before.x)).toBeLessThan(1);
  });
});
