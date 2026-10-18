import { test, expect, gotoLive, waitForCameraIdle, expectNoErrors } from "./fixtures";

for (const locale of ["en-XA", "ar"]) {
  test(`latency hover fits the canvas in ${locale}`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await gotoLive(page, "./?view=canvas&example=where-the-time-goes&sim=billing-spike&paused=1");
    await waitForCameraIdle(page);
    const input = page.getByTestId("live-timeline-input");
    await input.evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "1000");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await input.dispatchEvent("pointerup");
    await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "9400");
    await expect(page.getByTestId("live-note")).toHaveCount(0);
    await page.getByTestId("node-billing").hover();
    const detail = page.getByTestId("node-latency-detail-billing");
    await expect(detail).toBeVisible();
    await expect
      .poll(() => page.getByTestId("node-detail-billing").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    const pane = await page.getByTestId("rf__wrapper").boundingBox();
    const box = await page.getByTestId("node-detail-billing").boundingBox();
    const node = await page.getByTestId("node-billing").boundingBox();
    if (!pane || !box || !node) throw new Error("Missing localized hover geometry");
    expect(box.x).toBeGreaterThanOrEqual(pane.x);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
    expect(box.y >= node.y + node.height || box.y + box.height <= node.y).toBe(true);
    await page.screenshot({ path: `tests/.output/latency-hover-${locale}.png` });
  });
}

test("async percentiles disclose sampling, exclude travel, and replay after seeking", async ({
  page,
  consoleErrors,
}) => {
  await gotoLive(page, "./?view=canvas&example=where-the-time-goes&sim=billing-spike&paused=1");
  await waitForCameraIdle(page);
  const seek = async (fraction: number) => {
    const input = page.getByTestId("live-timeline-input");
    await input.evaluate((el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, fraction);
    await input.dispatchEvent("pointerup");
    await expect(page.getByTestId("live-clock")).toHaveAttribute(
      "data-ms",
      String(Math.round((9400 * fraction) / 10000) * 10),
    );
  };
  await seek(350);
  await expect(page.getByTestId("node-latency-receipts")).toHaveText("p95 300 ms");
  await expect(page.getByTestId("node-latency-billing")).toHaveCount(0);
  await seek(1000);
  await expect(page.getByTestId("live-note")).toHaveCount(0);
  await page.getByTestId("node-billing").hover();
  const detail = page.getByTestId("node-latency-detail-billing");
  await expect(detail).toBeVisible();
  await expect
    .poll(() => page.getByTestId("node-detail-billing").evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  await expect(detail).toContainText(/from \d+ sampled messages · since restart/);
  await expect(detail).toContainText("Approximate percentiles exclude travel");
  await expect(page.getByTestId("node-latency-percentiles-billing")).toContainText(/p50 .*p95 3\.9 (s|sec).*p99 /);
  await expect(page.getByTestId("node-latency-breakdown-billing")).toHaveText("Waiting 78% · work 21% · travel 1%");
  const before = await detail.textContent();
  if (before === null) throw new Error("Missing latency detail");
  await seek(350);
  await seek(1000);
  await page.getByTestId("node-billing").hover();
  await expect(detail).toHaveText(before);
  await page.keyboard.press("c");
  await expect(page.getByTestId("node-latency-billing")).toHaveText(/^p95 3\.9 (s|sec)$/);
  const pane = await page.getByTestId("rf__wrapper").boundingBox();
  const box = await page.getByTestId("node-detail-billing").boundingBox();
  const node = await page.getByTestId("node-billing").boundingBox();
  if (!pane || !box || !node) throw new Error("Missing hover geometry");
  expect(box.y).toBeGreaterThanOrEqual(pane.y);
  expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
  expect(box.y >= node.y + node.height || box.y + box.height <= node.y).toBe(true);
  await page.screenshot({ path: "tests/.output/latency-hover.png" });
  expectNoErrors(consoleErrors);
});
