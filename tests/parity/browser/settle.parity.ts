import { test, expect } from "./fixtures";
import { openExample, settledCanvas } from "./canvas";

test("changing badge text cannot prevent geometric convergence; text is still recorded", async ({ page }) => {
  await openExample(page, "aws-fanout");
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
  expect((clean.nodes.client as { text: string }).text).toBe("Retail checkout Authenticated storefront");
});
