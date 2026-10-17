import type { Page } from "@playwright/test";
import { sheetRoutingFixture } from "../../src/lab/routingFixture";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  waitForStableViewport,
  pauseClock,
  STORAGE_KEYS,
  savedDiagram,
} from "./fixtures";

const key = "diagrams.inspector.width.v1";
const width = (page: Page) => page.getByTestId("inspector").evaluate((el) => el.getBoundingClientRect().width);
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), key);

test("a pointer release stays unsettled until its deferred reveal, preserving a note's double-click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram: textFieldsFixture,
  });
  await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
  await page.clock.install();
  await pauseClock(page);
  const note = page.getByTestId("annotation-n1");
  await note.click();
  await expect(note).toHaveClass(/is-selected/);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await note.dblclick();
  await expect(page.getByTestId("annotation-editor")).toBeFocused();
  await page.clock.runFor(32);
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
  await page.getByTestId("annotation-editor").fill("Updated note");
  await page.keyboard.press("Escape");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Escape");
  await page.clock.runFor(32); // Escape clears selection after React Flow's handler.
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
  await page.getByTestId("undo-button").click();
  // A toolbar command is not a diagram gesture: reveal its selection without advancing the clock.
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
});

async function open(page: Page, viewport = 1920, live = false, simulation?: string) {
  await page.setViewportSize({ width: viewport, height: 1000 });
  await page.addInitScript(({ storage, diagram }) => localStorage.setItem(storage, JSON.stringify(diagram)), {
    storage: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram: sheetRoutingFixture(),
  });
  if (live)
    await gotoLive(
      page,
      `./?view=canvas&example=kafka-order-pipeline&live=1&${simulation ? `sim=${simulation}` : "paused=1"}`,
    );
  else await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
  await page.getByTestId("node-kong").dblclick();
  await expect(page.getByTestId("routes-table")).toBeVisible();
  await waitForStableViewport(page);
}

test("drag uses the extra table space, captures the pointer and saves only at release", async ({ page }) => {
  await open(page, 1440);
  await expect.poll(() => width(page)).toBe(382);
  const original = await savedDiagram(page);
  const handle = page.getByTestId("inspector-resize");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 280, box.y + 140, { steps: 12 });
  await expect.poll(() => width(page)).toBeGreaterThan(650);
  expect(await stored(page)).toBeNull();
  expect(await handle.evaluate((el) => el.hasPointerCapture(1))).toBe(true);
  await page.mouse.up();
  await expect.poll(() => stored(page)).not.toBeNull();
  expect(await savedDiagram(page)).toEqual(original);
  for (const id of ["routes-rule-orders-match", "routes-rule-orders-targets"]) {
    const cell = page.getByTestId(id);
    await expect(cell).toHaveAttribute("title", /.+/);
    expect(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await expect(page.getByTestId("routes-rule-orders-match")).toHaveText("POST /v1/orders/reserve");
  await expect(page.getByTestId("routes-rule-orders-targets")).toHaveText("Orders, Orders canary");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-inspector-mode", "node");
});

test("keyboard steps, bounds, Enter reset and double-click reset", async ({ page }) => {
  await open(page);
  const handle = page.getByTestId("inspector-resize");
  await expect(handle).toHaveAttribute("role", "separator");
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  await handle.focus();
  await handle.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(525);
  await handle.press("Shift+ArrowRight");
  await expect.poll(() => width(page)).toBe(461);
  await handle.press("Home");
  await expect.poll(() => width(page)).toBe(300);
  await handle.press("End");
  expect(await width(page)).toBe(Number(await handle.getAttribute("aria-valuemax")));
  const pane = await page.getByTestId("canvas-wrap").boundingBox();
  expect(pane?.width).toBeGreaterThanOrEqual(480);
  await handle.press("Enter");
  await expect.poll(() => width(page)).toBe(509);
  expect(await stored(page)).toBeNull();
  await handle.press("ArrowLeft");
  await handle.dblclick();
  await expect.poll(() => width(page)).toBe(509);
  expect(await stored(page)).toBeNull();
});

test("choice survives reload, folding and selection modes; shrink clamps without losing it", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-resize").press("Home");
  await page.getByTestId("inspector-resize").press("Shift+ArrowLeft");
  await expect.poll(() => width(page)).toBe(364);
  await page.reload();
  await waitForStableViewport(page);
  await page.getByTestId("node-kong").dblclick();
  await expect.poll(() => width(page)).toBe(364);
  await page.getByTestId("inspector-toggle").click();
  await expect.poll(() => width(page)).toBe(52);
  await page.getByTestId("inspector-toggle").click();
  await expect.poll(() => width(page)).toBe(364);
  await page.getByTestId("inspector-resize").press("End");
  const chosen = await stored(page);
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect.poll(() => width(page)).toBeLessThanOrEqual(520);
  expect(await stored(page)).toBe(chosen);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect.poll(() => width(page)).toBe(Number(chosen));
});

test("default follows window resize and mobile keeps its original sheet and rail", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 2560, height: 1000 });
  await expect.poll(() => width(page)).toBe(640);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => width(page)).toBe(296);
  await expect(page.getByTestId("inspector-resize")).toBeHidden();
  await page.getByTestId("inspector-toggle").click();
  await expect.poll(() => width(page)).toBe(52);
  expect(await stored(page)).toBeNull();
});

test("narrow desktop keeps a readable legacy sheet instead of squeezing it below its minimum", async ({ page }) => {
  await open(page, 900);
  await expect.poll(() => width(page)).toBe(296);
  await expect(page.getByTestId("inspector-resize")).toBeHidden();
});

