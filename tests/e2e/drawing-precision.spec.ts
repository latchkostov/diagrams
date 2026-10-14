import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  waitForStableViewport,
  viewportTransform,
  STORAGE_KEYS,
} from "./fixtures";

// Drawing precision (docs/research/drawing-ux.md, batch 2): smart guides, equal spacing and grid-true
// nudges (D6), and one set of text-editing rules with type-ahead and a preloaded palette (D7).
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/**
 * A small diagram with known geometry (cards 220 × 72 at these short labels): a and b in a row 180 apart,
 * inside the "core" boundary; c below a, to drag; d off the grid, to nudge; an edge with a label; a
 * note, a zone and a text.
 */
const SEED = {
  format: "diagrams/v1",
  title: "Precision",
  nodes: [
    { id: "a", stencil: "client.browser", label: "Ingest", x: 0, y: 0, group: "core" },
    { id: "b", stencil: "client.browser", label: "Store", x: 400, y: 0, group: "core" },
    { id: "c", stencil: "client.browser", label: "Worker", x: 0, y: 300 },
    { id: "d", stencil: "client.browser", label: "Odd", x: 1003, y: 307 },
  ],
  groups: [{ id: "core", label: "Core", tone: "neutral", x: -40, y: -60, width: 740, height: 180 }],
  edges: [{ id: "ab", from: "a", to: "b", kind: "async", label: "writes" }],
  annotations: [
    { id: "n1", kind: "note", text: "A note", x: 0, y: 520, width: 220, height: 96 },
    { id: "z1", kind: "zone", text: "Zone", x: 400, y: 480, width: 300, height: 200 },
    { id: "t1", kind: "text", text: "Caption", x: 0, y: 720, width: 220, height: 44 },
  ],
};

async function seed(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(SEED)] as const,
  );
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-c")).toBeVisible();
  await waitForStableViewport(page);
}

