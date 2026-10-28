import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import { test, expect, gotoCanvas, fitDiagram, waitForSelectionSettled, STORAGE_KEYS } from "./fixtures";
import { zoomIdentity } from "./node-identity";

test("chip connections follow a held node without refitting names", async ({ page }) => {
  await page.addInitScript(({ fixture, key }) => localStorage.setItem(key, JSON.stringify(fixture)), {
    fixture: textFieldsFixture,
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
  });
  await gotoCanvas(page, "kafka-order-pipeline");
  const node = page.getByTestId("node-a");
  await node.click();
  await waitForSelectionSettled(page);
  await fitDiagram(page);
  await zoomIdentity(page, 0.4);
  const root = page.getByTestId("canvas-wrap");
  await expect(root).toHaveAttribute("data-low-zoom", "mid");
  const edge = page.getByTestId("connection-stroke-ab");
  const before = await edge.getAttribute("d");
  const fits = await root.getAttribute("data-chip-fits");
  const box = await node.boundingBox();
  if (!box) throw new Error("Missing chip");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 80, y + 60, { steps: 3 });
    await expect.poll(() => edge.getAttribute("d")).not.toBe(before);
    expect(await root.getAttribute("data-chip-fits")).toBe(fits);
  } finally {
    await page.mouse.up();
  }
  await expect.poll(async () => Number(await root.getAttribute("data-chip-fits"))).toBeGreaterThan(Number(fits));
});
