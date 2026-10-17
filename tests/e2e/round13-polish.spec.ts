import type { Page } from "@playwright/test";
import { settledCanvas } from "../parity/browser/canvas";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  pageLoadTimeout,
  pauseClock,
  shareVia,
  waitForStableBox,
  waitForSelectionSettled,
  fitDiagram,
} from "./fixtures";
import {
  callTool,
  installFakeLanguageModel,
  installFakeModelContext,
  MOD,
  openAdvanced,
  openAiPanel,
} from "./ai-helpers";

// Round 13 of the UX review (docs/DESIGN-REVIEW.md): quick-add names what it adds, an Undo toast goes when
// something else undoes, the AI panel's foot leaves the conversation room, Shift+box adds to the selection,
// Ctrl+K finds Present, and focus stays put (Esc on a node, presenting, a password link's Done).

const KAFKA = "kafka-order-pipeline";
/** Longer than the history's debounce (350 ms) plus its merge window (1.5 s): naming after it used to split. */
const NAMING_PAUSE = 2_500;

type Box = { x: number; y: number; width: number; height: number };
async function box(page: Page, testId: string): Promise<Box> {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`No box for ${testId}`);
  return b;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inside = (p: { x: number; y: number }, b: Box) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** The selected nodes and edges, by test id (as structure-bulk.spec.ts reads them). */
async function selectedIds(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-testid]")) {
      const id = el.dataset.testid ?? "";
      if (/^node-(?!tooltip$|editor)/.test(id) && el.closest(".react-flow__node")?.classList.contains("selected"))
        out.push(id);
      if (/^edge-(?!label-|glyph-|settings?-)/.test(id) && el.classList.contains("is-selected")) out.push(id);
    }
    return out.sort();
  });
}

/** A selection box from one corner to the other, Shift held if asked. */
async function drawBox(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}
/** A box around one node, starting just outside its top-left corner. */
async function boxAround(page: Page, testId: string, shift = false) {
  await waitForSelectionSettled(page);
  // A selection pan keeps its target visible, but can leave this unrelated node at the pane's edge.
  // Fit before measuring so the box's starting corner is on canvas too.
  await fitDiagram(page);
  const n = await box(page, testId);
  await drawBox(page, { x: n.x - 14, y: n.y - 14 }, { x: n.x + n.width + 6, y: n.y + n.height + 14 }, shift);
}

test("double-click quick-add opens the new node's name: typing names it, never reaching the canvas's keys", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("./?view=canvas");
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("canvas-empty")).toBeVisible({ timeout: pageLoadTimeout() });
  const wrap = await box(page, "canvas-wrap");
  await page.mouse.dblclick(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2);
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.type("postgres");
  await page.keyboard.press("Enter");
  // The name is selected, ready to type over. "Ledger" has an L (Go live) and a T would add text: neither fires.
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  // Take a while: the node's step has long been recorded, and naming still joins it (a creation transaction).
  await page.clock.install();
  await pauseClock(page);
  await page.clock.runFor(NAMING_PAUSE);
  await page.keyboard.type("Ledger tables");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-postgres-1")).toContainText("Ledger tables");
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await expect(page.getByTestId("inspector-field-label")).not.toBeFocused();
  // The node and its name are one undo step.
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId("node-postgres-1")).toHaveCount(0);
  // And one redo brings both back.
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(page.getByTestId("node-postgres-1")).toContainText("Ledger tables");
  expectNoErrors(consoleErrors);
});