type Box = { x: number; y: number; width: number; height: number };
async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function view(page: Page) {
  const t = await viewportTransform(page);
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
  if (!m) throw new Error(`Unexpected transform: ${t}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** A node's position in flow coordinates (its React Flow wrapper's translate). */
async function flowPos(page: Page, testId: string) {
  const t = await page
    .getByTestId(testId)
    .evaluate((el) => (el.closest(".react-flow__node") as HTMLElement | null)?.style.transform ?? "");
  const m = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(t);
  if (!m) throw new Error(`Unexpected node transform: ${t}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

const guides = (page: Page) => page.getByTestId("smart-guides");

/**
 * Presses on a node and drags it by a flow-space offset: quickly most of the way, then slowly (guides
 * engage once the pointer slows down), then rests. Ctrl/Cmd is held for the slow part when `free`.
 * The button stays down: the caller releases it.
 */
async function dragBy(page: Page, testId: string, dx: number, dy: number, free = false) {
  const { zoom } = await view(page);
  const press = centre(await box(page.getByTestId(testId)));
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  // A first small move starts the drag (React Flow counts the offset from where the drag starts).
  const from = { x: press.x + 3, y: press.y };
  await page.mouse.move(from.x, from.y);
  const to = { x: from.x + dx * zoom, y: from.y + dy * zoom };
  const at = (t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const near = at(0.85);
  await page.mouse.move(near.x, near.y, { steps: 8 });
  if (free) await page.keyboard.down(MOD);
  for (const t of [0.9, 0.95, 0.98, 1]) {
    const p = at(t);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(40);
  }
  // Rest: the guides catch up with a pointer that has stopped.
  await page.waitForTimeout(200);
}

async function release(page: Page, free = false) {
  await page.mouse.up();
  if (free) await page.keyboard.up(MOD);
}

test.describe("smart guides and snapping (D6)", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("guides appear while dragging near an alignment, and the drop snaps to it", async ({ page, consoleErrors }) => {
    await expect(guides(page)).toBeHidden();
    // c's left edge comes within a few px of b's left edge (x 400), well below the row.
    await dragBy(page, "node-c", 404, -147);
    await expect(guides(page)).toBeVisible();
    await expect(guides(page)).toHaveAttribute("data-lines", /^[1-9]/);
    await expect(guides(page)).toHaveAttribute("data-axes", /x/);
    // The guide is drawn over the flow, never inside the viewport an export renders.
    expect(await guides(page).evaluate((el) => !!el.closest(".react-flow__viewport"))).toBe(false);
    await release(page);
    await expect(guides(page)).toBeHidden();
    // Snapped onto b's edge on x; nothing near on y, so the 10 px grid.
    await expect.poll(() => flowPos(page, "node-c")).toEqual({ x: 400, y: 150 });
    // One undo step back to where it started.
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => flowPos(page, "node-c")).toEqual({ x: 0, y: 300 });
    expectNoErrors(consoleErrors);
  });

  test("Ctrl/Cmd held during a drag turns snapping off", async ({ page, consoleErrors }) => {
    await dragBy(page, "node-c", 404, -147, true);
    await expect(guides(page)).toHaveAttribute("data-lines", "0");
    await release(page, true);
    const p = await flowPos(page, "node-c");
    // Neither the guide (400) nor the grid (150): where the pointer put it.
    expect(Math.abs(p.x - 404)).toBeLessThan(1.5);
    expect(Math.abs(p.y - 153)).toBeLessThan(1.5);
    expect(p.x).not.toBe(400);
    expectNoErrors(consoleErrors);
  });

  test("equal spacing: the drag snaps one gap past the row, and shows both gaps", async ({ page, consoleErrors }) => {
    // a (0..220) and b (400..620) are 180 apart: the next spot in the row starts at 800.
    await dragBy(page, "node-c", 803, -297);
    await expect(guides(page)).toHaveAttribute("data-gaps", "2");
    await release(page);
    await expect.poll(() => flowPos(page, "node-c")).toEqual({ x: 800, y: 0 });
    expectNoErrors(consoleErrors);
  });

  test("a boundary's members follow it, snapped by the same amount", async ({ page, consoleErrors }) => {
    const before = await flowPos(page, "node-a");
    const groupBefore = await flowPos(page, "group-label-core");
    await dragBy(page, "group-label-core", 23, 33);
    await release(page);
    const after = await flowPos(page, "node-a");
    const groupAfter = await flowPos(page, "group-label-core");
    expect({ x: groupAfter.x - groupBefore.x, y: groupAfter.y - groupBefore.y }).toEqual({
      x: after.x - before.x,
      y: after.y - before.y,
    });
    // a and b moved exactly as far as the boundary (snapped: whole pixels).
    const d = { x: after.x - before.x, y: after.y - before.y };
    expect(Number.isInteger(d.x) && Number.isInteger(d.y)).toBe(true);
    expect(d).not.toEqual({ x: 0, y: 0 });
    expect(await flowPos(page, "node-b")).toEqual({ x: 400 + d.x, y: d.y });
    expectNoErrors(consoleErrors);
  });

  test("Alt-dragging a multi-selection by its frame copies it exactly once", async ({ page, consoleErrors }) => {
    const nodes = page.getByTestId(/^node-(?!tooltip$|editor)/);
    const before = await nodes.count();
    const { zoom } = await view(page);
    const a = await box(page.getByTestId("node-a"));
    const b = await box(page.getByTestId("node-b"));
    // The selection box over a and b (it picks what it touches), started on the empty pane above them (clear
    // of the boundary's name chip, which would drag the boundary).
    await page.mouse.move(a.x + a.width - 10, a.y - 15);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, a.y + 20, { steps: 6 });
    await page.mouse.up();
    // Between the two cards, inside the selection's frame and on neither card.
    const grip = { x: (a.x + a.width + b.x) / 2, y: a.y + 6 };
    const onCard = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid^="node-"]'),
      grip,
    );
    expect(onCard).toBe(false);
    await page.keyboard.down("Alt");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 3, grip.y + 3);
    await page.mouse.move(grip.x + 3, grip.y + 200 * zoom, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    // Two copies (a and b), each id once; the originals stay where they were.
    await expect(nodes).toHaveCount(before + 2);
    const ids = await nodes.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(new Set(ids).size).toBe(ids.length);
    expect(await flowPos(page, "node-a")).toEqual({ x: 0, y: 0 });
    expect(await flowPos(page, "node-b")).toEqual({ x: 400, y: 0 });
    expectNoErrors(consoleErrors);
  });

  test("arrow keys nudge onto the grid: 10 px, Shift 50 px; with Snapping off 1 px", async ({
    page,
    consoleErrors,
  }) => {
    await page.getByTestId("node-d").click();
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1003, y: 307 });
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1010, y: 307 });
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1020, y: 307 });
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1070, y: 307 });
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1070, y: 300 });
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1070, y: 350 });

    // Show ▸ Snapping off: fine steps.
    const wrap = await box(page.getByTestId("canvas-wrap"));
    await page.mouse.click(wrap.x + wrap.width / 2, wrap.y + 40, { button: "right" });
    await page.getByTestId("context-menu-item-canvas.view-options").click();
    await expect(page.getByTestId("context-menu-item-view:snap")).toContainText("Snapping");
    await page.getByTestId("context-menu-item-view:snap").click();
    await page.getByTestId("node-d").click();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1071, y: 350 });
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(() => flowPos(page, "node-d")).toEqual({ x: 1061, y: 350 });
    expectNoErrors(consoleErrors);
  });
});

