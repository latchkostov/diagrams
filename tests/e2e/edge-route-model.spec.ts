import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { chunk } from "./chunk";
import fixture from "../parity/corpus/hand-shaped-lines.diagram.json" with { type: "json" };
import {
  test,
  expect,
  gotoCanvas,
  STORAGE_KEYS,
  waitForStableViewport,
  savedDiagram,
  expectNoErrors,
} from "./fixtures";

async function open(page: Page) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    JSON.stringify(fixture),
  ] as const);
  await gotoCanvas(page, "kafka-order-pipeline");
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await waitForStableViewport(page);
}
const path = (page: Page) => page.getByTestId("edge-api-db").evaluate((el) => el.firstElementChild?.getAttribute("d"));
for (const surface of ["menu", "inspector"] as const)
  test(`saved routes reset from ${surface} in one undo step, keeping pinned sides`, async ({ page, consoleErrors }) => {
    await open(page);
    const before = await path(page);
    await page.getByTestId("edge-label-api-db").click({ button: "right" });
    if (surface === "menu") {
      await page.getByTestId("context-menu-item-edge.route").hover();
      await page.getByTestId("context-menu-item-edge.reset-route").click();
    } else {
      await page.keyboard.press("Escape");
      await page.getByTestId("inspector-section-edge-advanced").click();
      await expect(page.getByTestId("inspector-route-state")).toHaveText("Shaped by hand · 2 bends");
      await page.getByTestId("inspector-route-state").click();
      await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
      await page.getByTestId("inspector-route-reset").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("inspector-section-edge-advanced")).toBeFocused();
      await expect(page.getByTestId("inspector-route-state")).toHaveText("Automatic");
    }
    await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-source-side", "bottom");
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-target-side", "bottom");
    await expect
      .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "api-db")?.waypoints)
      .toBeUndefined();
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
    await expect.poll(() => path(page)).toBe(before);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    expectNoErrors(consoleErrors);
  });

test("SVG includes a bend outside all node bounds", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("image-export").click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  const svg = await readFile(await file.path(), "utf8");
  // The node-only height is 420. The saved route reaches -200..580 before image padding/header.
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
  if (!viewBox) throw new Error("Missing SVG viewBox");
  expect(viewBox[3]).toBeGreaterThanOrEqual(780);
  expect(svg).toContain('data-route="custom"');
  expectNoErrors(consoleErrors);
});

for (const fail of [false, true])
  test(`saved-route geometry ${fail ? "failure retries" : "waits without blocking the canvas"}`, async ({ page }) => {
    const pattern = chunk("shaped", "src/canvas/geometry/shaped.ts");
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route(pattern, async (route) => {
      requested = true;
      if (fail) await route.abort();
      else {
        await held;
        await route.continue();
      }
    });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
      JSON.stringify(fixture),
    ] as const);
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("node-api")).toBeVisible();
    await expect(page.getByTestId("edge-api-db")).toHaveCount(0);
    if (fail) {
      await expect(page.getByTestId("lazy-load-retry").first()).toBeVisible();
      await page.unroute(pattern);
      await page.getByTestId("lazy-load-retry").first().click();
      await page.getByTestId("edge-label-api-db").hover();
    } else release();
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  });

for (const fail of [false, true])
  test(`settings details ${fail ? "retry after failure" : "wait without losing hover"}`, async ({
    page,
    consoleErrors,
  }) => {
    const pattern = chunk("SettingsCard", "src/canvas/edges/SettingsCard.tsx");
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route(pattern, async (route) => {
      requested = true;
      if (fail) await route.abort();
      else {
        await held;
        await route.continue();
      }
    });
    const settings = {
      ...fixture,
      edges: fixture.edges.map((e) =>
        e.id === "api-db" ? { ...e, relation: "config", props: { settings: [{ key: "Orders:Timeout" }] } } : e,
      ),
    };
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
      JSON.stringify(settings),
    ] as const);
    await gotoCanvas(page, "kafka-order-pipeline");
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
    await waitForStableViewport(page);
    await expect.poll(() => requested).toBe(true);
    await page.getByTestId("edge-label-api-db").hover();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("edge-settings-api-db")).toHaveCount(0);
    if (fail) {
      await expect(page.getByTestId("lazy-load-retry").first()).toBeVisible();
      await page.unroute(pattern);
      await page.getByTestId("lazy-load-retry").first().click();
      await page.getByTestId("edge-label-api-db").hover();
    } else release();
    await expect(page.getByTestId("edge-settings-api-db")).toBeVisible();
    await expect(page.getByTestId("edge-glyph-api-db")).toBeVisible();
    if (!fail) expectNoErrors(consoleErrors);
  });

test("reverse keeps the saved bends in reverse order and undoes once", async ({ page, consoleErrors }) => {
  await open(page);
  await page.getByTestId("edge-label-api-db").click({ button: "right" });
  await page.getByTestId("context-menu-item-edge.reverse").click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "api-db")?.waypoints)
    .toEqual([...fixture.edges[0].waypoints].reverse());
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await page.getByTestId("undo-button").click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "api-db")?.waypoints)
    .toEqual(fixture.edges[0].waypoints);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  expectNoErrors(consoleErrors);
});
