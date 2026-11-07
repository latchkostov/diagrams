import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

test("opening a diagram file without positions lays out distinct visible nodes", async ({ page, consoleErrors }) => {
  await gotoCanvas(page);
  await page.getByTestId("import-input").setInputFiles({
    name: "orders.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Orders without positions",
        nodes: [
          { id: "orders", stencil: "service.node", label: "Orders" },
          { id: "worker", stencil: "service.java", label: "Worker" },
        ],
        edges: [{ id: "delivery", from: "orders", to: "worker", kind: "async" }],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Orders without positions");
  const orders = page.getByTestId("node-orders");
  const worker = page.getByTestId("node-worker");
  await expect(orders).toBeVisible();
  await expect(worker).toBeVisible();
  await expect
    .poll(async () => {
      const a = await orders.boundingBox();
      const b = await worker.boundingBox();
      return (
        !!a && !!b && (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
      );
    })
    .toBe(true);
  await expect(page.getByTestId("toast")).toContainText("The diagram was laid out on open.");
  expectNoErrors(consoleErrors);
});
