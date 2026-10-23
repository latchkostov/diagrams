import type { Page } from "@playwright/test";
import { chunk } from "./chunk";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  savedDiagram,
  STORAGE_KEYS,
  waitForSelectionSettled,
  waitForCameraIdle,
} from "./fixtures";

const slug = "kafka-order-pipeline";

async function holdSettings(page: Page) {
  const held = Promise.withResolvers<undefined>();
  const control = { requested: false, fail: false, release: () => held.resolve(undefined) };
  await page.route(chunk("SimulationFields", "src/canvas/inspector/SimulationFields.tsx"), async (route) => {
    control.requested = true;
    await held.promise;
    if (control.fail) await route.abort("failed");
    else await route.continue();
  });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + slug,
    JSON.stringify({
      format: "diagrams/v1",
      title: "Deferred settings",
      nodes: [{ id: "api", stencil: "generic.service", label: "API", x: 0, y: 0 }],
      edges: [],
    }),
  ] as const);
  return control;
}

test("held simulation settings preserve naming, canvas keys, cursor and image export", async ({ page }) => {
  const settings = await holdSettings(page);
  try {
    await gotoCanvas(page, slug);
    const node = page.getByTestId("node-api");
    await node.click();
    await waitForSelectionSettled(page);
    await expect.poll(() => settings.requested).toBe(true);
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("API");
    expect(await node.evaluate((el) => getComputedStyle(el).cursor)).toBe("move");
    const before = (await savedDiagram(page)).nodes[0].x;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await savedDiagram(page)).nodes[0].x).toBeGreaterThan(before);
    await page.keyboard.press("F2");
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.type("Orders API");
    await page.keyboard.press("Enter");
    await expect(node).toContainText("Orders API");
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    expect(await (await downloaded).failure()).toBeNull();
    await node.click();
    await waitForSelectionSettled(page);
    await page.keyboard.press("F2");
    await expect(label).toBeFocused();
    settings.release();
    await expect(page.getByTestId("inspector-section-node-simulation")).toBeVisible();
    await expect(label).toBeFocused();
    await page.keyboard.type("Ready API");
    await expect.poll(async () => (await savedDiagram(page)).nodes[0].label).toBe("Ready API");
  } finally {
    settings.release();
  }
});

test("failed simulation settings offer Retry while node naming remains available", async ({ page }) => {
  const settings = await holdSettings(page);
  try {
    settings.fail = true;
    await gotoCanvas(page, slug);
    await page.getByTestId("node-api").dblclick();
    await expect.poll(() => settings.requested).toBe(true);
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    settings.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(label).toBeFocused();
    await page.keyboard.type("Still editable");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await savedDiagram(page)).nodes[0].label).toBe("Still editable");
    settings.fail = false;
    await page.getByTestId("lazy-load-retry").click();
    await expect(page.getByTestId("inspector-section-node-simulation")).toBeVisible();
    await expect(label).toHaveValue("Still editable");
  } finally {
    settings.release();
  }
});

test("held slow-motion scrubber keeps controls, focus, export and Escape available", async ({ page }) => {
  const held = Promise.withResolvers<undefined>();
  let requested = false;
  await page.route(chunk("SlowTimeline", "src/live/slowmo/SlowTimeline.tsx"), async (route) => {
    requested = true;
    await held.promise;
    await route.continue();
  });
  try {
    await gotoLive(page, `./?view=canvas&example=${slug}&live=1`);
    await waitForCameraIdle(page);
    await page.getByTestId("node-shopper").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
    const play = page.getByTestId("live-play");
    expect(await play.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    await play.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "paused");
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    expect(await (await downloaded).failure()).toBeNull();
    const speed = page.getByTestId("live-speed");
    await speed.focus();
    held.resolve(undefined);
    await expect(page.getByTestId("slowmo-timeline-input")).toBeVisible();
    await expect(speed).toBeFocused();
    // Native selects keep their own Escape; leave the speed field to exercise the replay's exit key.
    await page.getByTestId("live-play").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("slowmo-chip")).toHaveCount(0);
    await expect(page.getByTestId("live-play")).toBeVisible();
  } finally {
    held.resolve(undefined);
  }
});
