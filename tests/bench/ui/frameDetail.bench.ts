import { frameCaptionGridFixture } from "../../../src/lab/frameRoutingFixture";
import { Bench, expect, MODE, test, uiSuite } from "./harness";

const suite = uiSuite("frameDetail");
test.skip(MODE === "gates", "report-only");
test("settled caption pan zoom and edit @1500", async ({ page }) => {
  const diagram = frameCaptionGridFixture();
  const b = await Bench.create(page);
  await b.open({ text: JSON.stringify(diagram), d: diagram });
  await b.canvasSettled();
  await page.getByTestId("canvas-wrap").press("Shift+0");
  await b.canvasSettled();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("zoom-out-button").click();
    await b.canvasSettled();
  }
  expect((await b.viewport()).k).toBeGreaterThanOrEqual(0.6);
  expect((await b.viewport()).k).toBeLessThan(0.9);
  expect(
    await page
      .getByTestId(/^edge-label-/)
      .evaluateAll(
        (labels) =>
          labels.filter(
            (el) => (el as HTMLElement).style.width === "max-content" && !el.hasAttribute("data-detail-hidden"),
          ).length,
      ),
  ).toBeGreaterThan(0);
  const measure = async (name: string, action: () => Promise<void>) => {
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = await b.metrics();
      await action();
      await b.canvasSettled();
      await b.frames(2);
      values.push((await b.metrics()).TaskDuration - before.TaskDuration);
    }
    console.log(`${name}: ${JSON.stringify(values)}`);
    suite.time(name, values, { family: "caption-grid", n: 1500, nodes: 1500, edges: 750 });
  };
  await measure("settled-pan", async () => {
    await page.getByTestId("canvas-pane").dispatchEvent("wheel", { deltaX: 12, deltaY: 4, bubbles: true });
  });
  let zoomIn = true;
  await measure("settled-zoom", async () => {
    await page.getByTestId(zoomIn ? "zoom-in-button" : "zoom-out-button").click();
    zoomIn = !zoomIn;
  });
  const id = await b.nodeNearCentre(diagram.nodes.map((n) => n.id));
  await b.clickNode(id, { double: true });
  await b.selectionSettled();
  const input = page.getByTestId("inspector-field-label");
  await measure("settled-edit", async () => {
    await input.press("End");
    await input.press("a");
  });
});
