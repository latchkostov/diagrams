import { readFileSync } from "node:fs";
import type { DiagramFile } from "../../src/model/types";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, savedDiagram, waitForStableViewport, STORAGE_KEYS } from "./fixtures";
import { chunk, holdChunk } from "./chunk";

const STENCILS = chunk("Palette", "src/canvas/Palette.tsx");
const MORE = chunk("LiveMoreItems", "src/live/LiveMoreItems.tsx");

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
    await page.addInitScript(() => {
      const key = "diagrams.settings.v1";
      localStorage.setItem(
        key,
        JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), libraryPinned: true }),
      );
    });
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

test("phone overflow controls survive a held and failed chunk with focus, cursors, export and Retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const held = await holdChunk(page, MORE);
  try {
    await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1");
    const opener = page.getByTestId("live-more");
    await opener.click();
    await expect.poll(held.requested).toBe(true);
    await expect(opener).toBeFocused();
    await cursors(page, "grab");
    await page.keyboard.press("Escape");
    await exports(page);
    await opener.click();
    held.fail = true;
    held.release();
    const retry = page.getByTestId("lazy-load-retry");
    await expect(retry).toBeVisible();
    await expect(opener).toBeFocused();
    await cursors(page, "grab");
    held.fail = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-speed")).toBeVisible();
    await expect(opener).toBeFocused();
    await page.getByTestId("live-speed").selectOption("2");
    await expect(page.getByTestId("live-speed")).toHaveValue("2");
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
  } finally {
    held.release();
  }
});
