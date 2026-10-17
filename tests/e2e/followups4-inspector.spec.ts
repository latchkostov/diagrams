import type { Locator, Page } from "@playwright/test";
import { sheetRoutingFixture } from "../../src/lab/routingFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  waitForStableBox,
  viewportTransform,
  emptyCanvasPoint,
  STORAGE_KEYS,
} from "./fixtures";

const ids = ["app", "kong", "orders", "canary", "search"];
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Expected a visible element: ${locator.toString()}`);
  return box;
}
async function open(page: Page, live = false, simulation = false, spread = 1) {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram: sheetRoutingFixture(spread),
  });
  if (live)
    await gotoLive(
      page,
      `./?view=canvas&example=kafka-order-pipeline&live=1&${simulation ? "sim=inspector-note" : "paused=1"}`,
    );
  else await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
}
async function inPane(page: Page, nodes = ids) {
  const pane = await boxOf(page.getByTestId("canvas-wrap"));
  const boxes = await Promise.all(nodes.map((id) => page.getByTestId(`node-${id}`).boundingBox()));
  return boxes.every(
    (b) =>
      b &&
      b.x >= pane.x &&
      b.x + b.width <= pane.x + pane.width &&
      b.y >= pane.y &&
      b.y + b.height <= pane.y + pane.height,
  );
}
const zoom = async (page: Page) => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);

for (const live of [false, true]) {
  test(`opening and closing the Inspector refits a fitted ${live ? "Live" : "edit"} view`, async ({ page }) => {
    await open(page, live);
    await page.getByTestId("fit-view-button").click();
    await waitForStableViewport(page);
    await pauseClock(page);
    await page.getByTestId("node-kong").dblclick();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
    await page.clock.runFor(1500);
    expect(await inPane(page)).toBe(true);
    const narrowZoom = await zoom(page);
    await page.getByTestId("inspector-toggle").click();
    await page.clock.runFor(1500);
    expect(await inPane(page)).toBe(true);
    expect(await zoom(page)).toBeGreaterThan(narrowZoom);
  });
}

test("viewport readiness waits through the delayed pane change", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await page.getByTestId("node-kong").dblclick();
  const pane = page.getByTestId("canvas-wrap");
  await expect(pane).toHaveAttribute("data-pane-pending", "true");
  await pane.evaluate((el) => {
    const query = el.querySelector.bind(el);
    el.setAttribute("data-viewport-reads", "0");
    Object.defineProperty(el, "querySelector", {
      value: (selector: string) => {
        el.setAttribute("data-viewport-reads", String(Number(el.getAttribute("data-viewport-reads")) + 1));
        return query(selector);
      },
    });
  });
  const ready = waitForStableViewport(page);
  // Same-run baseline: a stationary node can settle while the pane's fake clock is held.
  await waitForStableBox(page.getByTestId("node-kong"));
  await expect(pane).toHaveAttribute("data-viewport-reads", "0");
  await page.clock.runFor(1500);
  await ready;
  expect(await inPane(page)).toBe(true);
});

for (const live of [false, true])
  test(`resizing a manually zoomed canvas preserves zoom and reveals selection (${live ? "Live" : "edit"})`, async ({
    page,
  }) => {
    await open(page, live);
    await page.getByTestId("node-search").dblclick();
    await waitForStableViewport(page);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Shift+Digit0");
    await waitForStableViewport(page);
    const pane = await boxOf(page.getByTestId("canvas-wrap"));
    const selected = await boxOf(page.getByTestId("node-search"));
    const point = await emptyCanvasPoint(page);
    await page.mouse.move(pane.x + point.x, pane.y + point.y);
    await page.mouse.wheel(selected.x + selected.width - pane.x - pane.width + 16, 40);
    await waitForStableViewport(page);
    const before = await zoom(page);
    await pauseClock(page);
    await page.getByTestId("inspector-resize").press("End");
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-pane-pending", "true");
    await page.clock.runFor(149);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-pane-pending", "true");
    await page.clock.runFor(1500);
    expect(await zoom(page)).toBe(before);
    expect(await inPane(page, ["search"])).toBe(true);
  });

test("Inspector resize retains narration focus", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, true, true);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  await page.getByTestId("inspector-toggle").click();
  await waitForStableViewport(page);
  await pauseClock(page);
  await page.clock.runFor(1500);
  await page.getByTestId("inspector-resize").press("End");
  await page.clock.runFor(1500);
  expect(await inPane(page, ["kong", "orders"])).toBe(true);
  await expect(page.getByTestId("live-note-continue")).toBeVisible();
  // The explicit focus remains closer than fitting the entire boundary and its source.
  const focusedZoom = await zoom(page);
  await page.getByTestId("fit-view-button").click();
  await page.clock.runFor(1500);
  expect(focusedZoom).toBeGreaterThan(await zoom(page));
});

async function slowMotion(page: Page, spread = 1) {
  await open(page, true, false, spread);
  await page.getByTestId("node-kong").dblclick();
  await waitForStableViewport(page);
  await page.getByTestId("node-app").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await page.getByTestId("live-play").click();
  await pauseClock(page);
  await page.clock.runFor(1500);
}

for (const spread of [1, 4])
  test(`Inspector resize leaves a paused slow-motion camera unchanged (${spread === 1 ? "fit" : "follow"})`, async ({
    page,
  }) => {
    await slowMotion(page, spread);
    await expect(page.getByTestId("live-canvas")).toHaveAttribute(
      "data-slowmo-camera",
      spread === 4 ? "follow" : "fit",
    );
    const before = await viewportTransform(page);
    const position = await page.getByTestId("slowmo-timeline-input").inputValue();
    await page.getByTestId("inspector-resize").press("End");
    await page.clock.runFor(1500);
    expect(await viewportTransform(page)).toBe(before);
    await expect(page.getByTestId("slowmo-timeline-input")).toHaveValue(position);
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "paused");
  });

test("a fitted slow-motion camera replans after resize without restarting replay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowMotion(page);
  await page.getByTestId("slowmo-timeline-input").fill("250");
  await page.getByTestId("live-play").click();
  const before = await viewportTransform(page);
  await page.getByTestId("inspector-resize").press("End");
  await page.clock.runFor(400);
  expect(await viewportTransform(page)).not.toBe(before);
  expect(Number(await page.getByTestId("slowmo-timeline-input").inputValue())).toBeGreaterThanOrEqual(250);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
});

for (const locale of ["en", "ar", "en-XA"]) {
  test(`route headers, word wrapping and Inspector names fit in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    await gotoCanvas(page, "api-route-table");
    await page.getByTestId("node-gateway").dblclick();
    await expect(page.getByTestId("routes-table")).toBeVisible();
    await page.getByTestId("inspector-resize").press("Home");
    const textBox = (id: string) =>
      page.getByTestId(id).evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        return { x: box.x, width: box.width, height: box.height };
      });
    const order = await textBox("routes-order-heading");
    const match = await textBox("routes-match-heading");
    const gap = locale === "ar" ? order.x - match.x - match.width : match.x - order.x - order.width;
    expect.soft(Math.round(gap)).toBeGreaterThanOrEqual(6);
    expect.soft(order.height).toBeLessThanOrEqual(match.height);
    const matchHeading = await boxOf(page.getByTestId("routes-match-heading"));
    const matchCell = await boxOf(page.getByTestId("routes-rule-parcels-match"));
    expect.soft(Math.round(matchHeading.x)).toBe(Math.round(matchCell.x));
    expect
      .soft(await page.getByTestId("routes-last").evaluate((el) => getComputedStyle(el).overflowWrap))
      .toBe("normal");
    expect.soft(await page.getByTestId("inspector-resize").getAttribute("aria-valuetext")).toMatch(/.+/);
    expect.soft(await page.getByTestId("inspector-resize").getAttribute("aria-valuetext")).not.toBe("300");
    const target = page.getByTestId("routes-rule-quotes-targets");
    await expect(target).toHaveAttribute("title", "Pricing, Pricing canary");
    if (locale === "en") await expect.soft(target).toHaveText("Pricing +1");
    const compact = await target.evaluate((el) => {
      const summary = el.firstElementChild;
      if (!summary) throw new Error("Expected a compact target summary");
      const range = document.createRange();
      range.selectNodeContents(summary);
      return { text: Math.ceil(range.getBoundingClientRect().width), available: summary.clientWidth };
    });
    expect.soft(compact.text).toBeLessThanOrEqual(compact.available);
    await waitForStableViewport(page);
    expect(
      await inPane(page, ["app", "carriers", "gateway", "tracking", "pricing", "pricing-canary", "labels", "events"]),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`inspector-${locale}.png`) });
    await page.getByTestId("inspector-resize").press("End");
    await expect(target).toHaveText("Pricing, Pricing canary");
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-inspector-mode", "node");
  });
}
