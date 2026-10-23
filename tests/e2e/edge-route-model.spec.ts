import { readFile } from "node:fs/promises";
import { settledCanvas } from "../parity/browser/canvas";
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

async function seed(page: Page, diagram = fixture) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    JSON.stringify(diagram),
  ] as const);
}
async function expectRoutesInPane(page: Page) {
  const pane = await page.getByTestId("canvas-wrap").boundingBox();
  if (!pane) throw new Error("Missing pane");
  for (const id of ["api-db", "detour", "shape-end"]) {
    const edge = page.getByTestId(`edge-${id}`);
    const box = await edge.boundingBox();
    if (!box) throw new Error("Missing route bounds");
    expect(box.x).toBeGreaterThanOrEqual(pane.x);
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
  }
}
test("opening fit and shared readiness wait for pending saved routes", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(chunk("shaped", "src/canvas/geometry/shaped.ts"), async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await seed(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await expect.poll(() => requested).toBe(true);
  let settled = false;
  const ready = settledCanvas(page).then(() => {
    settled = true;
  });
  // Use the browser's actual font/layout readiness before checking the held route gate.
  await page.getByTestId("canvas-wrap").evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "true");
  expect(settled).toBe(false);
  release();
  await ready;
  await expectRoutesInPane(page);
});
test("image export waits for pending saved routes", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(chunk("shaped", "src/canvas/geometry/shaped.ts"), async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await seed(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await expect.poll(() => requested).toBe(true);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  let downloaded = false;
  const download = page.waitForEvent("download").then((file) => {
    downloaded = true;
    return file;
  });
  await page.getByTestId("image-export").click();
  await expect(page.getByTestId("image-export-cancel")).toBeVisible();
  await expect(page.getByTestId("edge-api-db")).toHaveCount(0);
  expect(downloaded).toBe(false);
  release();
  const file = await download;
  expect(await file.failure()).toBeNull();
  const svg = await readFile(await file.path(), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
  expect(viewBox?.[3]).toBeGreaterThanOrEqual(780);
  expect(svg).toContain('data-route="custom"');
  expect(svg).toContain('data-testid="edge-detour"');
});
test("image export waits for shaped dependency details", async ({ page, consoleErrors }) => {
  const releases: (() => void)[] = [];
  const requested = new Set<number>();
  for (const [i, pattern] of [
    chunk("shaped", "src/canvas/geometry/shaped.ts"),
    chunk("SettingsCard", "src/canvas/edges/SettingsCard.tsx"),
  ].entries()) {
    const held = new Promise<void>((resolve) => {
      releases[i] = resolve;
    });
    await page.route(pattern, async (route) => {
      requested.add(i);
      await held;
      await route.continue();
    });
  }
  const diagram = {
    ...fixture,
    edges: fixture.edges.map((e) =>
      e.id === "api-db" ? { ...e, relation: "config", props: { settings: [{ key: "Orders:Timeout" }] } } : e,
    ),
  };
  await seed(page, diagram);
  await gotoCanvas(page, "kafka-order-pipeline");
  await expect.poll(() => requested.size).toBe(2);
  await expect(page.getByTestId("edge-api-db")).toHaveCount(0);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  let downloaded = false;
  const download = page.waitForEvent("download").then((file) => {
    downloaded = true;
    return file;
  });
  await page.getByTestId("image-export").click();
  await expect(page.getByTestId("image-export-cancel")).toBeVisible();
  releases[0]();
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route-pending", "details");
  await page
    .getByTestId("canvas-wrap")
    .evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  await expect(page.getByTestId("image-export-cancel")).toBeVisible();
  expect(downloaded).toBe(false);
  await expect(page.getByTestId("edge-glyph-api-db")).toHaveCount(0);
  releases[1]();
  const file = await download;
  expect(await file.failure()).toBeNull();
  const svg = await readFile(await file.path(), "utf8");
  expect(svg).toContain('data-route="custom"');
  expect(svg).toContain('data-testid="edge-glyph-api-db"');
  expectNoErrors(consoleErrors);
});
test("one surviving Retry recovers failed shaped routes and separate dependency details", async ({ page }) => {
  const patterns = [
    chunk("shaped", "src/canvas/geometry/shaped.ts"),
    chunk("SettingsCard", "src/canvas/edges/SettingsCard.tsx"),
  ];
  const failed = new Set<number>();
  for (const [i, pattern] of patterns.entries())
    await page.route(pattern, async (route) => {
      failed.add(i);
      await route.abort();
    });
  const diagram = {
    ...fixture,
    edges: fixture.edges.map((e) =>
      e.id === "jog"
        ? { id: e.id, from: e.from, to: e.to, relation: "config", props: { settings: [{ key: "Orders:Timeout" }] } }
        : e,
    ),
  };
  await seed(page, diagram as typeof fixture);
  await gotoCanvas(page, "kafka-order-pipeline");
  await expect.poll(() => failed.size).toBe(2);
  await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
  for (const pattern of patterns) await page.unroute(pattern);
  await page.getByTestId("lazy-load-retry").click();
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await expect(page.getByTestId("edge-glyph-jog")).toBeVisible();
});
