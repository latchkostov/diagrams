import { pseudoText } from "../../src/i18n/pseudo";
import type { Page } from "@playwright/test";
import { test, expect, gotoLive, waitForCameraIdle, waitForStableViewport, expectNoErrors } from "./fixtures";

async function editableLatencyDetails(page: Page) {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.addInitScript(() => localStorage.setItem("diagrams.locale", "en-XA"));
  await gotoLive(page, "./?view=canvas&example=where-the-time-goes&sim=billing-spike&live=1&paused=1");
  const input = page.getByTestId("live-timeline-input");
  await input.fill("1000");
  await input.press("ArrowRight");
  await waitForCameraIdle(page);
  const node = page.getByTestId("node-billing");
  await node.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -1600);
  await page.keyboard.up("Control");
  await waitForStableViewport(page);
  await node.click();
  await node.evaluate((el) => el.parentElement?.focus());
  const detail = page.getByTestId("node-detail-billing");
  await expect(detail).toBeVisible();
  await expect.poll(() => detail.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  return { node, detail };
}

test("editable latency details scroll with ArrowDown without moving the selected node", async ({ page }) => {
  const { node, detail } = await editableLatencyDetails(page);
  await detail.focus();
  await expect(detail).toBeFocused();
  const position = () => node.evaluate((el) => el.parentElement?.style.transform);
  const before = await position();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await position()).toBe(before);
});

test("editable latency details scroll with Space without changing playback", async ({ page }) => {
  const { detail } = await editableLatencyDetails(page);
  await detail.focus();
  await expect(detail).toBeFocused();
  const playback = await page.getByTestId("live-play").getAttribute("data-state");
  if (playback === null) throw new Error("Missing playback state");
  await page.keyboard.press("Space");
  await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", playback);
});

test("editable latency details join Tab reading order before the next node", async ({ page }) => {
  const { node, detail } = await editableLatencyDetails(page);
  await page.keyboard.press("Tab");
  await expect(detail).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => node.evaluate((el) => document.activeElement?.contains(el))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(detail).toBeFocused();
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.getByTestId("node-receipts").evaluate((el) => document.activeElement?.contains(el)))
    .toBe(true);
});

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
    await expect(page.getByTestId("live-run-result")).toContainText(
      locale === "en-XA" ? pseudoText("No messages lost") : "No messages lost",
    );
    await page.getByTestId("node-billing").hover();
    const detail = page.getByTestId("node-latency-detail-billing");
    await expect(detail).toBeVisible();
    await expect
      .poll(() => page.getByTestId("node-detail-billing").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    const pane = await page.getByTestId("rf__wrapper").boundingBox();
    const bar = await page.getByTestId("live-controls").boundingBox();
    const box = await page.getByTestId("node-detail-billing").boundingBox();
    const node = await page.getByTestId("node-billing").boundingBox();
    if (!pane || !box || !node || !bar) throw new Error("Missing localized hover geometry");
    expect(box.x).toBeGreaterThanOrEqual(pane.x);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    expect(box.y >= node.y + node.height || box.y + box.height <= node.y).toBe(true);
    await page.screenshot({ path: `tests/.output/latency-hover-${locale}.png` });
  });
}

test("latency hover leaves the node and badges clear in a short viewport, with full details in Properties", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 460 });
  await gotoLive(page, "./?view=canvas&example=where-the-time-goes&sim=billing-spike&paused=1");
  await waitForCameraIdle(page);
  const input = page.getByTestId("live-timeline-input");
  await input.evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "1000");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await input.dispatchEvent("pointerup");
  await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "9400");
  await page.getByTestId("node-billing").hover();
  const tooltip = page.getByTestId("node-detail-billing");
  await expect(tooltip).toBeVisible();
  await expect
    .poll(async () => {
      const pane = await page.getByTestId("rf__wrapper").boundingBox();
      const bar = await page.getByTestId("live-controls").boundingBox();
      const box = await tooltip.boundingBox();
      const node = await page.getByTestId("node-billing").boundingBox();
      if (!pane || !box || !node || !bar) return false;
      return (
        box.y >= pane.y &&
        box.y + box.height <= bar.y &&
        (box.y >= node.y + node.height + 34 || box.y + box.height <= node.y - 12)
      );
    })
    .toBe(true);
  await expect(page.getByTestId("node-latency-percentiles-billing")).toBeVisible();
  await expect(tooltip.getByTestId("node-detail-more")).toBeVisible();
  await expect(page.getByTestId("node-latency-breakdown-billing")).toBeVisible();
  await page.getByTestId("node-billing").dblclick();
  await page.getByTestId("planning-live-details-toggle").click();
  await expect(page.getByTestId("node-latency-breakdown-billing-properties")).toBeVisible();
  await expect(page.getByTestId("node-latency-detail-billing-properties")).toContainText(
    "Approximate percentiles exclude travel",
  );
});

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
  await expect(page.getByTestId("node-latency-receipts")).toHaveText("p95 0.3 s");
  await expect(page.getByTestId("node-latency-billing")).toHaveCount(0);
  await seek(1000);
  await expect(page.getByTestId("live-note")).toContainText("No messages lost");
  await page.getByTestId("node-billing").hover();
  const detail = page.getByTestId("node-latency-detail-billing");
  await expect(detail).toBeVisible();
  await expect
    .poll(() => page.getByTestId("node-detail-billing").evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  await expect(detail).toContainText(/From \d+ finished messages since restart/);
  await expect(detail).toContainText("Animation time not counted");
  await expect(page.getByTestId("node-latency-percentiles-billing")).toContainText(/p50 .*p95 3\.9 s.*p99 /);
  await expect(page.getByTestId("node-latency-breakdown-billing")).toHaveText("Waiting 79% · work 21%");
  const before = await detail.textContent();
  if (before === null) throw new Error("Missing latency detail");
  await seek(350);
  await seek(1000);
  await page.getByTestId("node-billing").hover();
  await expect(detail).toHaveText(before);
  await page.keyboard.press("c");
  await expect(page.getByTestId("node-latency-billing")).toHaveText(/^p95 3\.9 s$/);
  const pane = await page.getByTestId("rf__wrapper").boundingBox();
  const bar = await page.getByTestId("live-controls").boundingBox();
  const box = await page.getByTestId("node-detail-billing").boundingBox();
  const node = await page.getByTestId("node-billing").boundingBox();
  if (!pane || !box || !node || !bar) throw new Error("Missing hover geometry");
  expect(box.y).toBeGreaterThanOrEqual(pane.y);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  expect(box.y >= node.y + node.height || box.y + box.height <= node.y).toBe(true);
  await page.screenshot({ path: "tests/.output/latency-hover.png" });
  expectNoErrors(consoleErrors);
});