test("Alt+arrow: the node, its connection and both names are one undo step, however long the naming takes", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-dashboard").click();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.type("redis cache");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.clock.install();
  await pauseClock(page);
  await page.clock.runFor(NAMING_PAUSE);
  await page.keyboard.type("Ops cache");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("inspector-field-connection")).toBeFocused();
  await page.clock.runFor(NAMING_PAUSE);
  await page.keyboard.type("Cache panels");
  await page.keyboard.press("Enter");
  const made = page.getByTestId(/^node-cache-\d+$/);
  await expect(made).toContainText("Ops cache");
  await expect(page.getByTestId(/^edge-label-/).filter({ hasText: "Cache panels" })).toHaveCount(1);
  await page.keyboard.press(`${MOD}+z`);
  await expect(made).toHaveCount(0);
  await expect(page.getByTestId(/^edge-label-/).filter({ hasText: "Cache panels" })).toHaveCount(0);
  await expect(page.getByTestId("node-dashboard")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Ctrl+K Add, then Enter: naming the new node later still joins the step that added it", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-dashboard").click();
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.type("add redis cache");
  await expect(page.getByTestId("command-item-stencil:redis.cache")).toBeVisible();
  await page.keyboard.press("Enter");
  const made = page.getByTestId(/^node-cache-\d+$/);
  await expect(made).toBeVisible();
  // The new node has focus: Enter opens its name, after a while.
  await page.clock.install();
  await pauseClock(page);
  await page.clock.runFor(NAMING_PAUSE);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.type("Ops cache");
  await page.keyboard.press("Enter");
  await expect(made).toContainText("Ops cache");
  await page.keyboard.press(`${MOD}+z`);
  await expect(made).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("an edit between adding a node and naming it keeps the name a step of its own", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-dashboard").click();
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.type("add redis cache");
  await expect(page.getByTestId("command-item-stencil:redis.cache")).toBeVisible();
  await page.keyboard.press("Enter");
  const made = page.getByTestId(/^node-cache-\d+$/);
  await expect(made).toBeVisible();
  // Nudge it (an edit), then name it.
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ops cache");
  await page.keyboard.press("Enter");
  await expect(made).toContainText("Ops cache");
  await page.keyboard.press(`${MOD}+z`);
  await expect(made).toBeVisible();
  await expect(made).not.toContainText("Ops cache");
  expectNoErrors(consoleErrors);
});

test("an Undo toast goes because Ctrl+Z undoes, long before it would expire, and the node is back in its boundary", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // A page clock (it runs in step with real time until paused), so the toast's expiry can be held off below.
  await page.clock.install();
  await gotoCanvas(page, KAFKA);
  await settledCanvas(page);
  // Drag Payments service out of its boundary: the toast says so, with Undo. (Once the opening fit has finished:
  // measured while the view still moves, the drag starts beside the node and moves nothing.)
  await waitForStableBox(page.getByTestId("node-payments"));
  const p = await box(page, "node-payments");
  expect(inside(centre(p), await box(page, "group-aks"))).toBe(true);
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2 + 40, p.y + p.height / 2 + 60, { steps: 6 });
  await page.mouse.move(p.x + p.width / 2 + 60, p.y + p.height / 2 + 170, { steps: 12 });
  await page.mouse.up();
  // An action toast lasts 6 s. Stop the page's clock at the drop, so its expiry can't fire however slow the run,
  // then move it on just enough for the edit to settle into the history (350 ms). The toast is still there,
  // frozen: if it goes after Ctrl+Z, Ctrl+Z took it. Logic, not a race against the 6 s.
  await pauseClock(page);
  await page.clock.runFor(500);
  await expect(page.getByTestId("membership-undo")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("left AKS");
  expect(inside(centre(await box(page, "node-payments")), await box(page, "group-aks"))).toBe(false);
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await page.clock.resume();
  await expect
    .poll(async () => inside(centre(await box(page, "node-payments")), await box(page, "group-aks")))
    .toBe(true);
  expectNoErrors(consoleErrors);
});