test("a completed resize keeps a fitted diagram in the canvas", async ({ page }) => {
  await open(page);
  await page.getByTestId("fit-view-button").click();
  await waitForStableViewport(page);
  await page.getByTestId("inspector-resize").press("End");
  await expect
    .poll(async () => {
      const pane = await page.getByTestId("canvas-wrap").boundingBox();
      if (!pane) throw new Error("Canvas is missing");
      const nodes = await Promise.all(
        ["app", "kong", "orders", "canary", "search"].map((id) => page.getByTestId(`node-${id}`).boundingBox()),
      );
      return nodes.every((node) => node && node.x >= pane.x && node.x + node.width <= pane.x + pane.width);
    })
    .toBe(true);
});

test("Live preserves its camera after an Inspector resize", async ({ page }) => {
  await open(page, 1920, true);
  await page.getByTestId("fit-view-button").click();
  await waitForStableViewport(page);
  await page.getByTestId("inspector-resize").press("End");
  await expect
    .poll(async () => {
      const pane = await page.getByTestId("canvas-wrap").boundingBox();
      if (!pane) throw new Error("Canvas is missing");
      const nodes = await Promise.all(
        ["app", "kong", "orders", "canary", "search"].map((id) => page.getByTestId(`node-${id}`).boundingBox()),
      );
      return nodes.every((node) => node && node.x >= pane.x && node.x + node.width <= pane.x + pane.width);
    })
    .toBe(true);
});

test("manual width stops at 960px on an ultrawide viewport and fields stay at 640px", async ({ page }) => {
  await open(page, 3440);
  await page.getByTestId("inspector-resize").press("End");
  await expect.poll(() => width(page)).toBe(960);
  expect(
    await page.getByTestId("inspector-field-label").evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(640);
});

test("an old saved width is clamped on load", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "2064"), key);
  await open(page, 3440);
  await expect.poll(() => width(page)).toBe(960);
  await expect(page.getByTestId("inspector-resize")).toHaveAttribute("aria-valuetext", "Inspector width, 960 pixels");
});

test("Enter resets the focused handle without continuing a waiting narration", async ({ page }) => {
  await open(page, 1920, true, "inspector-note");
  const note = page.getByTestId("live-note-continue");
  await expect(note).toBeVisible();
  const handle = page.getByTestId("inspector-resize");
  await handle.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(525);
  await handle.press("Enter");
  await expect.poll(() => width(page)).toBe(509);
  await expect(note).toBeVisible();
});

test("slow motion leaves the focused resize handle's arrow keys alone", async ({ page }) => {
  await open(page, 1920, true);
  await page.getByTestId("node-app").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
  await page.getByTestId("live-play").click();
  const handle = page.getByTestId("inspector-resize");
  await handle.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(525);
  await handle.press("Shift+ArrowRight");
  await expect.poll(() => width(page)).toBe(461);
});

test("drag frames finish geometry reads before writing the sheet width", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector").evaluate((sheet) => {
    let dirty = false;
    let lateReads = 0;
    const rect = Element.prototype.getBoundingClientRect;
    const set = CSSStyleDeclaration.prototype.setProperty;
    sheet.setAttribute("data-late-reads", "0");
    Element.prototype.getBoundingClientRect = function () {
      if (dirty && this.parentElement === sheet.parentElement) {
        sheet.setAttribute("data-late-reads", String(++lateReads));
      }
      return rect.call(this);
    };
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (this === sheet.style && name === "--sheet-width") {
        dirty = true;
        queueMicrotask(() => {
          dirty = false;
        });
      }
      set.call(this, name, value, priority);
    };
  });
  const handle = page.getByTestId("inspector-resize");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is missing");
  await page.mouse.move(box.x + 4, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + 150, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => width(page)).toBeGreaterThan(700);
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-late-reads", "0");
});

test("cancelled pointer resize restores the previous choice", async ({ page }) => {
  await open(page);
  const handle = page.getByTestId("inspector-resize");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is missing");
  await page.mouse.move(box.x + 4, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + 150);
  await expect.poll(() => width(page)).toBeGreaterThan(600);
  await handle.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(509);
  expect(await stored(page)).toBeNull();
});

test("node, edge, boundary, diagram and simulation sections share the chosen width", async ({ page }) => {
  await open(page);
  const sheet = page.getByTestId("inspector");
  await page.getByTestId("inspector-resize").press("Home");
  await page.getByTestId("inspector-resize").press("Shift+ArrowLeft");
  await page.getByTestId("inspector-section-node-simulation").click();
  await expect.poll(() => width(page)).toBe(364);
  await page.getByTestId("edge-label-app-kong").dblclick();
  await expect(sheet).toHaveAttribute("data-inspector-mode", "edge");
  await expect.poll(() => width(page)).toBe(364);
  await page.getByTestId("group-label-api").dblclick();
  await expect(sheet).toHaveAttribute("data-inspector-mode", "boundary");
  await expect.poll(() => width(page)).toBe(364);
  await page.getByTestId("canvas-wrap").click({ position: { x: 15, y: 700 } });
  await expect(sheet).toHaveAttribute("data-inspector-mode", "diagram");
  await expect.poll(() => width(page)).toBe(364);
});

test("right-to-left layout resizes from its canvas-facing edge", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  const handle = page.getByTestId("inspector-resize");
  await handle.press("ArrowRight");
  await expect.poll(() => width(page)).toBe(525);
  await handle.press("Shift+ArrowLeft");
  await expect.poll(() => width(page)).toBe(461);
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is missing");
  await page.mouse.move(box.x + 4, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 104, box.y + 150);
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(561);
});
