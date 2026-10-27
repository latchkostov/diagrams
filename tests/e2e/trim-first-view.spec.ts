import { readFileSync } from "node:fs";
import type { DiagramFile } from "../../src/model/types";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  savedDiagram,
  waitForStableViewport,
  openDiagramProperties,
  TEXT_END,
  STORAGE_KEYS,
} from "./fixtures";
import { chunk, holdChunk } from "./chunk";

const STENCILS = chunk("Palette", "src/canvas/Palette.tsx");
const MORE = chunk("LiveMoreItems", "src/live/LiveMoreItems.tsx");

async function pinLibrary(page: Page) {
  await page.addInitScript(() => {
    const key = "diagrams.settings.v1";
    localStorage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), libraryPinned: true }),
    );
  });
}

async function bounds(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  if (!box) throw new Error("Expected visible control bounds");
  return box;
}

async function expectBounds(control: Locator, expected: Awaited<ReturnType<typeof bounds>>) {
  await expect.poll(() => bounds(control)).toEqual(expected);
}

for (const phone of [false, true]) {
  for (const failed of [false, true]) {
    test(`${phone ? "phone" : "desktop"} pinned library keeps its shell while ${failed ? "failed" : "held"}, closes and recovers`, async ({
      page,
    }) => {
      await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      const held = await holdChunk(page, STENCILS);
      try {
        await pinLibrary(page);
        await gotoCanvas(page, "kafka-order-pipeline");
        await expect.poll(held.requested).toBe(true);
        const palette = page.getByTestId("palette");
        const toggle = page.getByTestId("palette-toggle");
        const pane = page.getByTestId("canvas-pane");
        await expect(page.getByTestId("palette-loading")).toHaveAttribute("aria-busy", "true");
        const shell = await bounds(palette);
        const canvas = await bounds(pane);
        await expect(palette).toHaveAttribute("data-mode", "pinned");
        if (phone) {
          expect(canvas.width).toBe(390);
          expect(shell.x).toBe(canvas.x);
          expect(shell.y).toBeGreaterThan(canvas.y);
          expect(shell.y + shell.height).toBeLessThan(canvas.y + canvas.height);
        }
        if (failed) {
          held.fail = true;
          held.release();
          await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
          await expect(page.getByTestId("palette-loading")).toHaveAttribute("aria-busy", "false");
          await expectBounds(palette, shell);
          await expectBounds(pane, canvas);
        }
        await expect(toggle).toHaveAccessibleName("Close library");
        await toggle.click();
        await expect(palette).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(() => JSON.parse(localStorage.getItem("diagrams.settings.v1") ?? "{}").libraryPinned),
          )
          .toBe(false);
        await page.getByTestId("rail-add").click();
        await expect(toggle).toHaveAccessibleName("Pin open");
        await toggle.click();
        await expect(palette).toHaveAttribute("data-mode", "pinned");
        await expectBounds(palette, shell);
        await expectBounds(pane, canvas);
        if (failed) await expect(page.getByTestId("palette-loading")).toHaveAttribute("aria-busy", "false");
        held.fail = false;
        if (failed) await page.getByTestId("lazy-load-retry").click();
        else held.release();
        await expect(page.getByTestId("palette-common")).toBeVisible();
        await expect(page.getByTestId("palette-loading")).toHaveCount(0);
        await expectBounds(palette, shell);
        await expectBounds(pane, canvas);
        await expect(toggle).toHaveAccessibleName("Close library");
        await toggle.click();
        await expect(palette).toHaveCount(0);
      } finally {
        held.release();
      }
    });
  }
}

for (const owner of ["search", "other control"] as const) {
  test(`stencil completion preserves the current keyboard owner: ${owner}`, async ({ page }) => {
    const held = await holdChunk(page, STENCILS);
    try {
      await pinLibrary(page);
      const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
      await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
        key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
        diagram,
      });
      await gotoCanvas(page, "kafka-order-pipeline");
      const before = await savedDiagram(page);
      await expect.poll(held.requested).toBe(true);
      const search = page.getByTestId("palette-search");
      await search.click();
      await expect(search).toBeFocused();
      await page.keyboard.type("redis");
      const current = owner === "search" ? search : page.getByTestId("inspector-field-title");
      if (owner !== "search") {
        await openDiagramProperties(page);
        await current.focus();
        await current.press(TEXT_END);
      }
      held.release();
      await expect(page.getByTestId("palette-item-redis.cache")).toBeVisible();
      await expect(search).toHaveValue("redis");
      await expect(current).toBeFocused();
      await page.keyboard.type("lt");
      await expect(search).toHaveValue(owner === "search" ? "redislt" : "redis");
      await expect(page.getByTestId("live-controls")).toHaveCount(0);
      await expect
        .poll(() => savedDiagram(page))
        .toEqual(owner === "search" ? before : { ...before, title: before.title + "lt" });
    } finally {
      held.release();
    }
  });
}

async function cursors(page: Page, pane = "default") {
  await expect(page.getByTestId("node-shopper")).toHaveCSS("cursor", "move");
  await expect(page.getByTestId("canvas-pane")).toHaveCSS("cursor", pane);
}

