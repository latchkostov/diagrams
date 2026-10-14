import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableBox } from "./fixtures";

// "App, not page": drawing on the canvas never selects text or icons in the nodes (the user's report:
// connecting nodes highlighted labels and icons across the diagram). React Flow marks every node and edge
// `selectable`, which once matched the app's own opt-in class and made the whole drawing selectable.
// Text fields (the inspector, a note's editor) stay selectable. Selectors are data-testid only.
// Ids from src/examples/kafka-order-pipeline.json.

const KAFKA = "kafka-order-pipeline";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}

const centre = async (locator: Locator) => {
  const b = await box(locator);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Drags a new connection from a handle with real mouse events, via a detour, to a handle or a point. */
async function connect(page: Page, from: string, to: string | { x: number; y: number }, steps = 8) {
  const a = await centre(page.getByTestId(from));
  const b = typeof to === "string" ? await centre(page.getByTestId(to)) : to;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 60, { steps });
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

/** The document's text selection: nothing selected means no range, or a collapsed one, with no text. */
const selection = (page: Page) =>
  page.evaluate(() => {
    const s = window.getSelection();
    return { text: s?.toString() ?? "", empty: !s || s.rangeCount === 0 || s.isCollapsed };
  });

async function expectNoSelection(page: Page) {
  await expect.poll(() => selection(page)).toEqual({ text: "", empty: true });
}

/** Drags across a text field's text with the mouse; returns how many characters it selected. */
async function dragSelect(page: Page, field: Locator) {
  const b = await box(field);
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  return field.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0));
}

test.describe("no text selection on the canvas", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    await waitForStableBox(page.getByTestId("node-payments"));
  });

  test("nothing on the drawing is selectable or draggable as an image", async ({ page, consoleErrors }) => {
    const offenders = await page.getByTestId("canvas-wrap").evaluate((wrap) => {
      const drawn = wrap.querySelectorAll('[data-testid^="node-"], [data-testid^="edge-"], [data-testid^="group-"]');
      const bad: string[] = [];
      for (const root of drawn)
        for (const el of [root, ...root.querySelectorAll("*")]) {
          if (el.matches("input, textarea")) continue;
          const id = el.closest("[data-testid]")?.getAttribute("data-testid");
          if (getComputedStyle(el).userSelect !== "none") bad.push(`${id} ${el.tagName}: selectable`);
          if (el instanceof HTMLImageElement && el.draggable) bad.push(`${id} IMG: draggable`);
        }
      return { count: drawn.length, bad };
    });
    expect(offenders.count).toBeGreaterThan(20);
    expect(offenders.bad).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("connecting nodes by their handles never selects text or icons", async ({ page, consoleErrors }) => {
    await connect(page, "handle-orders-right", "handle-payments-left");
    await expectNoSelection(page);
    // Fast, across other nodes.
    await connect(page, "handle-inventory-left", "handle-gateway-top", 2);
    await expectNoSelection(page);
    // Ending on empty canvas.
    const wrap = await box(page.getByTestId("canvas-wrap"));
    await connect(page, "handle-payments-bottom", { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height - 40 }, 3);
    await expectNoSelection(page);
    // A node drag and a box select across nodes.
    const orders = await centre(page.getByTestId("node-orders"));
    await page.mouse.move(orders.x, orders.y);
    await page.mouse.down();
    await page.mouse.move(orders.x + 200, orders.y + 120, { steps: 10 });
    await page.mouse.up();
    await expectNoSelection(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(wrap.x + 40, wrap.y + 120);
    await page.mouse.down();
    await page.mouse.move(wrap.x + wrap.width - 40, wrap.y + wrap.height - 40, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expectNoSelection(page);
    expectNoErrors(consoleErrors);
  });

  test("connecting right after a rename selects nothing", async ({ page, consoleErrors }) => {
    // Nodes are renamed in the inspector. F2 rename, then connect.
    const label = page.getByTestId("inspector-field-label");
    await page.getByTestId("node-orders").click();
    await page.keyboard.press("F2");
    await expect(label).toBeFocused();
    await page.keyboard.type("Orders API");
    await page.keyboard.press("Enter");
    await expect(label).not.toBeFocused();
    await connect(page, "handle-orders-right", "handle-payments-left");
    await expectNoSelection(page);
    // Double-click rename, then connect.
    await page.getByTestId("node-payments").dblclick();
    await expect(label).toBeFocused();
    await page.keyboard.press("Enter");
    await connect(page, "handle-payments-right", "handle-inventory-left");
    await expectNoSelection(page);
    // Connecting while the name is still focused takes focus from it and selects nothing.
    await page.getByTestId("node-inventory").dblclick();
    await expect(label).toBeFocused();
    await connect(page, "handle-inventory-bottom", "handle-orders-top");
    await expect(label).not.toBeFocused();
    await expectNoSelection(page);
    expectNoErrors(consoleErrors);
  });

  test("a text selection in a panel doesn't survive a connect drag", async ({ page, consoleErrors }) => {
    await page.getByTestId("node-orders").click();
    const field = page.getByTestId("inspector-field-label");
    await field.click();
    await field.press("ControlOrMeta+a");
    await expect.poll(async () => (await selection(page)).text).toBe("Order service");
    await connect(page, "handle-orders-right", "handle-payments-left");
    await expectNoSelection(page);
    expectNoErrors(consoleErrors);
  });

  test("double-clicking a node opens its name in the inspector; clicks never select the node's text", async ({
    page,
    consoleErrors,
  }) => {
    const node = page.getByTestId("node-orders");
    const label = page.getByTestId("inspector-field-label");
    await node.click({ clickCount: 3 });
    // The third click lands on the node, not in the field: nothing is selected, the card's text least of all.
    await expect(label).not.toBeFocused();
    await expectNoSelection(page);
    await node.dblclick();
    await expect(label).toBeFocused();
    // The inspector's field holds the selection (its whole text), not the canvas.
    await expect
      .poll(() => label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length]))
      .toEqual([0, 13, 13]);
    expect((await selection(page)).text).toBe("Order service");
    expectNoErrors(consoleErrors);
  });

  test("a renamed node's fields are still selectable with the mouse", async ({ page, consoleErrors }) => {
    await page.getByTestId("node-orders").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.press("End");
    expect(await dragSelect(page, label)).toBeGreaterThan(0);
    await expect(label).toBeFocused();
    const sub = page.getByTestId("inspector-field-sublabel");
    expect(await dragSelect(page, sub)).toBeGreaterThan(0);
    await expect(sub).toBeFocused();
    expectNoErrors(consoleErrors);
  });

  test("text in the inspector is still selectable with the mouse", async ({ page, consoleErrors }) => {
    await page.getByTestId("node-orders").click();
    const field = page.getByTestId("inspector-field-label");
    await expect(field).toHaveValue("Order service");
    expect(await dragSelect(page, field)).toBeGreaterThan(0);
    await expect(field).toBeFocused();
    expectNoErrors(consoleErrors);
  });
});
