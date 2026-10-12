import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableBox, waitForStableViewport } from "./fixtures";

// Editor UX: context menus, keyboard, undo / redo, clipboard, inspector, arrange.
// Selectors are data-testid only. Uses the Kafka example (ids from src/examples/kafka-order-pipeline.json).

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** A point on the empty pane: top-centre of the canvas (fit view keeps ~150px clear there). */
async function emptySpot(page: Page, dx = 0) {
  const box = await requiredBox(page.getByTestId("canvas-wrap"));
  return { x: box.width / 2 + dx, y: 90 };
}

async function openCanvasMenu(page: Page, dx = 0) {
  // A refit still under way (a side panel just folded) would close the menu as it moves the view.
  await waitForStableViewport(page);
  await page.getByTestId("canvas-wrap").click({ button: "right", position: await emptySpot(page, dx) });
  await expect(page.getByTestId("context-menu")).toBeVisible();
}

async function clickEmpty(page: Page) {
  await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page) });
}

const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
/** The element's box once it has stopped moving (two equal readings, a frame apart). */
async function settledBox(locator: import("@playwright/test").Locator) {
  await waitForStableBox(locator);
  return requiredBox(locator);
}
const requiredBox = async (locator: import("@playwright/test").Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element");
  return box;
};

test.describe("editor", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
  });

  test("right-click shows the app menu for canvas, node and edge (browser menu suppressed)", async ({
    page,
    consoleErrors,
  }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __prevented: boolean[] };
      w.__prevented = [];
      window.addEventListener("contextmenu", (e) => w.__prevented.push(e.defaultPrevented));
    });
    const prevented = () => page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);

    await openCanvasMenu(page);
    await expect(menuItem(page, "canvas.add-node")).toBeVisible();
    await expect(menuItem(page, "canvas.annotate")).toHaveText(/Annotate/);
    // Fit view is a canvas control and Shift+1 (and in Ctrl+K); the right-click doesn't repeat it.
    await expect(menuItem(page, "canvas.fit")).toHaveCount(0);
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
    await expect(menuItem(page, "edge.relationship")).toBeVisible();
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
    await expect(page.getByTestId("context-menu")).toHaveAttribute(
      "aria-activedescendant",
      (await menuItem(page, "canvas.add-node").getAttribute("id")) ?? "",
    );
    await page.keyboard.press("ArrowDown");
    await expect(menuItem(page, "canvas.annotate")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowDown");
    await expect(menuItem(page, "canvas.ai-panel")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowDown");
    // "Paste here" is disabled with an empty clipboard, so it is skipped.
    await expect(menuItem(page, "canvas.paste")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "canvas.select-all")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(menuItem(page, "canvas.add-node")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("context-menu-sub")).toBeVisible();
    await expect(page.getByTestId("context-menu-sub-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await expect(menuItem(page, "add-node:kafka.topic")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("context-menu-sub-search")).toHaveAttribute(
      "aria-activedescendant",
      (await menuItem(page, "add-node:kafka.topic").getAttribute("id")) ?? "",
    );
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
    await expect(page.getByTestId(/^node-(?!tooltip$|editor-)/)).toHaveCount(17);
    // The pasted copy is the new selection; Ctrl+D duplicates it again.
    await page.keyboard.press(`${MOD}+d`);
    await expect(page.getByTestId("node-orders-2")).toBeVisible();
  });

  test("switch an edge between a request and a message (Relationship ▸)", async ({ page }) => {
    await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
    await menuItem(page, "edge.relationship").click();
    await expect(menuItem(page, "relation:request")).toHaveAttribute("aria-checked", "true");
    await menuItem(page, "relation:message").click();
    await expect(page.getByTestId("edge-shopper-to-gateway")).toHaveAttribute("class", /fe-async/);
    await page.getByTestId("edge-label-shopper-to-gateway").click();
    await expect(page.getByTestId("inspector-field-relation")).toHaveValue("message");
    await page.getByTestId("edge-label-shopper-to-gateway").click({ button: "right" });
    await menuItem(page, "edge.relationship").click();
    await expect(menuItem(page, "relation:message")).toHaveAttribute("aria-checked", "true");
    // A pointer-opened submenu keeps focus on its parent: Escape closes that menu.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
    await expect(page.getByTestId("inspector-field-relation")).toHaveValue("message");
    // Pin a side from the inspector (under "Advanced") and back to auto.
    await page.getByTestId("inspector-section-edge-advanced").click();
    await page.getByTestId("inspector-field-sourceSide").selectOption("bottom");
    await expect(page.getByTestId("inspector-field-sourceSide")).toHaveValue("bottom");
    await page.getByTestId("inspector-field-sourceSide").selectOption("");
  });

  test("inspector edits update the node and are undoable", async ({ page }) => {
    await page.getByTestId("node-orders").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await page.getByTestId("inspector-field-label").fill("Order API");
    await expect(page.getByTestId("node-orders")).toContainText("Order API");
    // Simulation fields sit in a collapsed section and follow the stencil's role (processor).
    await expect(page.getByTestId("inspector-field-concurrency")).toHaveCount(0);
    await page.getByTestId("inspector-section-node-simulation").click();
    await expect(page.getByTestId("inspector-field-concurrency")).toBeVisible();
    await expect(page.getByTestId("inspector-field-ratePerSec")).toHaveCount(0);
    await page.getByTestId("inspector-field-failureRate").fill("0.2");

    // Below 1680px the inspector folds away with the selection, leaving the canvas room.
    await clickEmpty(page);
    await expect(page.getByTestId("inspector-title")).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-orders")).toContainText("Order service");

    // Diagram fields: right-click the canvas, "Diagram properties".
    await openCanvasMenu(page);
    await menuItem(page, "canvas.properties").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Diagram");
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
        const a = await requiredBox(page.getByTestId("node-orders"));
        const b = await requiredBox(page.getByTestId("node-inventory"));
        return Math.abs(a.y - b.y);
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
    // Selecting opens the inspector, which may pan to keep the node in view: measure once it rests.
    const before = await settledBox(node);
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    // 20 flow px; on screen that is 20 × zoom.
    await expect.poll(async () => (await requiredBox(node)).x - before.x).toBeGreaterThan(3);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => Math.abs((await requiredBox(node)).x - before.x)).toBeLessThan(1);
  });

  test("selection shortcuts leave focused inspector and toolbar controls alone", async ({ page }) => {
    const node = page.getByTestId("node-orders");
    await node.click();
    const before = await requiredBox(node);
    for (const id of ["inspector-field-stencil", "inspector-field-group", "theme-toggle"]) {
      await page.getByTestId(id).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Delete");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("inspector-title")).toHaveText("Node");
      await expect(node).toBeVisible();
      expect((await requiredBox(node)).x).toBe(before.x);
    }
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("node-gateway").click({ modifiers: [MOD] });
    await page.keyboard.press(`${MOD}+g`);
    await page.getByTestId("group-label-input").press("Enter");
    const group = page.getByTestId("group-boundary-1");
    const groupBefore = await requiredBox(group);
    const tone = page.getByTestId("inspector-tone-neutral");
    await tone.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    await expect(group).toBeVisible();
    expect((await requiredBox(group)).x).toBe(groupBefore.x);
  });

  test("closing the stencil menu restores its invoking button's focus", async ({ page }) => {
    await page.getByTestId("node-orders").click();
    const button = page.getByTestId("inspector-field-stencil");
    await button.focus();
    await button.press("Enter");
    const search = page.getByTestId("stencil-picker-search");
    await expect(search).toBeFocused();
    await search.fill("kafka");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    const active = page.getByTestId(/^context-menu-item-/).filter({ visible: true });
    const descendant = await search.getAttribute("aria-activedescendant");
    expect(descendant).toBeTruthy();
    expect(
      await active.evaluateAll(
        (items, id) => items.some((item) => item.id === id && item.getAttribute("aria-disabled") !== "true"),
        descendant,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
  });

  test("shortcuts modal contains Tab and Shift+Tab, closes with Escape and restores focus", async ({ page }) => {
    await openCanvasMenu(page);
    await menuItem(page, "canvas.properties").click();
    const button = page.getByTestId("inspector-shortcuts");
    await button.click();
    const dialog = page.getByTestId("shortcuts-dialog");
    const close = page.getByTestId("shortcuts-dialog-close");
    const privacy = page.getByTestId("privacy-link");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(privacy).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(privacy).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