test("with Advanced open under the on-device box, the AI panel's foot leaves the conversation its room", async ({
  page,
  consoleErrors,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFakeModelContext(page);
  await installFakeLanguageModel(page);
  await gotoCanvas(page, KAFKA);
  await openAiPanel(page);
  // The case that broke: the on-device box mounted (it loads lazily, with no fallback) under the conversation.
  await expect(page.getByTestId("ai-ondevice")).toBeVisible();
  await expect(page.getByTestId("ai-foot")).toBeVisible();
  const res = await callTool(page, "edit_diagram", {
    summary: "Added a billing worker",
    ops: [
      { op: "add_node", kind: "Go service", label: "billing-worker", key: "w" },
      { op: "connect", from: "payments", to: "w" },
    ],
  });
  expect(res.isError).toBe(false);
  await expect(page.getByTestId("ai-turn-0-summary")).toBeVisible();
  await openAdvanced(page);
  await expect(page.getByTestId("ai-ondevice")).toBeAttached();
  const panel = await box(page, "ai-panel");
  // The foot (on-device box, status, Advanced) stops at 60% of the panel and scrolls inside past that.
  await expect.poll(async () => (await box(page, "ai-foot")).height).toBeLessThanOrEqual(panel.height * 0.6 + 1);
  const body = () =>
    page.getByTestId("ai-history").evaluate((el) => el.parentElement?.getBoundingClientRect().height ?? 0);
  await expect.poll(body).toBeGreaterThan(panel.height * 0.3);
  // The turn stays readable, and Advanced's last control is still reachable (the foot scrolls to it).
  await expect(page.getByTestId("ai-turn-0-summary")).toBeInViewport();
  await page.getByTestId("ai-apply").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("ai-apply")).toBeInViewport();
  await expect(page.getByTestId("ai-turn-0-summary")).toBeInViewport();
  expectNoErrors(consoleErrors);
});

test.describe("Shift+box adds to the selection", () => {
  test("it adds the box's pick to the selection, and a plain box replaces it", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("node-schemas").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    // Measured once the inspector has opened (the pane is narrower then).
    await boxAround(page, "node-shopper", true);
    await expect.poll(() => selectedIds(page)).toEqual(["node-schemas", "node-shopper"]);
    await boxAround(page, "node-schemas");
    await expect.poll(() => selectedIds(page)).toEqual(["node-schemas"]);
    expectNoErrors(consoleErrors);
  });

  for (const width of [1280, 1440])
    for (const sheetWidth of [null, 672])
      test(`Shift box preserves a selected edge (${width}px, sheet: ${sheetWidth ?? "default"})`, async ({
        page,
        consoleErrors,
      }) => {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
        if (sheetWidth !== null)
          await page.addInitScript((w) => localStorage.setItem("diagrams.inspector.width.v1", String(w)), sheetWidth);
        await gotoCanvas(page, KAFKA);
        await page.getByTestId("edge-label-order-events-to-payments").click();
        await expect.poll(() => selectedIds(page)).toEqual(["edge-order-events-to-payments"]);
        await boxAround(page, "node-shopper", true);
        await expect.poll(() => selectedIds(page)).toEqual(["edge-order-events-to-payments", "node-shopper"]);
        expectNoErrors(consoleErrors);
      });

  test("Shift box selects edges between old and newly selected nodes", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("node-shopper").click();
    await expect.poll(() => selectedIds(page)).toEqual(["node-shopper"]);
    await boxAround(page, "node-gateway", true);
    await expect.poll(() => selectedIds(page)).toEqual(["edge-shopper-to-gateway", "node-gateway", "node-shopper"]);
    expectNoErrors(consoleErrors);
  });

  test("a Shift-drag that adds nothing keeps the selection and its frame", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, KAFKA);
    await settledCanvas(page);
    const top = await box(page, "node-schemas");
    const bottom = await box(page, "node-order-events");
    // A plain box around the two stacked nodes: React Flow frames the pick (drag it, right-click it).
    await drawBox(
      page,
      { x: top.x - 14, y: top.y - 14 },
      { x: bottom.x + bottom.width + 6, y: bottom.y + bottom.height + 6 },
    );
    await expect.poll(() => selectedIds(page)).toEqual(["node-order-events", "node-schemas"]);
    // Re-measured once the view rests: the selection opened the inspector, which may pan.
    await waitForSelectionSettled(page);
    const a = await box(page, "node-schemas");
    const b = await box(page, "node-order-events");
    // Empty canvas between the two (inside their boundary's backdrop, which takes no clicks).
    const gap = { x: a.x + a.width / 2, y: (a.y + a.height + b.y) / 2 };
    // Shift-drag over empty canvas, well above the diagram.
    const g = await box(page, "node-gateway");
    await drawBox(page, { x: g.x, y: g.y - 150 }, { x: g.x + 40, y: g.y - 110 }, true);
    await expect.poll(() => selectedIds(page)).toEqual(["node-order-events", "node-schemas"]);
    // The frame is still there: a right-click in the gap between the two is the selection's menu, not the canvas's.
    await page.mouse.click(gap.x, gap.y, { button: "right" });
    await expect(page.getByTestId("context-menu-item-selection.align")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-canvas.add-node")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
});

