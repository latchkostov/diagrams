import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import { test, expect, gotoCanvas, fitDiagram, savedDiagram, STORAGE_KEYS, waitForSelectionSettled } from "./fixtures";
import { zoomIdentity } from "./node-identity";

for (const zoom of [0.4, 0.25])
  test(`offset connection clicks keep menus, shaping and reconnection at ${zoom}`, async ({ page }) => {
    await page.addInitScript(({ fixture, key }) => localStorage.setItem(key, JSON.stringify(fixture)), {
      fixture: textFieldsFixture,
      key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    });
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("node-a").click();
    await waitForSelectionSettled(page);
    await fitDiagram(page);
    await zoomIdentity(page, zoom);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", zoom < 0.3 ? "far" : "mid");
    const line = page.getByTestId("connection-stroke-ab");
    const offsetPoint = () =>
      line.evaluate((el: SVGPathElement) => {
        const point = el.getPointAtLength(el.getTotalLength() / 2);
        const matrix = el.getScreenCTM();
        if (!matrix) throw new Error("Missing connection transform");
        const p = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: p.x, y: p.y + 4 };
      });
    const offset = await offsetPoint();
    await page.mouse.click(offset.x, offset.y);
    await waitForSelectionSettled(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", zoom < 0.3 ? "far" : "mid");
    await expect(page.getByTestId("reconnect-ab-source")).toBeVisible();
    await expect(page.getByTestId("reconnect-ab-target")).toBeVisible();
    await expect(page.getByTestId("route-segment-ab-0")).toBeVisible();
    const before = await line.getAttribute("d");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => line.getAttribute("d")).not.toBe(before);
    await expect.poll(async () => (await savedDiagram(page)).edges[0].waypoints?.length ?? 0).toBeGreaterThan(0);
    // The controls and selected path use the same displayed endpoints.
    const end = await line.evaluate((el: SVGPathElement) => {
      // Low-zoom arrows add a subpath; the first move/line describes the route's start.
      const start = el.getPointAtLength(0);
      const matrix = el.getScreenCTM();
      if (!matrix) throw new Error("Missing connection transform");
      const p = new DOMPoint(start.x, start.y).matrixTransform(matrix);
      return { x: p.x, y: p.y };
    });
    const source = await page.getByTestId("reconnect-ab-source").boundingBox();
    if (!source) throw new Error("Missing source control");
    expect(source.x + source.width / 2).toBeCloseTo(end.x, 0);
    expect(source.y + source.height / 2).toBeCloseTo(end.y, 0);
    const menuPoint = await offsetPoint();
    await page.mouse.click(menuPoint.x, menuPoint.y, { button: "right" });
    await expect(page.getByTestId("context-menu-item-edge.reconnect")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("edge-ab").evaluate((el) => (el.parentElement as unknown as SVGElement).blur());
    await expect(page.getByTestId("edge-messages-ab")).not.toBeVisible();
    await fitDiagram(page);
    await zoomIdentity(page, zoom);
    await page.getByTestId("reconnect-ab-target").dragTo(page.getByTestId("node-c"));
    await expect.poll(async () => (await savedDiagram(page)).edges[0].to).toBe("c");
  });