test.describe("no guides outside editing", () => {
  test("presentation and live view have no guide layer, and an export never shows one", async ({ page }, info) => {
    test.slow(); // the export embeds fonts
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    await expect(guides(page)).toHaveCount(1);
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(guides(page)).toHaveCount(0);
    await page.getByTestId("present-exit").click();
    await expect(guides(page)).toHaveCount(1);
    await page.getByTestId("canvas-wrap").press("l");
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(guides(page)).toHaveCount(0);
    await page.getByTestId("canvas-wrap").press("l");
    await expect(guides(page)).toHaveCount(1);

    // A drag leaves nothing behind for the export.
    await dragBy(page, "node-metrics", 3, 40);
    await release(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await expect(page.getByTestId("image-dialog")).toBeVisible();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("image-export").click(),
    ]);
    const file = info.outputPath("after-drag.svg");
    await download.saveAs(file);
    const svg = readFileSync(file, "utf8");
    expect(svg).toContain("Order service");
    expect(svg).not.toContain("smart-guides");
  });
});

test.describe("one set of text-editing rules (D7)", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("Esc is done with a node's name, and Ctrl+Z takes it back", async ({ page, consoleErrors }) => {
    await page.getByTestId("node-c").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await page.keyboard.type("Renamed");
    await page.keyboard.press("Escape");
    await expect(label).not.toBeFocused();
    await expect(page.getByTestId("node-c")).toContainText("Renamed");
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId("node-c")).toContainText("Worker");
    await expect(page.getByTestId("node-c")).not.toContainText("Renamed");
    expectNoErrors(consoleErrors);
  });

  test("Esc is done with an edge label, a boundary name and an annotation's text; Ctrl+Z takes each back", async ({
    page,
    consoleErrors,
  }) => {
    // An edge and a boundary are named in the inspector; an annotation's text is edited in place.
    const cases: { open: string; field: string; shown: string; was: string }[] = [
      { open: "edge-label-ab", field: "inspector-field-label", shown: "edge-label-ab", was: "writes" },
      { open: "group-label-core", field: "inspector-field-label", shown: "group-label-core", was: "Core" },
      { open: "annotation-n1", field: "annotation-editor", shown: "annotation-text-n1", was: "A note" },
      { open: "annotation-label-z1", field: "annotation-editor", shown: "annotation-label-z1", was: "Zone" },
      { open: "annotation-t1", field: "annotation-editor", shown: "annotation-text-t1", was: "Caption" },
    ];
    for (const c of cases) {
      await page.getByTestId(c.open).dblclick();
      await expect(page.getByTestId(c.field)).toBeFocused();
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.type(`New ${c.was}`);
      await page.keyboard.press("Escape");
      if (c.field === "annotation-editor") await expect(page.getByTestId(c.field)).toHaveCount(0);
      else await expect(page.getByTestId(c.field)).not.toBeFocused();
      await expect(page.getByTestId(c.shown)).toContainText(`New ${c.was}`);
      await page.keyboard.press(`${MOD}+z`);
      await expect(page.getByTestId(c.shown)).toHaveText(c.was);
    }
    expectNoErrors(consoleErrors);
  });

  test("Enter names the selection in the inspector; Tab goes from Label to Subtitle; Enter is done", async ({
    page,
    consoleErrors,
  }) => {
    const label = page.getByTestId("inspector-field-label");
    await page.getByTestId("node-c").click();
    await page.keyboard.press("Enter");
    await expect(label).toBeFocused();
    await page.keyboard.type("Queue worker");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-sublabel")).toBeFocused();
    await page.keyboard.type("jobs.v1");
    await page.keyboard.press("Shift+Tab");
    await expect(label).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(label).not.toBeFocused();
    await expect(page.getByTestId("node-c")).toContainText("Queue worker");
    await expect(page.getByTestId("node-c")).toContainText("jobs.v1");
    // Focus is back on the node: Enter names it again, and Enter is done.
    await page.keyboard.press("Enter");
    await expect(label).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(label).not.toBeFocused();

    // An edge: Enter names it too.
    await page.getByTestId("edge-label-ab").click();
    await page.keyboard.press("Enter");
    await expect(label).toBeFocused();
    await page.keyboard.type("stores");
    await page.keyboard.press("Enter");
    await expect(label).not.toBeFocused();
    await expect(page.getByTestId("edge-label-ab")).toHaveText("stores");

    // A text holds several lines: Enter adds one, Ctrl/Cmd+Enter saves; Tab saves too.
    await page.getByTestId("annotation-t1").dblclick();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await expect(page.getByTestId("annotation-editor")).toHaveValue("Caption\nsecond line");
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await page.getByTestId("annotation-t1").dblclick();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("annotation-text-t1")).toHaveText("Caption\nsecond line");
    expectNoErrors(consoleErrors);
  });
});