test("Ctrl+K finds Present; presenting puts focus on the canvas, and Esc leaves", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, KAFKA);
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.keyboard.type("present");
  await expect(page.getByTestId("command-item-view:present")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("present-exit")).toHaveCount(0);
  await expect(page.getByTestId("present-toggle")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("Esc clears a node's selection and leaves focus on it; a second Esc never selects it again", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("node-payments").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  const card = page.getByTestId("rf__node-payments");
  await expect(card).toBeFocused();
  // Back onto it from the keyboard (Tab on, Shift+Tab back), where focus shows the node's tooltip at once. The
  // pointer leaves first, so hovering doesn't race the focus.
  await page.mouse.move(1, 1);
  await waitForStableBox(card);
  await page.keyboard.press("Tab");
  await expect(card).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(card).toBeFocused();
  await expect(page.getByTestId("inspector-title")).toHaveText("Node");
  await expect(page.getByTestId("node-tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  await expect(card).toBeFocused();
  // Esc dismissed the node's tooltip; focus coming back to the node (after React Flow's blur) doesn't reopen it.
  await page.waitForTimeout(150);
  await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Give React Flow's own Esc (which selects a focused, unselected node) its chance.
  await page.waitForTimeout(150);
  await expect(page.getByTestId("inspector-title")).toHaveCount(0);
  await expect(card).toBeFocused();
  // Tab goes on to the next node in reading order, from where focus was.
  await page.keyboard.press("Tab");
  await expect(card).not.toBeFocused();
  await expect(page.getByTestId("canvas-wrap").locator(":focus")).toHaveCount(1);
  expectNoErrors(consoleErrors);
});

test("a password link's Done takes focus once the link is made", async ({ page, context, consoleErrors }) => {
  test.slow(); // PBKDF2 at 600,000 iterations
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, KAFKA);
  await shareVia(page, "password");
  await page.getByTestId("password-link-input").fill("plum orbit lantern 42");
  await page.getByTestId("password-link-copy").click();
  await expect(page.getByTestId("password-link-done")).toBeFocused({ timeout: 20_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("password-link-dialog")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("the Live toggle is named Live, with L as its key; the sheet lists the File and slow-motion keys", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, KAFKA);
  const toggle = page.getByTestId("live-toggle");
  await expect(toggle).toHaveAccessibleName("Live");
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "L");
  await expect(page.getByTestId("palette")).toHaveAccessibleName("Stencils");
  await page.getByTestId("shortcuts-button").click();
  const sheet = page.getByTestId("shortcuts-dialog");
  await expect(sheet).toContainText("Open a file from this device");
  await expect(sheet).toContainText("Save to this device as a new file");
  await expect(sheet).toContainText("Slow motion: step back or on, hop by hop");
  expectNoErrors(consoleErrors);
});