for (const surface of ["embed", "presentation"]) {
  test(`latency hover stays above the live bar at 1280×720 in ${surface}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoLive(
      page,
      `./?${surface === "embed" ? "embed=1" : "view=canvas"}&example=where-the-time-goes&sim=billing-spike&live=1&paused=1`,
    );
    if (surface === "presentation") await page.getByTestId("present-toggle").click();
    const input = page.getByTestId("live-timeline-input");
    await input.fill("1000");
    await input.press("ArrowRight");
    await waitForCameraIdle(page);
    await page.getByTestId("node-billing").hover();
    const tooltip = page.getByTestId("node-detail-billing");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByTestId("node-detail-more")).toHaveCount(0);
    await expect(page.getByTestId("node-latency-breakdown-billing")).toBeVisible();
    await expect(tooltip).not.toContainText("Properties");
    await expect
      .poll(async () => {
        const box = await tooltip.boundingBox();
        const bar = await page.getByTestId("live-controls").boundingBox();
        return !!box && !!bar && box.y + box.height <= bar.y;
      })
      .toBe(true);
  });
}

for (const surface of ["embed", "presentation"]) {
  test(`overflowing latency details support pointer and keyboard scrolling in ${surface}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.addInitScript(() => localStorage.setItem("diagrams.locale", "en-XA"));
    await gotoLive(
      page,
      `./?${surface === "embed" ? "embed=1" : "view=canvas"}&example=where-the-time-goes&sim=billing-spike&live=1&paused=1`,
    );
    if (surface === "presentation") await page.getByTestId("present-toggle").click();
    const input = page.getByTestId("live-timeline-input");
    await input.fill("1000");
    await input.press("ArrowRight");
    await waitForCameraIdle(page);
    const node = page.getByTestId("node-billing");
    await node.hover();
    // A fitted, zoomed-out diagram leaves the whole card tiny. Inspect at a readable zoom.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -1600);
    await page.keyboard.up("Control");
    await waitForStableViewport(page);
    await node.hover();
    const detail = page.getByTestId("node-detail-billing");
    await expect(detail).toBeVisible();
    await expect.poll(() => detail.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await detail.hover();
    await expect(detail).toBeVisible();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    if (surface === "presentation") await detail.click();
    else {
      await node.evaluate((el) => el.parentElement?.focus());
      await page.keyboard.press("Tab");
    }
    await expect(detail).toBeFocused();
    await page.keyboard.press("Home");
    await expect.poll(() => detail.evaluate((el) => el.scrollTop)).toBe(0);
    await page.keyboard.press("End");
    await expect.poll(() => detail.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    if (surface === "embed")
      await expect.poll(() => node.evaluate((el) => document.activeElement?.contains(el))).toBe(true);
    else await expect(detail).not.toBeFocused();
  });
}

test("drill percentiles restart their window on slowdown and restoration", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=where-the-time-goes&sim=slow-billing-drill&paused=1");
  const seek = async (value: string) => {
    const input = page.getByTestId("live-timeline-input");
    await input.fill(value);
    await input.press("ArrowRight");
    await waitForCameraIdle(page);
    await page.getByTestId("node-billing").hover();
  };
  await seek("300");
  const scope = page.getByTestId("node-latency-scope-billing");
  await expect(scope).toContainText("since restart");
  await seek("600");
  await expect(scope).toContainText("since Billing became 5× slower");
  await seek("900");
  await expect(scope).toContainText("since Billing was restored");
  await page.getByTestId("live-restart").click();
  await seek("300");
  await expect(scope).toContainText("since restart");
});