test.describe("type-ahead and readable editors (D7)", () => {
  test("Ctrl+K buffers typing while the palette chunk is pending", async ({ page, consoleErrors }) => {
    // The palette's code is held until the test lets it go: every key below is typed before its search exists.
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let intercepted = false;
    await page.route(/PaletteDialog/, async (route) => {
      intercepted = true;
      await gate;
      await route.continue();
    });
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-orders")).toBeVisible();
    await page.keyboard.press(`${MOD}+k`);
    await expect.poll(() => intercepted).toBe(true);
    await expect(page.getByTestId("command-input")).toHaveCount(0);
    await page.keyboard.type("kafka topic", { delay: 25 });
    await expect(page.getByTestId("command-input")).toHaveCount(0);
    release();
    await expect(page.getByTestId("command-input")).toHaveValue("kafka topic");
    // Nothing reached the canvas: "t" would have added a text.
    await expect(page.getByTestId(/^annotation-/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("enlarged editors stay inside the canvas at its edge", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    // A note to edit too (it opens its editor at once).
    await page.getByTestId("palette-annotate-note").click();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.type("Edge case");
    await page.keyboard.press("Escape");
    // Only an annotation's text is edited on the canvas (a node, an edge and a boundary are named in the inspector).
    const cases: { target: string; field: string }[] = [{ target: "annotation-note-1", field: "annotation-editor" }];
    for (const c of cases) {
      // Select it first: the inspector opens (and the canvas narrows) before the view moves.
      await page.getByTestId(c.target).click();
      await waitForStableViewport(page);
      // Pan it against the canvas's right edge.
      const pane = await box(page.getByTestId("rf__wrapper"));
      const t = await box(page.getByTestId(c.target));
      await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height - 30);
      await page.mouse.wheel(t.x + t.width - (pane.x + pane.width - 6), 0);
      await waitForStableViewport(page);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId(c.field)).toBeVisible();
      const r = await box(page.getByTestId(c.field));
      const p = await box(page.getByTestId("rf__wrapper"));
      expect(r.x, `${c.target}: left`).toBeGreaterThanOrEqual(p.x);
      expect(r.x + r.width, `${c.target}: right`).toBeLessThanOrEqual(p.x + p.width);
      expect(r.y + r.height, `${c.target}: bottom`).toBeLessThanOrEqual(p.y + p.height);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(c.field)).toHaveCount(0);
    }
    expectNoErrors(consoleErrors);
  });

  test("a note's editor reads at 12 px or more on screen at the fitted zoom", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    expect((await view(page)).zoom).toBeLessThan(0.75);
    const screenFont = (l: Locator) =>
      l.evaluate((el: HTMLElement) => {
        const scale = el.getBoundingClientRect().width / el.offsetWidth;
        return parseFloat(getComputedStyle(el).fontSize) * scale;
      });
    // A new note opens its editor at once.
    await page.getByTestId("palette-annotate-note").click();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    expect(await screenFont(page.getByTestId("annotation-editor"))).toBeGreaterThanOrEqual(12);
    expectNoErrors(consoleErrors);
  });
});
