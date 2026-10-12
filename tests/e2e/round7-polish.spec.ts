import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Round 7 of the UX review (docs/DESIGN-REVIEW.md): Esc on a clicked node, toasts inside the canvas
// pane, live view refitting around the AI panel, readable hover cards, a shorter canvas menu, the
// start card's one row of actions, and slow motion keeping the hop at work out from under the trace card.

const KAFKA = "kafka-order-pipeline";
const AKS = "aks-app-config-key-vault";

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, testId: string): Promise<Box> => {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`No box for ${testId}`);
  return b;
};
const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;

async function openAiPanel(page: Page) {
  await page.getByTestId("ai-rail-open").click();
  await expect(page.getByTestId("ai-dock")).toBeVisible({ timeout: 20_000 });
}

/** Every diagram node lies inside the canvas pane. */
async function allNodesInPane(page: Page) {
  const pane = await box(page, "canvas-wrap");
  const nodes = page.getByTestId(/^node-(?!tooltip$|editor-|pips-|pip-|dependenc)/);
  const n = await nodes.count();
  for (let i = 0; i < n; i++) {
    const b = await nodes.nth(i).boundingBox();
    if (b && !inside(b, pane)) return false;
  }
  return n > 0;
}

test("Esc clears the selection of a node that was just clicked", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, KAFKA);
  const node = page.getByTestId("node-payments");
  await node.click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  // And again with several selected.
  await node.click();
  await page.getByTestId("node-inventory").click({ modifiers: ["Control"] });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

for (const width of [1024, 1440]) {
  test(`at ${width}px with the AI panel open, a toast stays in the canvas pane, clear of the dock and minimap`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 800 });
    await gotoCanvas(page, KAFKA);
    await openAiPanel(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-share-link").click();
    const toast = page.getByTestId("toast");
    await expect(toast).toBeVisible();
    await expect.poll(async () => inside(await box(page, "toast"), await box(page, "canvas-wrap"))).toBe(true);
    expect(apart(await box(page, "toast"), await box(page, "ai-dock"))).toBe(true);
    if (await page.getByTestId("canvas-minimap").isVisible())
      expect(apart(await box(page, "toast"), await box(page, "canvas-minimap"))).toBe(true);
  });
}

test("below 1680px the AI panel folds the stencils to their rail; opening them by hand wins", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, KAFKA);
  await expect(page.getByTestId("palette-search")).toBeVisible();
  await openAiPanel(page);
  await expect(page.getByTestId("palette-search")).toHaveCount(0);
  await page.getByTestId("palette-toggle").click();
  await expect(page.getByTestId("palette-search")).toBeVisible();
});

test("live view with a trace refits when the AI panel opens: every node stays in the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-trace-message").click();
  await page.getByTestId("live-more-menu").getByText("Next message", { exact: true }).click();
  await expect(page.getByTestId("trace-card")).toBeVisible();
  await expect.poll(() => allNodesInPane(page)).toBe(true);
  await openAiPanel(page);
  await expect.poll(() => allNodesInPane(page), { timeout: 5000 }).toBe(true);
});

test("hover cards read at their size at a small fit: settings, and the dependency list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, AKS);
  await page.getByTestId("edge-label-api-to-appcfg").hover();
  const row = page.getByTestId("edge-setting-api-to-appcfg-0");
  await expect(row).toBeVisible();
  // 11 px type: a row at least 13 px tall on screen (it was 6 px at this fit).
  expect((await box(page, "edge-setting-api-to-appcfg-0")).height).toBeGreaterThanOrEqual(13);

  await page.mouse.move(5, 500);
  await page.getByTestId("view-button").click();
  await page.getByTestId("dependencies-toggle").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("node-pips-api").hover();
  await expect(page.getByTestId("node-dependencies-api")).toBeVisible();
  // One line per dependency (each word wrapped onto its own line before).
  for (let i = 0; i < 3; i++) {
    const b = await box(page, `node-dependency-api-${i}`);
    expect(b.height).toBeGreaterThanOrEqual(13);
    expect(b.height).toBeLessThan(24);
  }
  await expect(page.getByTestId("node-dependency-api-0")).toHaveText("Config · orders-config");
});

test("the canvas right-click leaves out what the canvas controls already do", async ({ page }) => {
  await gotoCanvas(page, KAFKA);
  const wrap = await box(page, "canvas-wrap");
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 120, y: wrap.height - 260 } });
  await expect(page.getByTestId("context-menu-item-canvas.add-node")).toBeVisible();
  for (const id of ["canvas.undo", "canvas.redo", "canvas.shortcuts", "canvas.fit"])
    await expect(page.getByTestId(`context-menu-item-${id}`)).toHaveCount(0);
  // Check diagram joined Auto-layout's section: 10 of the 12-row budget.
  await expect(page.getByTestId("context-menu").getByRole("menuitem")).toHaveCount(10);
});

test("the start card keeps one row of actions, clear of the canvas controls with the AI panel open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  const rows = async () => {
    const ys = await Promise.all(["start-blank", "start-open"].map((t) => box(page, t)));
    return new Set(ys.map((b) => Math.round(b.y))).size;
  };
  // Polled: the card slides in.
  await expect.poll(rows).toBe(1);
  await expect(page.getByTestId("start-paste")).toBeVisible();
  await openAiPanel(page);
  await expect.poll(rows).toBe(1);
  await expect.poll(async () => apart(await box(page, "start-card"), await box(page, "canvas-controls"))).toBe(true);
});

test("slow motion keeps the hop at work out from under the trace card", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-trace-message").click();
  await page.getByTestId("live-more-menu").getByText("Next message, in slow motion").click();
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing", { timeout: 15_000 });
  let checked = 0;
  for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(250);
    if ((await page.getByTestId("live-canvas").getAttribute("data-slowmo")) !== "playing") break;
    const current = page.getByTestId("trace-row-current");
    const id = await current.getAttribute("data-node").catch(() => null);
    if (!id) continue;
    const node = await page.getByTestId(`node-${id}`).boundingBox();
    const card = await page.getByTestId("trace-card").boundingBox();
    if (!node || !card) continue;
    checked++;
    expect(apart(node, card), `${id} under the trace card`).toBe(true);
  }
  expect(checked).toBeGreaterThan(5);
});
