import { test, expect } from "./fixtures";
import { openExample, settledCanvas } from "./canvas";

for (const [width, height] of [
  [0, 50],
  [0.1, 50],
  [50, 0.4],
  [0.1, 0.4],
]) {
  test(`a rendered empty ${width}×${height} boundary settles and remains in the drawing`, async ({ page }) => {
    await page.setContent(`<div data-testid="canvas-wrap">
    <div data-testid="rf__node-group:empty" style="width:${width}px;height:${height}px;visibility:hidden">
      <div data-testid="group-empty">Empty</div>
    </div>
    <div data-testid="rf__node-card" style="width:220px;height:72px">
      <div data-testid="node-card">Measured card</div>
    </div>
  </div>`);
    const drawn = await settledCanvas(page);
    expect((drawn.nodes["group:empty"] as { box: string }).box).toBe(` ${Math.round(width)}×${Math.round(height)}`);
    expect((drawn.nodes.card as { box: string }).box).toBe(" 220×72");
  });
}

test("changing badge text cannot prevent geometric convergence; text is still recorded", async ({ page }) => {
  await openExample(page, "aws-serverless-orders");
  await page.getByTestId("rf__node-client").evaluate((node) => {
    const badge = document.createElement("span");
    badge.dataset.testid = "parity-changing-badge";
    badge.style.position = "absolute";
    badge.style.width = "100px";
    badge.style.height = "20px";
    node.append(badge);
    let count = 0;
    const tick = () => {
      if (!badge.isConnected) return;
      badge.textContent = `Badge ${++count}`;
      requestAnimationFrame(tick);
    };
    tick();
  });
  const drawn = await settledCanvas(page);
  expect((drawn.nodes.client as { text: string }).text).toMatch(/Badge \d+/);
  // Reading words remains part of the contract even though they don't gate readiness.
  await page.getByTestId("parity-changing-badge").evaluate((el) => el.remove());
  const clean = await settledCanvas(page);
  expect((clean.nodes.client as { text: string }).text).toBe("Web shop Signed-in customers");
});