async function exports(page: Page) {
  for (const format of ["json", "png"] as const) {
    const download = page.waitForEvent("download");
    const folded = !(await page.getByTestId("file-button").isVisible());
    if (folded) await page.getByTestId("topbar-more").click();
    await page.getByTestId("file-button").click();
    if (format === "json") await page.getByTestId("file-more-formats").click();
    await page.getByTestId(`export-${format}`).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(format === "json" ? /\.json$/ : /\.png$/);
    expect(await file.failure()).toBeNull();
    if (folded) await page.getByTestId("topbar-more").click();
  }
}

test("stencil download keeps canvas cursors, focus and exports; Retry preserves the library query", async ({
  page,
}) => {
  const held = await holdChunk(page, STENCILS);
  try {
    const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
      diagram,
    });
    await gotoCanvas(page, "kafka-order-pipeline");
    await waitForStableViewport(page);
    expect(held.requested()).toBe(false);
    const before = await savedDiagram(page);
    const opener = page.getByTestId("rail-add");
    await opener.click();
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("palette-loading")).toBeVisible();
    const pendingSearch = page.getByTestId("palette-search");
    await expect(pendingSearch).toBeFocused();
    await pendingSearch.fill("redis");
    await pendingSearch.press("Escape");
    await expect(pendingSearch).toHaveValue("");
    await expect(pendingSearch).toBeFocused();
    await pendingSearch.fill("redis");
    await cursors(page);
    await exports(page);
    await opener.click();
    held.fail = true;
    held.release();
    const retry = page.getByTestId("lazy-load-retry");
    await expect(retry).toBeVisible();
    await expect(pendingSearch).toBeFocused();
    await cursors(page);
    held.fail = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    const search = page.getByTestId("palette-search");
    await expect(page.getByTestId("palette-loading")).toHaveCount(0);
    await expect(page.getByTestId("palette-item-redis.cache")).toBeVisible();
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("redis");
    await search.press("x");
    await expect(search).toHaveValue("redisx");
    await cursors(page);
    expect(await savedDiagram(page)).toEqual(before);
    await search.fill("redis");
    await page.getByTestId("rail-select").click();
    await opener.click();
    await expect(search).toHaveValue("redis");
  } finally {
    held.release();
  }
});

test("closing a pending stencil library does not reopen it when its chunk arrives", async ({ page }) => {
  const held = await holdChunk(page, STENCILS);
  try {
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("rail-add").click();
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("rail-select").click();
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await expect(page.getByTestId("palette-loading")).toHaveCount(0);
    held.release();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["canvas.stencils"]?.state))
      .toBe("loaded");
    await expect(page.getByTestId("palette")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  } finally {
    held.release();
  }
});

test("file and image exports skip an active pinned library whose contents are held", async ({ page }) => {
  const held = await holdChunk(page, STENCILS);
  try {
    await pinLibrary(page);
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect.poll(held.requested).toBe(true);
    await exports(page);
    await expect(page.getByTestId("palette-loading")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["canvas.stencils"]))
      .toEqual({ state: "loading", active: true });
    await cursors(page);
  } finally {
    held.release();
  }
});

test("Gallery handoff runs without downloading the closed stencil library", async ({ page }) => {
  const held = await holdChunk(page, STENCILS);
  try {
    await page.addInitScript(() => sessionStorage.setItem("diagrams.pendingStencils.v1", '["redis.cache"]'));
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect.poll(async () => (await savedDiagram(page)).nodes.some((n) => n.stencil === "redis.cache")).toBe(true);
    expect(held.requested()).toBe(false);
  } finally {
    held.release();
  }
});

test("phone transport stays reachable during overflow loading and Retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const held = await holdChunk(page, MORE);
  try {
    await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1&sim=payments-outage");
    const controls = ["live-play", "live-sim-picker", "live-view-menu", "live-expectations-summary", "live-more"].map(
      (id) => page.getByTestId(id),
    );
    await expect(page.getByTestId("live-timeline-input")).toBeVisible();
    const original = await Promise.all(controls.map(bounds));
    for (const box of original) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
    const stable = async () => {
      for (let i = 0; i < controls.length; i++) await expectBounds(controls[i], original[i]);
    };
    const opener = page.getByTestId("live-more");
    await opener.click();
    await expect.poll(held.requested).toBe(true);
    await expect(opener).toBeFocused();
    await stable();
    await cursors(page, "grab");
    await page.keyboard.press("Escape");
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
    const picker = page.getByTestId("live-sim-picker");
    await picker.selectOption("");
    await expect(picker).toHaveValue("");
    await picker.selectOption("payments-outage");
    await expect(picker).toHaveValue("payments-outage");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-follow").click();
    await expect(page.getByTestId("live-view-menu")).toContainText("Following");
    await page.getByTestId("live-expectations-summary").click();
    await expect(page.getByTestId("expectation-row-outage-lag")).toBeVisible();
    await page.keyboard.press("Escape");
    await stable();
    await exports(page);
    await opener.click();
    held.fail = true;
    held.release();
    const retry = page.getByTestId("lazy-load-retry");
    await expect(retry).toBeVisible();
    await stable();
    await expect(opener).toBeFocused();
    await cursors(page, "grab");
    held.fail = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-speed")).toBeVisible();
    await stable();
    await expect(opener).toBeFocused();
    await page.getByTestId("live-speed").selectOption("2");
    await expect(page.getByTestId("live-speed")).toHaveValue("2");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
  } finally {
    held.release();
  }
});
