import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, gotoLive } from "./fixtures";

// A node's inline editor (double-click) is the topmost thing on the canvas: no neighbouring card,
// edge label, live particle canvas, metric badge or hover breakdown paints over it, in edit mode or live.
// Selectors are data-testid only. Ids from src/examples/kafka-order-pipeline.json.

const KAFKA = "kafka-order-pipeline";

/**
 * Points across the open editor where something else paints on top, as "x,y: test id of the cover".
 * The live layers ignore the pointer, which `elementFromPoint` skips too, so everything in React
 * Flow's viewport (the transformed ancestor of the editor) takes hits for the duration of the probe:
 * the answer is then purely paint order.
 */
async function coveredPoints(page: Page): Promise<string[]> {
  return page.getByTestId("node-editor").evaluate((editor) => {
    let viewport: HTMLElement | null = editor.parentElement;
    while (viewport && !/scale\(/.test(viewport.style.transform)) viewport = viewport.parentElement;
    if (!viewport) throw new Error("No transformed viewport above the editor");
    const all = [viewport, ...viewport.querySelectorAll<HTMLElement | SVGElement>("*")];
    for (const el of all) el.style.setProperty("pointer-events", "auto", "important");
    try {
      const r = editor.getBoundingClientRect();
      const covered: string[] = [];
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 5; j++) {
          const x = r.left + (r.width * (i + 0.5)) / 8;
          const y = r.top + (r.height * (j + 0.5)) / 5;
          const hit = document.elementFromPoint(x, y);
          if (hit && editor.contains(hit)) continue;
          const id = hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.tagName ?? "nothing";
          covered.push(`${Math.round(x)},${Math.round(y)}: ${id}`);
        }
      return covered;
    } finally {
      for (const el of all) el.style.removeProperty("pointer-events");
    }
  });
}

/** Double-clicks a node and waits for its editor, with the pointer left over the node. */
async function editNode(page: Page, id: string) {
  const node = page.getByTestId(`node-${id}`);
  await node.hover();
  await node.dblclick();
  await expect(page.getByTestId("node-editor-label")).toBeFocused();
  await node.hover();
}

async function closeEditor(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("node-editor")).toHaveCount(0);
}

test.describe("inline node editor stacking", () => {
  test("live: the editor draws above badges, the hover breakdown, canvases and neighbours", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=4`);
    // Traffic has reached the topic, so it has a lag badge and a breakdown.
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-order-events").getAttribute("data-processed")))
      .toBeGreaterThan(0);
    await page.getByTestId("node-order-events").hover();
    await expect(page.getByTestId("node-detail-order-events")).toBeVisible();

    // The topic (its own badge and breakdown), Inventory (the Payments card sits right below it) and the
    // Order service (an edge label runs under it).
    for (const id of ["order-events", "inventory", "orders"]) {
      await editNode(page, id);
      await expect(page.getByTestId(/^node-detail-/)).toHaveCount(0);
      const input = page.getByTestId("node-editor-label");
      const inputBox = await input.boundingBox();
      if (!inputBox) throw new Error("No box for the label input");
      const atInput = await input.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), {
        x: inputBox.x + inputBox.width / 2,
        y: inputBox.y + inputBox.height / 2,
      });
      expect(atInput, `${id}: the label input is under something`).toBe(true);
      expect(await coveredPoints(page), `${id}: editor covered`).toEqual([]);
      await closeEditor(page);
    }
    // Closing the editor brings the breakdown back.
    await page.getByTestId("node-order-events").hover();
    await expect(page.getByTestId("node-detail-order-events")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("editing: the editor draws above edge labels and neighbours, with no node tooltip", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, KAFKA);
    // The tooltip shows on hover before editing...
    await page.getByTestId("node-inventory").hover();
    await expect(page.getByTestId("node-tooltip")).toBeVisible();
    for (const id of ["inventory", "orders"]) {
      await editNode(page, id);
      // ... and never while the editor is open, even after the pointer re-enters the card.
      await page.mouse.move(5, 5);
      await page.getByTestId(`node-${id}`).hover();
      await page.waitForTimeout(800);
      await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
      expect(await coveredPoints(page), `${id}: editor covered`).toEqual([]);
      await closeEditor(page);
    }
    expectNoErrors(consoleErrors);
  });
});
