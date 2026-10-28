import { openLibrary, pinLibrary } from "./fixtures";
import {
  waitForHistoryIdle,
  waitForAutosave,
  savedDiagram,
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  fitDiagram,
  waitForStableViewport,
  waitForSelectionSettled,
  waitForCameraIdle,
  pauseClock,
  flowState,
  flowPoint,
  STORAGE_KEYS,
  animationFrames,
} from "./fixtures";
import { chunk, holdChunk as holdSearchChunk } from "./chunk";
import type { Locator, Page } from "@playwright/test";
import { INSERT_HOVER_MS } from "../../src/canvas/edgeHover";

// Flow building (docs/research/drawing-ux.md, batch 3): the "+" on a selected node and Alt+arrow quick-add
// with Alt+Shift+arrow clone-and-connect (D3), reconnecting an edge's end and inserting a node by dropping
// it on an edge (D8), and the stencil rail's drag preview and selection-aware clicks (D13).
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const MOD = "ControlOrMeta";
/** Nodes, not their tooltip or inline editor. */
const NODES = /^node-(?!tooltip$|editor)/;

/**
 * Known geometry (cards 220 × 72): api → db in a row with a rich edge (a request, a label, a setting); a
 * lone cache below it, unconnected (to drop onto the edge); billing above, to reconnect to; hub alone at the
 * right with room on every side (for Alt+arrow).
 */
const SEED = {
  format: "diagrams/v1",
  title: "Flow building",
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "Orders DB", x: 800, y: 0 },
    { id: "cache", stencil: "redis.cache", label: "Cache", x: 400, y: 320 },
    { id: "billing", stencil: "service.go", label: "Billing", x: 400, y: -320 },
    { id: "hub", stencil: "kafka.topic", label: "Hub", x: 1800, y: 0 },
  ],
  edges: [{ id: "api-db", from: "api", to: "db", kind: "sync", label: "writes", props: { dlq: true } }],
};

type Saved = {
  nodes: { id: string; stencil: string; label: string; x: number; y: number; sublabel?: string }[];
  edges: {
    id: string;
    from: string;
    to: string;
    kind?: string;
    label?: string;
    relation?: string;
    props?: object;
    sourceSide?: string;
    targetSide?: string;
  }[];
  annotations?: { id: string; kind: string; text: string }[];
};

async function seed(page: Page, diagram = SEED) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(diagram)] as const,
  );
  await gotoCanvas(page, SLUG);
  const readyNode = diagram.nodes.some((node) => node.id === "hub") ? "hub" : diagram.nodes[0].id;
  await expect(page.getByTestId(`node-${readyNode}`)).toBeVisible();
  await waitForStableViewport(page);
  await fitDiagram(page);
  await waitForCameraIdle(page);
}

/** The diagram as autosaved (written 300 ms after the last edit). */
const saved = (page: Page) => savedDiagram(page) as Promise<Saved>;

/** Polls the autosave until `check` holds, and returns it. */
async function savedWhen(page: Page, check: (d: Saved) => boolean): Promise<Saved> {
  let last: Saved | null = null;
  await expect
    .poll(async () => {
      last = await saved(page);
      return !!last && check(last);
    })
    .toBe(true);
  return must(last, "the autosave");
}

/** A value the test needs: fails clearly when it's missing. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`Expected ${what}`);
  return v;
}

type Box = { x: number; y: number; width: number; height: number };
async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every node's box, by test id. */
async function nodeBoxes(page: Page) {
  const ids = await page.getByTestId(NODES).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
  const out = new Map<string, Box>();
  for (const id of ids) out.set(id, await box(page.getByTestId(id)));
  return out;
}

async function expectNoNodeOverlaps(page: Page) {
  // Measured on screen: wait out any pan (a reveal) so every box is read in the same view.
  await waitForStableViewport(page);
  const boxes = [...(await nodeBoxes(page)).entries()];
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlap(boxes[i][1], boxes[j][1])) hits.push(`${boxes[i][0]} × ${boxes[j][0]}`);
  expect(hits).toEqual([]);
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

/** Selects and reveals a node before the next gesture computes its viewport geometry. */
async function select(page: Page, id: string) {
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId(`grow-chip-${id}`)).toBeVisible();
  await waitForSelectionSettled(page);
}

async function connectBilling(page: Page) {
  await select(page, "billing");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("quick-add-search")).toBeFocused();
  await page.keyboard.type("redis cache");
  await expect(page.getByTestId("context-menu-item-quick-add:redis.cache")).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Escape");
  await savedWhen(page, (s) => s.edges.length === 2);
}

test("connected-drop preparation waits for a delayed picker before selecting its node", async ({ page }) => {
  const held = await holdSearchChunk(page, chunk("stencilDisplaySearch", "src/lib/stencilDisplaySearch.ts"));
  await seed(page);
  const connecting = connectBilling(page);
  try {
    await expect.poll(held.requested).toBe(true);
    await expect(page.getByTestId("quick-add-search")).toHaveValue("redis cache");
    await animationFrames(page);
    await expect(page.getByTestId("quick-add")).toBeVisible();
    held.release();
    await connecting;
  } finally {
    held.release();
    await connecting;
  }
});

/**
 * Clicks Undo up to `max` times until `gone` holds: a name typed right after an add is its own step. The
 * history records a step once edits settle (350 ms) and the autosave follows 300 ms later.
 */
async function undoUntil(page: Page, gone: (d: Saved) => boolean, max = 3) {
  for (let i = 0; i < max; i++) {
    await waitForHistoryIdle(page);
    await page.getByTestId("undo-button").click();
    await waitForAutosave(page);
    if (gone(await saved(page))) return;
  }
  await savedWhen(page, gone);
}

/** Where a drawn line ends on screen (its first path's last point). */
async function pathEnd(line: Locator) {
  return line
    .locator("path")
    .first()
    .evaluate((path: SVGPathElement) => {
      const m = path.getScreenCTM();
      if (!m) throw new Error("The line isn't drawn");
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(m);
      return { x: end.x, y: end.y };
    });
}
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Holds the pointer on a point long enough for an edge under it to light up. */
async function hold(page: Page, p: { x: number; y: number }, inserting = true) {
  await page.mouse.move(p.x + 2, p.y, { steps: 2 });
  await page.mouse.move(p.x, p.y, { steps: 2 });
  if (inserting) await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-insert", "1");
  else {
    // An ineligible node has no positive insertion signal. Exercise the real dwell timer.
    await pauseClock(page);
    await page.clock.runFor(INSERT_HOVER_MS + 1);
    await page.clock.resume();
  }
}

/** The middle of an edge's drawn line, on screen. */
async function edgeMiddle(page: Page, id: string) {
  return page.getByTestId(`edge-${id}`).evaluate((g) => {
    const path = g.querySelector<SVGPathElement>("path.fe-path");
    const m = path?.getScreenCTM();
    if (!path || !m) throw new Error("No drawn edge");
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  });
}

test.describe("the + chip and Alt+arrow (D3)", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("selection is ready after the deferred inspector reveal", async ({ page }) => {
    await page.clock.install();
    await pauseClock(page);
    const inspector = page.getByTestId("inspector");
    await expect(inspector).toHaveAttribute("data-collapsed", "1");
    const selecting = select(page, "hub");
    try {
      await expect(page.getByTestId("grow-chip-hub")).toBeVisible();
      // Hold the reveal's animation clock until the selection has published.
      await page.clock.resume();
      await selecting;
      await expect(inspector).not.toHaveAttribute("data-collapsed", "1");
      const wrap = await box(page.getByTestId("canvas-wrap"));
      const hub = await box(page.getByTestId("node-hub"));
      expect(hub.x).toBeGreaterThanOrEqual(wrap.x);
      expect(hub.x + hub.width).toBeLessThanOrEqual(wrap.x + wrap.width);
    } finally {
      await page.clock.resume();
      await selecting;
    }
  });

  test('the "+" shows on the selected node only, and adds the next node there, connected', async ({
    page,
    consoleErrors,
  }) => {
    const chips = page.getByTestId(/^grow-chip-/);
    await expect(chips).toHaveCount(0);
    await select(page, "api");
    await expect(chips).toHaveCount(1);
    // Downstream (right), clear of the card.
    const card = await box(page.getByTestId("node-api"));
    const chip = await box(page.getByTestId("grow-chip-api"));
    expect(chip.x).toBeGreaterThan(card.x + card.width);
    // The inspector opened and narrowed the canvas, keeping the API in view: the hub can be past the edge.
    await fitDiagram(page);
    await select(page, "hub");
    await expect(chips).toHaveCount(1);
    // Two selected: no chip anywhere.
    await fitDiagram(page);
    await page.keyboard.down("Shift");
    await page.getByTestId("node-api").click();
    await page.keyboard.up("Shift");
    await expect(chips).toHaveCount(0);

    await page.keyboard.press("Escape");
    await fitDiagram(page);
    await select(page, "hub");
    // Selecting opens the inspector, which narrows the canvas: the chip (right of the hub) can end up under it.
    // Fit the diagram into what's left, and click once the chip is clear of the inspector (a layout race: the
    // panel and the pan settle after the click that selected).
    await fitDiagram(page);
    const growChip = page.getByTestId("grow-chip-hub");
    await expect
      .poll(async () => {
        const [chipBox, panel] = await Promise.all([
          growChip.boundingBox(),
          page.getByTestId("inspector").boundingBox(),
        ]);
        return !!chipBox && (!panel || chipBox.x + chipBox.width <= panel.x);
      })
      .toBe(true);
    await growChip.click();
    await expect(page.getByTestId("quick-add")).toBeVisible();
    // The outline shows where it will land: right of the hub.
    const outline = await box(page.getByTestId("landing-outline"));
    const hub = await box(page.getByTestId("node-hub"));
    expect(outline.x).toBeGreaterThan(hub.x + hub.width);
    await page.keyboard.type("redis cache");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("landing-outline")).toHaveCount(0);
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Redis Cache");
    await page.keyboard.press("Escape");
    const d = await savedWhen(page, (s) => s.nodes.length === 6);
    const made = must(
      d.nodes.find((n) => n.stencil === "redis.cache" && n.id !== "cache"),
      "it",
    );
    expect(d.edges.find((e) => e.to === made.id)?.from).toBe("hub");
    await expectNoNodeOverlaps(page);
    // One undo takes the node and its edge.
    await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1, 1);
    expectNoErrors(consoleErrors);
  });

  test("dragging the + is a connect gesture: dropped on a node, it connects", async ({ page }) => {
    await select(page, "billing");
    const from = centre(await box(page.getByTestId("grow-chip-billing")));
    const to = centre(await box(page.getByTestId("node-db")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await savedWhen(page, (s) => s.edges.some((e) => e.from === "billing" && e.to === "db"));
  });

  for (const [key, check] of [
    ["ArrowRight", (n: Box, h: Box) => n.x >= h.x + h.width],
    ["ArrowDown", (n: Box, h: Box) => n.y >= h.y + h.height],
    ["ArrowLeft", (n: Box, h: Box) => n.x + n.width <= h.x],
    ["ArrowUp", (n: Box, h: Box) => n.y + n.height <= h.y],
  ] as const) {
    test(`Alt+${key} opens quick-add that way; the pick lands there, connected`, async ({ page, consoleErrors }) => {
      await select(page, "hub");
      const before = await flowPos(page, "node-hub");
      await page.keyboard.press(`Alt+${key}`);
      await expect(page.getByTestId("quick-add")).toBeVisible();
      // Alt+arrow never nudges.
      expect(await flowPos(page, "node-hub")).toEqual(before);
      await page.keyboard.type("redis cache");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("inspector-field-label")).toBeFocused();
      await page.keyboard.press("Escape");
      const d = await savedWhen(page, (s) => s.nodes.length === 6);
      const made = must(
        d.nodes.find((n) => !SEED.nodes.some((s) => s.id === n.id)),
        "it",
      );
      const edge = must(
        d.edges.find((e) => e.from === made.id || e.to === made.id),
        "it",
      );
      // → and ↓ are downstream (from the hub); ← and ↑ upstream (into it).
      const downstream = key === "ArrowRight" || key === "ArrowDown";
      expect([edge.from, edge.to]).toEqual(downstream ? ["hub", made.id] : [made.id, "hub"]);
      await waitForStableViewport(page);
      expect(check(await box(page.getByTestId(`node-${made.id}`)), await box(page.getByTestId("node-hub")))).toBe(true);
      // In view, clear of the inspector.
      const wrap = await box(page.getByTestId("canvas-wrap"));
      const b = await box(page.getByTestId(`node-${made.id}`));
      expect(b.x).toBeGreaterThanOrEqual(wrap.x);
      expect(b.x + b.width).toBeLessThanOrEqual(wrap.x + wrap.width);
      await expectNoNodeOverlaps(page);
      await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1, 1);
      expectNoErrors(consoleErrors);
    });
  }

  test("Alt+Shift+arrow copies the node that way, connected, and names the copy", async ({ page, consoleErrors }) => {
    await select(page, "hub");
    const before = await flowPos(page, "node-hub");
    await page.keyboard.press("Alt+Shift+ArrowDown");
    // No menu: the copy is there, its name selected for typing.
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Hub");
    await page.keyboard.type("Spoke");
    await page.keyboard.press("Enter");
    expect(await flowPos(page, "node-hub")).toEqual(before);
    const d = await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Spoke"));
    const copy = must(
      d.nodes.find((n) => n.label === "Spoke"),
      "it",
    );
    expect(copy.stencil).toBe("kafka.topic");
    expect(copy.y).toBeGreaterThan(before.y + 72);
    expect(d.edges.some((e) => e.from === "hub" && e.to === copy.id)).toBe(true);
    await expectNoNodeOverlaps(page);
    // Undo: the name, then the copy and its edge.
    await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1);
    expectNoErrors(consoleErrors);
  });

  test("typing straight after the pick names the node, and Tab, Tab names its connection", async ({ page }) => {
    await select(page, "hub");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add")).toBeVisible();
    // Fast, with no wait for the editor: "t" (Add text) and "l" (Live) must not reach the canvas.
    await page.keyboard.type("redis cache", { delay: 5 });
    await expect(page.getByTestId("context-menu-item-quick-add:redis.cache")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await page.keyboard.type("dedupe table", { delay: 5 });
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("dedupe table");
    // CI read this intermediate autosave after Enter: the node was named, but its connection wasn't.
    // Freeze that ordering so finishing naming must flush the connection rather than await its debounce.
    await page.clock.install();
    await pauseClock(page);
    await page.clock.runFor(300);
    await savedWhen(page, (s) => s.nodes.some((n) => n.label === "dedupe table"));
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-sublabel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("inspector-field-connection")).toBeFocused();
    await page.keyboard.type("SET NX");
    await page.keyboard.press("Enter");
    const d = await savedWhen(page, (s) => s.nodes.some((n) => n.label === "dedupe table"));
    const made = must(
      d.nodes.find((n) => n.label === "dedupe table"),
      "it",
    );
    expect(d.edges.find((e) => e.to === made.id)).toMatchObject({ from: "hub", label: "SET NX" });
    await expect(page.getByTestId(/^annotation-/)).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
  });

  for (const finish of ["Escape", "click-away", "inspector removal"]) {
    test(`finishing connection naming persists before autosave: ${finish}`, async ({ page }) => {
      await select(page, "hub");
      await page.keyboard.press("Alt+ArrowRight");
      await page.keyboard.type("redis cache");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("inspector-field-label")).toBeFocused();
      await page.getByTestId("inspector-field-label").fill("Named cache");
      await page.clock.install();
      await pauseClock(page);
      await page.clock.runFor(300);
      await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Named cache"));
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("inspector-field-connection")).toBeFocused();
      await page.keyboard.type("SET NX");
      expect((await saved(page)).edges.some((e) => e.label === "SET NX")).toBe(false);
      if (finish === "Escape") await page.keyboard.press("Escape");
      else if (finish === "click-away") await page.getByTestId("canvas-wrap").click({ position: { x: 30, y: 300 } });
      else await page.getByTestId("inspector-toggle").click();
      // Click-away finishes through a frame, inspector teardown through a microtask.
      // The ordinary 300 ms autosave cannot run during this single frame.
      await page.clock.runFor(16);
      const d = await saved(page);
      const made = must(
        d.nodes.find((n) => n.label === "Named cache"),
        "named cache",
      );
      expect(d.edges.find((e) => e.to === made.id)).toMatchObject({ from: "hub", label: "SET NX" });
    });
  }

  test("a name typed after the add was recorded still joins its undo step", async ({ page }) => {
    await select(page, "hub");
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.type("redis cache");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    // Longer than the history's 350 ms settle: the add is its own entry by now.
    await page.clock.install();
    await pauseClock(page);
    await page.clock.runFor(800);
    await page.clock.resume();
    await page.keyboard.type("Dedupe");
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => s.nodes.some((n) => n.label === "Dedupe"));
    await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1, 1);
  });

  test("the + and Alt+arrow stay out of live view", async ({ page }) => {
    await select(page, "hub");
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId(/^grow-chip-/)).toHaveCount(0);
    await page.getByTestId("node-hub").click();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
  });
});

test.describe("edges: reconnect and insert (D8)", () => {
  test.beforeEach(async ({ page }) => seed(page));

  test("a selected edge's end dragged onto another node moves there, keeping its meaning", async ({
    page,
    consoleErrors,
  }) => {
    await expect(page.getByTestId(/^reconnect-/)).toHaveCount(0);
    // Prepare a body drop outside the dots' snap zones at the standard viewport.
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Shift+Digit2");
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    await page.keyboard.press("Shift+Digit0");
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    const end = page.getByTestId("reconnect-api-db-target");
    await expect(end).toBeVisible();
    await expect(page.getByTestId("reconnect-api-db-source")).toBeVisible();
    // At 100%, Focus can leave the far endpoint behind the dock. Pan it back
    // into the canvas before starting the gesture; the selection stays intact.
    const pane = await box(page.getByTestId("canvas-wrap"));
    const targetPoint = centre(await box(end));
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.wheel(Math.max(0, targetPoint.x - (pane.x + pane.width - 60)), 0);
    await waitForStableViewport(page);
    const from = centre(await box(end));
    const to = centre(await box(page.getByTestId("node-billing")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 30, from.y - 30, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId("reconnect-line")).toBeVisible();
    // The crosshair throughout, and the node it will move to lit up.
    const cursor = await page.evaluate(
      ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y) ?? document.body).cursor,
      to,
    );
    expect(cursor).toBe("crosshair");
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges[0]?.to === "billing");
    expect(d.edges).toEqual([
      { id: "api-db", from: "api", to: "billing", kind: "sync", label: "writes", props: { dlq: true } },
    ]);
    await undoUntil(page, (s) => s.edges[0]?.to === "db", 1);
    expectNoErrors(consoleErrors);
  });

  test("an edge's end dropped on empty canvas snaps back", async ({ page }) => {
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    const from = centre(await box(page.getByTestId("reconnect-api-db-source")));
    const wrap = await box(page.getByTestId("canvas-wrap"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(wrap.x + 60, wrap.y + wrap.height - 140, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    const d = await saved(page);
    expect(d?.edges[0] ?? SEED.edges[0]).toMatchObject({ from: "api", to: "db" });
  });

  test("Esc during a reconnect over a valid node cancels it: nothing changes, nothing to undo", async ({ page }) => {
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    const from = centre(await box(page.getByTestId("reconnect-api-db-target")));
    const to = centre(await box(page.getByTestId("node-billing")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 30, from.y - 30, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId("reconnect-line")).toBeVisible();
    await expect(page.getByTestId("rf__node-billing")).toHaveClass(/is-connect-target/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
    await expect(page.getByTestId("rf__node-billing")).not.toHaveClass(/is-connect-target/);
    // Released over Billing after Esc: still nothing.
    await page.mouse.up();
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    expect((await saved(page))?.edges[0] ?? SEED.edges[0]).toMatchObject({ from: "api", to: "db" });
    await expect(page.getByTestId("undo-button")).toBeDisabled();
  });

  test("keyboard: an edge's menu and Ctrl+K reconnect either end, keeping its meaning", async ({ page }) => {
    // The edge's menu: Reconnect to, a searchable list of nodes.
    await page.getByTestId("edge-label-api-db").click({ button: "right" });
    await page.getByTestId("context-menu-item-edge.reconnect").click();
    await page.getByTestId("context-menu-item-edge.reconnect:to").click();
    await expect(page.getByTestId("context-menu-sub-sub-search")).toBeFocused();
    await page.keyboard.type("bill");
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => s.edges[0]?.to === "billing");
    // Ctrl+K with the edge selected: Reconnect from › Hub.
    await page.getByTestId("edge-label-api-db").click();
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("reconnect from hub");
    await expect(page.getByTestId("command-item-action:reconnect-source:hub")).toBeVisible();
    await page.keyboard.press("Enter");
    const d = await savedWhen(page, (s) => s.edges[0]?.from === "hub");
    expect(d.edges).toEqual([
      { id: "api-db", from: "hub", to: "billing", kind: "sync", label: "writes", props: { dlq: true } },
    ]);
  });

  test("keyboard: Insert node on an edge (menu or Ctrl+K) splits it and names the node; one undo takes it all", async ({
    page,
    consoleErrors,
  }) => {
    await page.getByTestId("edge-label-api-db").click();
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("insert node redis cache");
    await expect(page.getByTestId("command-item-action:insert-node:redis.cache")).toBeVisible();
    await page.keyboard.press("Enter");
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Redis Cache");
    // Named after the add has been recorded: still one step with it.
    await page.clock.install();
    await pauseClock(page);
    await page.clock.runFor(700);
    await page.clock.resume();
    await page.keyboard.type("Read cache");
    await page.keyboard.press("Enter");
    const d = await savedWhen(page, (s) => s.edges.length === 2 && s.nodes.some((n) => n.label === "Read cache"));
    const made = must(
      d.nodes.find((n) => n.label === "Read cache"),
      "the inserted node",
    );
    expect(d.edges).toEqual([
      { id: "api-db", from: "api", to: made.id, kind: "sync", label: "writes", props: { dlq: true } },
      { id: "e-1", from: made.id, to: "db", kind: "sync", props: { dlq: true } },
    ]);
    await expectNoNodeOverlaps(page);
    await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1 && s.edges[0].to === "db", 1);
    // The edge's own menu offers it too.
    await page.getByTestId("edge-label-api-db").click({ button: "right" });
    await expect(page.getByTestId("context-menu-item-edge.insert-node")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("a node held over an edge lights it up; dropped, it goes in between, keeping the edge's meaning", async ({
    page,
    consoleErrors,
  }) => {
    const press = centre(await box(page.getByTestId("node-cache")));
    const mid = await edgeMiddle(page, "api-db");
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x + 5, press.y, { steps: 2 });
    await page.mouse.move(mid.x, mid.y, { steps: 12 });
    await hold(page, mid);
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-insert", "1");
    // The line it will split shows through the node (the edge itself steps aside from a node over it).
    await expect(page.getByTestId("insert-line")).toBeAttached();
    await page.mouse.up();
    await expect(page.getByTestId("insert-line")).toHaveCount(0);
    const d = await savedWhen(page, (s) => s.edges.length === 2);
    const first = must(
      d.edges.find((e) => e.id === "api-db"),
      "it",
    );
    const second = must(
      d.edges.find((e) => e.id !== "api-db"),
      "it",
    );
    expect(first).toEqual({
      id: "api-db",
      from: "api",
      to: "cache",
      kind: "sync",
      label: "writes",
      props: { dlq: true },
    });
    expect(second).toEqual({ id: second.id, from: "cache", to: "db", kind: "sync", props: { dlq: true } });
    // One undo: the edge is whole again and the node back where it was.
    await undoUntil(page, (s) => s.edges.length === 1 && s.edges[0].to === "db", 1);
    expect(must(await saved(page), "the autosave").nodes.find((n) => n.id === "cache")).toMatchObject({
      x: 400,
      y: 320,
    });
    expectNoErrors(consoleErrors);
  });

  test("passing over an edge, or dropping with Ctrl/Cmd held, doesn't insert", async ({ page }) => {
    const press = centre(await box(page.getByTestId("node-cache")));
    const mid = await edgeMiddle(page, "api-db");
    // Straight across, no pause.
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 6 });
    await page.mouse.move(mid.x + 60, mid.y - 160, { steps: 6 });
    await page.mouse.up();
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    expect(must(await saved(page), "the autosave").edges).toHaveLength(1);
    // Held, but dropped with Ctrl/Cmd.
    const at = centre(await box(page.getByTestId("node-cache")));
    const mid2 = await edgeMiddle(page, "api-db");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(mid2.x, mid2.y, { steps: 8 });
    await hold(page, mid2);
    await page.keyboard.down(MOD);
    await page.mouse.move(mid2.x + 1, mid2.y);
    await page.mouse.up();
    await page.keyboard.up(MOD);
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    expect(must(await saved(page), "the autosave").edges).toHaveLength(1);
  });

  test("a connected node never splits an edge it's dropped on", async ({ page }) => {
    await page.clock.install();
    // Connect billing first, so it has an edge.
    await connectBilling(page);
    // The new node was brought into view (a pan): measure after it settles.
    await waitForStableViewport(page);
    const before = await flowPos(page, "node-billing");
    const press = centre(await box(page.getByTestId("node-billing")));
    const mid = await edgeMiddle(page, "api-db");
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 10 });
    await hold(page, mid, false);
    await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-insert", "1");
    await page.mouse.up();
    // It did move (onto the line), and the edges are as they were.
    const d = await savedWhen(page, (s) => {
      const b = s.nodes.find((n) => n.id === "billing");
      return !!b && (b.x !== before.x || b.y !== before.y);
    });
    expect(d.edges).toHaveLength(2);
    expect(d.edges.find((e) => e.id === "api-db")).toMatchObject({ from: "api", to: "db" });
    const billing = must(
      d.nodes.find((n) => n.id === "billing"),
      "billing",
    );
    expect(billing.y).toBeGreaterThan(before.y + 150);
  });
});

test.describe("the stencil rail (D13)", () => {
  test.beforeEach(async ({ page }) => {
    // Record what the browser is asked to draw while dragging.
    await page.addInitScript(() => {
      const w = window as unknown as { __dragImages: string[] };
      w.__dragImages = [];
      const set = DataTransfer.prototype.setDragImage;
      DataTransfer.prototype.setDragImage = function (el: Element, x: number, y: number) {
        w.__dragImages.push(el.getAttribute("data-testid") ?? el.tagName);
        return set.call(this, el, x, y);
      };
    });
    await seed(page);
    await pinLibrary(page);
    await fitDiagram(page);
    await expect(page.getByTestId("palette-search")).toBeVisible();
  });

  /** Finds a stencil in the rail. */
  async function railItem(page: Page, query: string, id: string) {
    await openLibrary(page);
    await page.getByTestId("palette-search").fill(query);
    await openLibrary(page);
    const item = page.getByTestId(`palette-item-${id}`);
    await expect(item).toBeVisible();
    return item;
  }

  test("dragging a stencil shows a node card, not the browser's picture of the row", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
    const source = must(await item.elementHandle(), "drag source");
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent("dragstart", { dataTransfer: dt });
    const preview = page.getByTestId("stencil-drag-preview");
    await expect(preview).toBeAttached();
    await expect(preview).toContainText("Redis Cache");
    expect(await page.evaluate(() => (window as unknown as { __dragImages: string[] }).__dragImages)).toEqual([
      "stencil-drag-preview",
    ]);
    // Over empty canvas: an outline where it will land.
    const wrap = await box(page.getByTestId("canvas-wrap"));
    const at = { clientX: wrap.x + wrap.width / 2, clientY: wrap.y + wrap.height - 120 };
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await expect(page.getByTestId("landing-outline")).toBeVisible();
    await page.getByTestId("canvas-wrap").dispatchEvent("drop", { dataTransfer: dt, ...at });
    await source.dispatchEvent("dragend", { dataTransfer: dt });
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId("landing-outline")).toHaveCount(0);
    await savedWhen(page, (s) => s.nodes.length === 6);
  });

  test("stencil drag preview stays outside palette layout", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
    const layout = async () =>
      Promise.all([
        item.boundingBox(),
        page.getByTestId("palette-results").boundingBox(),
        page.getByTestId("palette-search").boundingBox(),
        page.getByTestId("canvas-wrap").boundingBox(),
      ]);
    const before = await layout();
    expect(before.every(Boolean)).toBe(true);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    try {
      await item.dispatchEvent("dragstart", { dataTransfer: dt });
      const preview = page.getByTestId("stencil-drag-preview");
      await expect(preview).toBeAttached();
      expect(await preview.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
      const bounds = await box(preview);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.x + bounds.width).toBeLessThan(0);
      expect(await layout()).toEqual(before);
    } finally {
      await item.dispatchEvent("dragend", { dataTransfer: dt });
    }
    await expect(page.getByTestId("stencil-drag-preview")).toHaveCount(0);
  });

  test("a stencil held over an edge and dropped goes in between", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
    const source = must(await item.elementHandle(), "drag source");
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent("dragstart", { dataTransfer: dt });
    const mid = await edgeMiddle(page, "api-db");
    const at = { clientX: mid.x, clientY: mid.y };
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-insert", "1");
    await page.getByTestId("canvas-wrap").dispatchEvent("drop", { dataTransfer: dt, ...at });
    await source.dispatchEvent("dragend", { dataTransfer: dt });
    const d = await savedWhen(page, (s) => s.edges.length === 2);
    const made = must(
      d.nodes.find((n) => !SEED.nodes.some((s) => s.id === n.id)),
      "it",
    );
    expect(d.edges.find((e) => e.id === "api-db")).toMatchObject({ from: "api", to: made.id, label: "writes" });
    expect(d.edges.find((e) => e.id !== "api-db")).toMatchObject({ from: made.id, to: "db", kind: "sync" });
  });

  test("a stencil dropped on a node goes after it, connected, clear of everything", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
    const source = must(await item.elementHandle(), "drag source");
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent("dragstart", { dataTransfer: dt });
    const at = centre(await box(page.getByTestId("node-api")));
    const drop = { dataTransfer: dt, clientX: at.x, clientY: at.y };
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", drop);
    // Over a node: no outline (it won't land there), the node lights up instead.
    await expect(page.getByTestId("landing-outline")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").dispatchEvent("drop", drop);
    await source.dispatchEvent("dragend", { dataTransfer: dt });
    const d = await savedWhen(page, (s) => s.nodes.length === 6);
    const made = must(
      d.nodes.find((n) => !SEED.nodes.some((s) => s.id === n.id)),
      "the new node",
    );
    expect(d.edges.find((e) => e.to === made.id)?.from).toBe("api");
    await expectNoNodeOverlaps(page);
  });

  test("a rail click with one node selected adds after it, connected; with none, unconnected", async ({
    page,
    consoleErrors,
  }) => {
    await select(page, "hub");
    await openLibrary(page);
    await expect(page.getByTestId("palette-after")).toContainText("Hub");
    const item = await railItem(page, "redis cache", "redis.cache");
    await item.click();
    let d = await savedWhen(page, (s) => s.nodes.length === 6);
    const after = must(
      d.nodes.find((n) => !SEED.nodes.some((s) => s.id === n.id)),
      "it",
    );
    expect(d.edges.find((e) => e.to === after.id)?.from).toBe("hub");
    // A rail click doesn't open the name (decision 3).
    await expect(page.getByTestId("inspector-field-label")).not.toBeFocused();
    await expectNoNodeOverlaps(page);
    // Undo takes both.
    await undoUntil(page, (s) => s.nodes.length === 5 && s.edges.length === 1, 1);

    // Nothing selected: an unconnected node, and the footer says nothing about "after".
    await page.getByTestId("node-hub").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette-after")).toHaveCount(0);
    await openLibrary(page);
    await page.getByTestId(`palette-item-redis.cache`).click();
    d = await savedWhen(page, (s) => s.nodes.length === 6);
    expect(d.edges).toHaveLength(1);
    await expectNoNodeOverlaps(page);
    expectNoErrors(consoleErrors);
  });

  test("two nodes selected: a rail click adds an unconnected node", async ({ page }) => {
    await page.getByTestId("node-api").click();
    await page.keyboard.down("Shift");
    await page.getByTestId("node-cache").click();
    await page.keyboard.up("Shift");
    await expect(page.getByTestId("palette-after")).toHaveCount(0);
    const item = await railItem(page, "redis cache", "redis.cache");
    await item.click();
    const d = await savedWhen(page, (s) => s.nodes.length === 6);
    expect(d.edges).toHaveLength(1);
  });
});

/**
 * The batch's gate (docs/research/drawing-ux.md, batch 3): the right half of the Kafka example from a blank
 * diagram, keyboard only. orders.created.v1 feeds three services, each writing to its store: the topic plus
 * six nodes and six named edges. Every key press counts, searches included, except the names themselves.
 */
test("gate: the right half of the Kafka example, keyboard only, in under 60 keys", async ({ page, consoleErrors }) => {
  await page.goto("./");
  await expect(page.getByTestId("start-card")).toBeVisible();
  const log: string[] = [];
  const key = async (k: string) => {
    log.push(k);
    await page.keyboard.press(k);
  };
  /** A stencil or node search: each character is a key press. */
  const find = async (q: string) => {
    log.push(...q.split(""));
    await page.keyboard.type(q);
  };
  /** A name: content, the same in any tool, so not counted. */
  const name = async (text: string) => {
    log.push(`“${text}”`);
    await page.keyboard.type(text);
  };
  const editor = page.getByTestId("inspector-field-label");
  /** Names a node just made connected, then its connection (Tab, Tab), and saves. */
  const names = async (node: string, edge: string) => {
    await expect(editor).toBeFocused();
    await name(node);
    await key("Tab");
    await key("Tab");
    await name(edge);
    await key("Enter");
    await expect(editor).not.toBeFocused();
  };

  // Inventory database first, then upstream to the topic, so the topic ends selected for the fan-out.
  await key("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeFocused();
  await find("pg");
  await key("Enter");
  // The new node has focus, so Enter names it.
  await expect(page.getByTestId("rf__node-postgres-1")).toBeFocused();
  await key("Enter");
  await expect(editor).toBeFocused();
  await name("Inventory database");
  await key("Enter");

  await key("Alt+ArrowLeft");
  await find("jav");
  await key("Enter");
  await names("Inventory service", "Reserve SKUs");

  await key("Alt+ArrowLeft");
  await find("kaf");
  await key("Enter");
  await names("orders.created.v1", "Reserve inventory");

  await key("Alt+ArrowRight");
  await find("go");
  await key("Enter");
  await names("Payments service", "Authorize payment");

  await key("Alt+ArrowRight");
  await find("pg");
  await key("Enter");
  await names("Payment ledger", "Record authorization");

  // Back to the topic: Ctrl+K finds nodes by name.
  await key("ControlOrMeta+k");
  await find("ord");
  await key("Enter");
  await expect(page.getByTestId("rf__node-topic-1")).toBeFocused();

  await key("Alt+ArrowRight");
  await find("nod");
  await key("Enter");
  await names("Notification service", "Send confirmation");

  await key("Alt+ArrowRight");
  await find("red");
  await key("ArrowDown");
  await key("Enter");
  await names("Notification dedupe", "SET NX · dedupe");

  const keys = log.filter((k) => !k.startsWith("“"));
  console.log(`Gate: ${keys.length} keys: ${log.join(" ")}`);
  expect(keys.length).toBeLessThan(60);

  // The diagram it made, edge by edge: the topic fans out to three services, each writing to its store.
  const built = await savedWhen(
    page,
    (diagram) =>
      diagram.nodes.length === 7 && diagram.edges.length === 6 && diagram.edges.every((edge) => !!edge.label),
  );
  const labelOf = (id: string) => built.nodes.find((n) => n.id === id)?.label;
  expect(built.edges.map((e) => [labelOf(e.from), labelOf(e.to), e.label]).sort()).toEqual(
    [
      ["Inventory service", "Inventory database", "Reserve SKUs"],
      ["orders.created.v1", "Inventory service", "Reserve inventory"],
      ["orders.created.v1", "Payments service", "Authorize payment"],
      ["Payments service", "Payment ledger", "Record authorization"],
      ["orders.created.v1", "Notification service", "Send confirmation"],
      ["Notification service", "Notification dedupe", "SET NX · dedupe"],
    ].sort(),
  );
  expect(Object.fromEntries(built.nodes.map((n) => [n.label, n.stencil]))).toEqual({
    "Inventory database": "postgres",
    "Inventory service": "service.java",
    "orders.created.v1": "kafka.topic",
    "Payments service": "service.go",
    "Payment ledger": "postgres",
    "Notification service": "service.node",
    "Notification dedupe": "redis.cache",
  });

  // On the canvas: 7 nodes of the right stencils, 6 named edges, nothing overlapping.
  await expect(page.getByTestId(NODES)).toHaveCount(7);
  for (const [id, label] of [
    ["postgres-1", "Inventory database"],
    ["java-1", "Inventory service"],
    ["topic-1", "orders.created.v1"],
    ["go-1", "Payments service"],
    ["postgres-2", "Payment ledger"],
    ["node-1", "Notification service"],
    ["cache-1", "Notification dedupe"],
  ])
    await expect(page.getByTestId(`node-${id}`)).toContainText(label);
  // Long labels wrap onto lines: compare the words.
  const edgeLabels = (await page.getByTestId(/^edge-label-/).allTextContents()).map((t) => t.replace(/\s+/g, " "));
  expect(edgeLabels.sort()).toEqual(
    [
      "Authorize payment",
      "Record authorization",
      "Reserve SKUs",
      "Reserve inventory",
      "SET NX · dedupe",
      "Send confirmation",
    ].sort(),
  );
  await expectNoNodeOverlaps(page);
  expectNoErrors(consoleErrors);
});

test("gesture controller journals Esc and keeps a reconnect cancelled after release", async ({ page }) => {
  await seed(page);
  await page.getByTestId("edge-label-api-db").click();
  await waitForSelectionSettled(page);
  const from = centre(await box(page.getByTestId("reconnect-api-db-target")));
  const to = centre(await box(page.getByTestId("node-billing")));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
  await page.mouse.up();
  const events = await page.evaluate(() => window.__interactionJournal?.map((entry) => entry.event));
  expect(events).toContain("gesture.start:edge.end");
  expect(events).toContain("gesture.end:edge.end:escape");
  expect(events).not.toContain("gesture.end:edge.end:drop");
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("a cold edge inspector takes its requested name field once the fields arrive", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(chunk("EdgePanel", "src/canvas/inspector/EdgePanel.tsx"), async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  try {
    await seed(page);
    await page.getByTestId("edge-label-api-db").dblclick();
    await expect.poll(() => requested).toBe(true);
    await waitForSelectionSettled(page);
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
    release();
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    await page.keyboard.type("Orders write");
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => s.edges[0]?.label === "Orders write");
  } finally {
    release();
  }
});

/** Holds a chunk's code until release(); with `fail` set by then, its download fails instead (each request). */
async function holdChunk(page: Page, pattern: RegExp) {
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = { fail: false, requests: 0, release };
  await page.route(pattern, async (route) => {
    control.requests++;
    await open;
    if (control.fail) return route.abort("failed");
    await route.continue();
  });
  return control;
}

/** Holds the edge inspector's code until release(); with `fail` set by then, its download fails instead. */
const holdEdgePanel = (page: Page) => holdChunk(page, chunk("EdgePanel", "src/canvas/inspector/EdgePanel.tsx"));

/** The diagram's annotations as autosaved (none in the seed). */
const annotations = async (page: Page) =>
  ((await saved(page)) as Saved & { annotations?: unknown[] }).annotations ?? [];

test("a rename typed while the edge inspector downloads goes to its label, never to canvas shortcuts", async ({
  page,
}) => {
  const panel = await holdEdgePanel(page);
  try {
    await seed(page);
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await expect.poll(() => panel.requests).toBe(1);
    await page.keyboard.press("F2");
    // On the canvas T adds a text and Backspace deletes the connection: typed for a rename, they're its name.
    await page.keyboard.press("T");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Orders write");
    await expect(page.getByTestId("inspector-field-label")).toHaveCount(0);
    panel.release();
    const field = page.getByTestId("inspector-field-label");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Orders write");
    // The caret follows what was typed, so typing goes on from there.
    await page.keyboard.type("s");
    await expect(field).toHaveValue("Orders writes");
    await page.keyboard.press("Enter");
    const after = await savedWhen(page, (d) => d.edges[0]?.label === "Orders writes");
    expect(after.edges).toHaveLength(1);
    expect(after.edges[0]).toMatchObject({ id: "api-db", from: "api", to: "db" });
    expect(await annotations(page)).toEqual([]);
    await expect(page.getByTestId("edge-label-api-db")).toBeVisible();
    // The rename is one step.
    await undoUntil(page, (d) => d.edges[0]?.label === "writes", 1);
  } finally {
    panel.release();
  }
});

test("a rename whose edge inspector fails to download leaves the canvas untouched and offers Retry", async ({
  page,
}) => {
  const panel = await holdEdgePanel(page);
  try {
    await seed(page);
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await expect.poll(() => panel.requests).toBe(1);
    await page.keyboard.press("F2");
    await page.keyboard.press("T");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("x");
    panel.fail = true;
    panel.release();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Part of the app couldn't be downloaded");
    await expect(toast).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    await expect(page.getByTestId("inspector-panel-unavailable")).toHaveCount(1);
    // Nothing typed reached the canvas, and nothing is held any more.
    expect(await page.evaluate(() => document.activeElement?.closest("[data-testid=toast]"))).toBeNull();
    await expect(page.getByTestId("edge-label-api-db")).toHaveText("writes");
    const before = await saved(page);
    expect(before.edges).toHaveLength(1);
    expect(before.edges[0]?.label).toBe("writes");
    expect(await annotations(page)).toEqual([]);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    // Retry brings the fields, and the next rename takes its field at once.
    panel.fail = false;
    await page.getByTestId("lazy-load-retry").click();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("writes");
    await expect(page.getByTestId("inspector-panel-unavailable")).toHaveCount(0);
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  } finally {
    panel.release();
  }
});

test("failed inspector download releases canvas keys before Retry", async ({ page }) => {
  const panel = await holdEdgePanel(page);
  try {
    await seed(page);
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await expect.poll(() => panel.requests).toBe(1);
    await page.keyboard.press("F2");
    await page.keyboard.type("x");
    panel.fail = true;
    panel.release();
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    // No click, no other change on the canvas: T is the canvas's again, and adds a text.
    await page.keyboard.press("T");
    await expect.poll(async () => (await annotations(page)).length).toBe(1);
    expect((await saved(page)).edges[0]?.label).toBe("writes");
  } finally {
    panel.release();
  }
});

test("typing in another field during a cold rename stays there across commits and the panel's arrival", async ({
  page,
}) => {
  const panel = await holdEdgePanel(page);
  try {
    await seed(page);
    await pinLibrary(page);
    await fitDiagram(page);
    await page.getByTestId("node-api").click();
    await waitForSelectionSettled(page);
    // eslint-disable-next-line no-restricted-syntax -- Edge navigation uses literal Ctrl on every platform.
    await page.keyboard.press("Control+Alt+]");
    await waitForSelectionSettled(page);
    await expect.poll(() => panel.requests).toBe(1);
    await page.keyboard.press("F2");
    await page.keyboard.type("ab");
    // Focus leaves the canvas for the stencil search (as Tab or a script would), without a press.
    const search = page.getByTestId("palette-search");
    await search.focus();
    await page.keyboard.type("redis");
    await expect(search).toHaveValue("redis");
    panel.release();
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("writes");
    await expect(search).toBeFocused();
    await page.keyboard.type("x");
    await expect(search).toHaveValue("redisx");
    await expect(page.getByTestId("inspector-field-label")).toHaveValue("writes");
    expect((await saved(page)).edges[0]?.label).toBe("writes");
  } finally {
    panel.release();
  }
});

for (const loss of ["pointercancel", "lostpointercapture"] as const) {
  test(`reconnect ${loss} releases capture and permits another drag`, async ({ page }) => {
    await seed(page);
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    // Remember which element took the pointer, to interrupt it as the browser would.
    await page.evaluate(() => {
      document.addEventListener(
        "gotpointercapture",
        (e) => {
          const w = window as unknown as { captured?: { el: Element; id: number } };
          w.captured = { el: e.target as Element, id: e.pointerId };
        },
        { capture: true, once: true },
      );
    });
    const handle = page.getByTestId("reconnect-api-db-target");
    const from = centre(await box(handle));
    const to = centre(await box(page.getByTestId("node-billing")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId("reconnect-line")).toBeVisible();
    await expect(page.getByTestId("rf__node-billing")).toHaveClass(/is-connect-target/);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
    await page.evaluate((kind) => {
      const c = (window as unknown as { captured?: { el: Element; id: number } }).captured;
      if (!c) throw new Error("No element took the pointer");
      if (kind === "pointercancel")
        c.el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: c.id, bubbles: true }));
      else c.el.releasePointerCapture(c.id);
    }, loss);
    // The browser tells of a released capture before the next pointer event.
    await page.mouse.move(to.x + 2, to.y + 2);
    await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
    await expect(page.getByTestId("rf__node-billing")).not.toHaveClass(/is-connect-target/);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
    const events = await page.evaluate(() => window.__interactionJournal?.map((entry) => entry.event));
    expect(events).toContain("gesture.end:edge.end:cancel");
    expect(
      await page.evaluate(() => {
        const c = (window as unknown as { captured?: { el: Element; id: number } }).captured;
        return !!c && c.el.isConnected && c.el.hasPointerCapture(c.id);
      }),
    ).toBe(false);
    await page.mouse.up();
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    expect((await saved(page)).edges[0]).toMatchObject({ from: "api", to: "db" });
    // Another drag reconnects as usual.
    const again = centre(await box(page.getByTestId("reconnect-api-db-target")));
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await savedWhen(page, (d) => d.edges.length === 1 && d.edges[0]?.from === "api" && d.edges[0]?.to === "billing");
  });
}

for (const activation of ["mouse", "accessibility"] as const) {
  test(`click-connect by ${activation} commits without a drag`, async ({ page }) => {
    await seed(page);
    const from = page.getByTestId("handle-billing-bottom");
    const to = page.getByTestId("handle-cache-top");
    if (activation === "mouse") {
      await from.click();
      await to.click();
    } else {
      // Assistive technology activates with a detail=0 click, without mouse down/move.
      await from.dispatchEvent("click", { detail: 0 });
      await to.dispatchEvent("click", { detail: 0 });
    }
    await savedWhen(page, (s) => s.edges.some((e) => e.from === "billing" && e.to === "cache"));
    await expect(page.getByTestId("canvas-wrap")).not.toHaveClass(/is-connecting/);
    await undoUntil(page, (s) => s.edges.length === 1, 1);
  });
}

for (const source of ["billing", "api"] as const) {
  test(`click-connect then drag from ${source === "billing" ? "the same" : "another"} dot lasts until release`, async ({
    page,
  }) => {
    await seed(page);
    await page.getByTestId("handle-billing-bottom").click();
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
    const from = centre(await box(page.getByTestId(`handle-${source}-bottom`)));
    const empty = { x: from.x + 60, y: from.y + 70 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(empty.x, empty.y, { steps: 10 });
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
    await expect(page.getByTestId("connection-add")).toBeVisible();
    await expect
      .poll(async () => apart(centre(await box(page.getByTestId("connection-add"))), empty))
      .toBeLessThanOrEqual(1.5);
    const to = centre(await box(page.getByTestId("node-cache")));
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("connection-line")).toBeVisible();
    await expect(page.getByTestId("rf__node-cache")).toHaveClass(/is-connect-target/);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    await page.mouse.up();
    await savedWhen(page, (s) =>
      s.edges.some((e) => e.from === source && e.to === "cache" && e.sourceSide === "bottom"),
    );
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
  });
}

test("a foreground dialog gets Escape before a click connection", async ({ page }) => {
  await seed(page);
  await page.getByTestId("handle-billing-bottom").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-interaction-state", "gesture");
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

for (const cancellation of ["Escape", "window blur"] as const) {
  test(`${cancellation} cancels a connection${cancellation === "Escape" ? " before release" : ""}`, async ({
    page,
  }) => {
    await seed(page);
    // Keep nonzero SVG bounds while the preview snaps exactly to its dot.
    const from = centre(await box(page.getByTestId("handle-billing-right")));
    const to = centre(await box(page.getByTestId("node-cache")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId("connection-line")).toBeVisible();
    await expect(page.getByTestId("rf__node-cache")).toHaveClass(/is-connect-target/);
    if (cancellation === "Escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
    await expect(page.getByTestId("rf__node-cache")).not.toHaveClass(/is-connect-target/);
    await page.mouse.move(to.x + 2, to.y + 2);
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    expect((await saved(page)).edges).toHaveLength(1);
    const retry = centre(await box(page.getByTestId("handle-billing-right")));
    await page.mouse.move(retry.x, retry.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await savedWhen(page, (s) => s.edges.some((e) => e.from === "billing" && e.to === "cache"));
  });
}

test("Escape stops connection auto-pan before release", async ({ page }) => {
  await seed(page);
  await pauseClock(page);
  const from = centre(await box(page.getByTestId("handle-billing-bottom")));
  const pane = await box(page.getByTestId("canvas-wrap"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 5, pane.y + pane.height / 2, { steps: 10 });
  await expect(page.getByTestId("connection-line")).toBeVisible();
  const transform = () =>
    page.getByTestId("rf__node-billing").evaluate((el) => el.parentElement?.parentElement?.style.transform);
  const before = await transform();
  await page.clock.runFor(8 * 16);
  expect(await transform()).not.toBe(before);
  await page.keyboard.press("Escape");
  await page.clock.runFor(16);
  const stopped = await transform();
  await page.clock.runFor(8 * 16);
  expect(await transform()).toBe(stopped);
  await page.mouse.up();
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("auto-pan keeps the connection's end and its plus under a still pointer, and drops there", async ({ page }) => {
  await seed(page);
  await pauseClock(page);
  const from = centre(await box(page.getByTestId("handle-billing-bottom")));
  const pane = await box(page.getByTestId("canvas-wrap"));
  // Empty canvas at the right edge, above the row of nodes: auto-pan runs, and a drop here opens quick-add.
  const still = { x: pane.x + pane.width - 5, y: pane.y + pane.height * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(still.x, still.y, { steps: 10 });
  const plus = page.getByTestId("connection-add");
  await expect(plus).toBeVisible();
  const transform = () =>
    page.getByTestId("rf__node-billing").evaluate((el) => el.parentElement?.parentElement?.style.transform);
  const before = await transform();
  await page.clock.runFor(8 * 16);
  expect(await transform()).not.toBe(before);
  // The diagram moved under the pointer; the line's end and the plus did not.
  await expect.poll(async () => apart(centre(await box(plus)), still)).toBeLessThanOrEqual(1.5);
  expect(apart(await pathEnd(page.getByTestId("connection-line")), still)).toBeLessThanOrEqual(1.5);
  await page.mouse.up();
  await expect(page.getByTestId("quick-add")).toBeVisible();
  // Where the drop is in the diagram, with the viewport as it ended.
  const drop = await flowPoint(page, still);
  await page.clock.resume();
  await page.keyboard.type("redis cache");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Escape");
  const d = await savedWhen(page, (s) => s.nodes.length === SEED.nodes.length + 1);
  const made = must(
    d.nodes.find((n) => !SEED.nodes.some((x) => x.id === n.id)),
    "the new node",
  );
  expect(d.edges.some((e) => e.from === "billing" && e.to === made.id)).toBe(true);
  // Centred on the drop point, to the 10 px grid.
  const at = await flowPos(page, `node-${made.id}`);
  const size = await page.getByTestId(`node-${made.id}`).evaluate((el) => {
    const n = el.closest<HTMLElement>(".react-flow__node");
    return { width: n?.offsetWidth ?? 0, height: n?.offsetHeight ?? 0 };
  });
  expect(
    apart({ x: at.x + size.width / 2, y: at.y + size.height / 2 }, drop),
    JSON.stringify({ at, size, drop }),
  ).toBeLessThanOrEqual(5.5);
});

test.describe("attach to a dot", () => {
  const nodes = SEED.nodes
    .filter((n) => ["api", "db", "billing"].includes(n.id))
    .map((n) => (n.id === "db" ? { ...n, x: 500 } : n.id === "billing" ? { ...n, x: 250, y: -220 } : n));
  const pinned = [{ ...SEED.edges[0], sourceSide: "bottom", targetSide: "top" }];
  async function open(page: Page, edges: typeof SEED.edges = []) {
    await seed(page, { ...SEED, nodes, edges });
    await fitDiagram(page);
    await waitForCameraIdle(page);
  }
  async function drag(page: Page, from: Locator, to: Locator) {
    const a = centre(await box(from));
    const b = centre(await box(to));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
  }
  async function selectEnd(page: Page) {
    await page.getByTestId("edge-label-api-db").click();
    await waitForSelectionSettled(page);
    await fitDiagram(page);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("reconnect-api-db-target")).toBeVisible();
  }

  test("nearest grow handle keeps preview and commit consistent", async ({ page }) => {
    await open(page);
    await page.getByTestId("node-db").click();
    await waitForSelectionSettled(page);
    await fitDiagram(page);
    await waitForCameraIdle(page);
    await page.getByTestId("zoom-out-button").click();
    await waitForStableViewport(page);
    const chip = page.getByTestId("grow-chip-db");
    await expect(chip).toHaveAttribute("data-side", "right");
    const dotBox = await box(page.getByTestId("handle-db-right"));
    const growBox = await box(chip);
    const dot = centre(dotBox);
    const grow = centre(growBox);
    const at = { x: dot.x + 14, y: dot.y + 12 };
    expect(at.y).toBeGreaterThan(Math.max(dotBox.y + dotBox.height, growBox.y + growBox.height));
    expect(Math.hypot(at.x - grow.x, at.y - grow.y)).toBeLessThan(Math.hypot(at.x - dot.x, at.y - dot.y));
    const from = centre(await box(page.getByTestId("handle-api-bottom")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y, { steps: 12 });
    await expect(page.getByTestId("handle-db-right")).toHaveClass(/is-connect-port/);
    const far = { x: grow.x + 14, y: grow.y + 12 };
    await page.mouse.move(far.x, far.y, { steps: 4 });
    await expect(page.getByTestId("connection-line")).toHaveAttribute("data-over", "canvas");
    await expect(page.getByTestId("connection-add")).toBeVisible();
    const plus = await page.getByTestId("connection-add").evaluate((el) => {
      const matrix = (el as unknown as SVGGraphicsElement).getScreenCTM();
      if (!matrix) throw new Error("Missing plus transform");
      const point = new DOMPoint(0, 0).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    expect(Math.hypot(plus.x - far.x, plus.y - far.y)).toBeLessThanOrEqual(2);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await expect(page.getByTestId("handle-db-right")).toHaveClass(/is-connect-port/);
    const lineEnd = await page.getByTestId("connection-line").evaluate((el) => {
      const path = [...el.children].find((child) => child instanceof SVGPathElement);
      if (!(path instanceof SVGPathElement)) throw new Error("Missing connection path");
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error("Missing connection transform");
      const p = path.getPointAtLength(path.getTotalLength());
      const end = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return { x: end.x, y: end.y };
    });
    const highlighted = centre(await box(page.getByTestId("handle-db-right")));
    expect(
      Math.hypot(lineEnd.x - highlighted.x, lineEnd.y - highlighted.y),
      JSON.stringify({ lineEnd, highlighted }),
    ).toBeLessThanOrEqual(2);
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges.length === 1);
    expect(d.edges[0]).toMatchObject({ from: "api", to: "db", sourceSide: "bottom", targetSide: "right" });
    await undoUntil(page, (s) => s.edges.length === 0, 1);
  });

  for (const movement of [0, 2]) {
    test(`a same-node reconnect requires drag activation (${movement}px movement)`, async ({ page }) => {
      await open(page, SEED.edges);
      await selectEnd(page);
      const end = centre(await box(page.getByTestId("reconnect-api-db-target")));
      await page.mouse.move(end.x, end.y);
      await page.mouse.down();
      if (movement) await page.mouse.move(end.x + movement, end.y, { steps: 2 });
      await page.mouse.up();
      await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
      await expect(page.getByTestId("undo-button")).toBeDisabled();
      expect((await saved(page)).edges).toEqual(SEED.edges);
    });
  }

  for (const pick of ["stencil", "shape"] as const) {
    test(`empty-canvas quick-add retains the starting dot: ${pick}`, async ({ page }) => {
      await open(page);
      const from = centre(await box(page.getByTestId("handle-api-bottom")));
      const pane = await box(page.getByTestId("canvas-wrap"));
      const at = { x: from.x + 60, y: Math.min(from.y + 70, pane.y + pane.height - 105) };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(at.x, at.y, { steps: 12 });
      await expect(page.getByTestId("connection-add")).toBeVisible();
      await page.mouse.up();
      await expect(page.getByTestId("quick-add")).toBeVisible();
      await page.keyboard.type(pick === "stencil" ? "redis cache" : "ellipse");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId(pick === "shape" ? "annotation-editor" : "inspector-field-label")).toBeFocused();
      await page.keyboard.type("Review target");
      await page.keyboard.press(pick === "shape" ? `${MOD}+Enter` : "Enter");
      const d = await savedWhen(
        page,
        (s) =>
          s.edges.length === 1 &&
          (pick === "shape"
            ? s.annotations?.some((a) => a.text === "Review target") === true
            : s.nodes.some((n) => n.label === "Review target")),
      );
      expect(d.edges[0].sourceSide).toBe("bottom");
      expect(d.edges[0].targetSide).toBeUndefined();
      await undoUntil(
        page,
        (s) => s.edges.length === 0 && s.nodes.length === 3 && (s.annotations?.length ?? 0) === 0,
        1,
      );
    });
  }

  test("bottom to top pins both ends, starts at the dot and undoes once", async ({ page }) => {
    await open(page);
    await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
    await expect(page.getByTestId("handle-db-top")).toHaveClass(/is-connect-port/);
    await expect(page.getByTestId("rf__node-db")).toHaveClass(/has-connect-port/);
    await expect
      .poll(() => page.getByTestId("handle-db-left").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges[0]?.sourceSide === "bottom" && s.edges[0]?.targetSide === "top");
    expect(d.edges).toHaveLength(1);
    const edge = page.getByTestId(`edge-${d.edges[0].id}`);
    await expect(edge).toHaveAttribute("data-source-side", "bottom");
    await expect(edge).toHaveAttribute("data-target-side", "top");
    await waitForStableViewport(page);
    const start = await edge.evaluate((el) => {
      const path = [...el.children].find((child) => child instanceof SVGPathElement);
      if (!(path instanceof SVGPathElement)) throw new Error("Missing edge path");
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error("Missing edge transform");
      const p = path.getPointAtLength(0);
      const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
    const dot = centre(await box(page.getByTestId("handle-api-bottom")));
    expect(Math.hypot(start.x - dot.x, start.y - dot.y)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
    await undoUntil(page, (s) => s.edges.length === 0, 1);
  });

  test("dot to body fixes only the source, reuses the pair and undoes once", async ({ page }) => {
    await open(page, SEED.edges);
    await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("node-db"));
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges[0]?.sourceSide === "bottom");
    expect(d.edges).toEqual([{ ...SEED.edges[0], sourceSide: "bottom" }]);
    await expect(page.getByTestId("edge-api-db")).toHaveClass(/is-selected/);
    await undoUntil(page, (s) => !s.edges[0]?.sourceSide && !s.edges[0]?.targetSide, 1);
  });

  test("the side dot's hit area keeps preview and committed side consistent beside the plus", async ({ page }) => {
    await open(page);
    await page.getByTestId("node-db").click();
    await waitForSelectionSettled(page);
    await fitDiagram(page);
    await waitForCameraIdle(page);
    const chip = page.getByTestId("grow-chip-db");
    await page.getByTestId("zoom-out-button").click();
    await waitForStableViewport(page);
    const side = await chip.getAttribute("data-side");
    expect(side).not.toBe("corner");
    await drag(page, page.getByTestId("handle-api-bottom"), chip);
    const dot = page.getByTestId(`handle-db-${side}`);
    await expect(dot).toHaveClass(/is-connect-port/);
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges.length === 1);
    expect(d.edges[0].sourceSide).toBe("bottom");
    expect(d.edges[0].targetSide).toBe(side);
    await undoUntil(page, (s) => s.edges.length === 0, 1);
  });

  for (const node of ["db", "billing"] as const) {
    test(`reconnect onto ${node}'s left dot keeps meaning and undoes once`, async ({ page }) => {
      await open(page, pinned);
      await selectEnd(page);
      await drag(page, page.getByTestId("reconnect-api-db-target"), page.getByTestId(`handle-${node}-left`));
      await expect(page.getByTestId(`handle-${node}-left`)).toHaveClass(/is-connect-port/);
      await page.mouse.up();
      const d = await savedWhen(page, (s) => s.edges[0]?.to === node && s.edges[0]?.targetSide === "left");
      expect(d.edges).toEqual([{ ...pinned[0], to: node, targetSide: "left" }]);
      await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-target-side", "left");
      await undoUntil(page, (s) => s.edges[0]?.to === "db" && s.edges[0]?.targetSide === "top", 1);
    });
  }

  for (const [node, side] of [
    ["api", "right"],
    ["billing", "left"],
  ] as const) {
    test(`source end onto ${node}'s ${side} dot keeps the target's attachment and undoes once`, async ({ page }) => {
      await open(page, pinned);
      await selectEnd(page);
      await expect(page.getByTestId("reconnect-api-db-source")).toBeVisible();
      await drag(page, page.getByTestId("reconnect-api-db-source"), page.getByTestId(`handle-${node}-${side}`));
      await expect(page.getByTestId(`handle-${node}-${side}`)).toHaveClass(/is-connect-port/);
      await page.mouse.up();
      const d = await savedWhen(page, (s) => s.edges[0]?.from === node && s.edges[0]?.sourceSide === side);
      expect(d.edges).toEqual([{ ...pinned[0], from: node, sourceSide: side }]);
      await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-source-side", side);
      await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-target-side", "top");
      await undoUntil(page, (s) => s.edges[0]?.from === "api" && s.edges[0]?.sourceSide === "bottom", 1);
    });
  }

  test("held reconnect follows viewport zoom without pointer movement", async ({ page }) => {
    await open(page, pinned);
    await selectEnd(page);
    // Low zoom: the snap radius is wide in the diagram (50 px at 0.4).
    for (let i = 0; i < 10 && (await flowState(page)).zoom > 0.45; i++) {
      await page.getByTestId("zoom-out-button").click();
      await waitForStableViewport(page);
    }
    const { zoom } = await flowState(page);
    expect(zoom).toBeLessThanOrEqual(0.45);
    const dot = page.getByTestId("handle-billing-left");
    const near = centre(await box(dot));
    // 40 diagram px left of billing's left dot: empty canvas, inside the radius now, outside it from zoom 0.75.
    const still = { x: near.x - 40 * zoom, y: near.y };
    const from = centre(await box(page.getByTestId("reconnect-api-db-target")));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(still.x, still.y, { steps: 10 });
    await expect(dot).toHaveClass(/is-connect-port/);
    await expect(page.getByTestId("rf__node-billing")).toHaveClass(/is-connect-target/);
    // Ctrl+wheel zooms around the pointer without moving it: the point under it stays, the radius narrows.
    await page.keyboard.down("Control");
    for (let i = 0; i < 20 && (await flowState(page)).zoom < 0.75; i++) {
      const before = (await flowState(page)).zoom;
      await page.mouse.wheel(0, -100);
      await expect.poll(async () => (await flowState(page)).zoom).toBeGreaterThan(before);
      await waitForStableViewport(page);
    }
    await page.keyboard.up("Control");
    expect((await flowState(page)).zoom).toBeGreaterThanOrEqual(0.75);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
    await expect(dot).not.toHaveClass(/is-connect-port/);
    await expect(page.getByTestId("rf__node-billing")).not.toHaveClass(/is-connect-target/);
    await expect
      .poll(async () => apart(await pathEnd(page.getByTestId("reconnect-line")), still))
      .toBeLessThanOrEqual(1.5);
    // Onto the dot where the zoom put it: that's what commits, in one undo step.
    const moved = centre(await box(dot));
    await page.mouse.move(moved.x, moved.y, { steps: 5 });
    await expect(dot).toHaveClass(/is-connect-port/);
    expect(apart(await pathEnd(page.getByTestId("reconnect-line")), moved)).toBeLessThanOrEqual(1.5);
    await page.mouse.up();
    const d = await savedWhen(page, (s) => s.edges[0]?.to === "billing" && s.edges[0]?.targetSide === "left");
    expect(d.edges).toEqual([{ ...pinned[0], to: "billing", targetSide: "left" }]);
    await undoUntil(page, (s) => s.edges[0]?.to === "db" && s.edges[0]?.targetSide === "top", 1);
  });

  const DOTS = chunk("connectTarget", "src/canvas/interaction/connectTarget.ts");

  for (const reason of ["Escape", "pointer cancellation"] as const)
    test(`late dot resolver stays inert after ${reason}`, async ({ page }) => {
      const dots = await holdChunk(page, DOTS);
      try {
        await open(page);
        await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
        await expect.poll(() => dots.requests).toBeGreaterThan(0);
        await expect(page.getByTestId("rf__node-db")).toHaveClass(/is-connect-target/);
        if (reason === "Escape") await page.keyboard.press("Escape");
        else
          await page
            .getByTestId("handle-api-bottom")
            .dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true, pointerType: "mouse" });
        await page.mouse.up();
        await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-interaction-state", "gesture");
        const loaded = page.waitForResponse(DOTS);
        dots.release();
        await loaded;
        // A fresh gesture proves that the resolver has executed, then cancellation retires that owner too.
        await drag(page, page.getByTestId("handle-api-right"), page.getByTestId("handle-billing-left"));
        await expect(page.getByTestId("handle-billing-left")).toHaveClass(/is-connect-port/);
        await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
        await expect(page.getByTestId("rf__node-db")).not.toHaveClass(/is-connect-target/);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.getByTestId("connection-line")).toHaveCount(0);
        await expect(page.getByTestId("undo-button")).toBeDisabled();
        expect((await saved(page))?.edges).toEqual([]);
      } finally {
        dots.release();
      }
    });

  test("while the dots' resolver downloads a drop attaches to the node; it takes a dot the moment it arrives", async ({
    page,
  }) => {
    const dots = await holdChunk(page, DOTS);
    try {
      await open(page);
      await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
      await expect.poll(() => dots.requests).toBeGreaterThan(0);
      // The node lights up, as before dots; its dot doesn't, and the drop attaches to the node.
      await expect(page.getByTestId("rf__node-db")).toHaveClass(/is-connect-target/);
      await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
      await page.mouse.up();
      const body = await savedWhen(page, (s) => s.edges.length === 1);
      expect(body.edges[0]).toMatchObject({ from: "api", to: "db", sourceSide: "bottom" });
      expect(body.edges[0]).not.toHaveProperty("targetSide");
      await undoUntil(page, (s) => s.edges.length === 0, 1);
      // Held again over the dot, then the code arrives: the preview takes the dot without another pointer move.
      await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
      await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
      dots.release();
      await expect(page.getByTestId("handle-db-top")).toHaveClass(/is-connect-port/);
      await page.mouse.up();
      const dot = await savedWhen(page, (s) => s.edges[0]?.targetSide === "top");
      expect(dot.edges).toHaveLength(1);
      expect(dot.edges[0]).toMatchObject({ from: "api", to: "db", sourceSide: "bottom", targetSide: "top" });
    } finally {
      dots.release();
    }
  });

  test("a failed dots download still connects to nodes, and the toast's Retry brings the dots", async ({ page }) => {
    const dots = await holdChunk(page, DOTS);
    dots.fail = true;
    dots.release();
    await open(page);
    await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Part of the app couldn't be downloaded");
    await expect(toast).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("rf__node-db")).toHaveClass(/is-connect-target/);
    await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
    await page.mouse.up();
    const body = await savedWhen(page, (s) => s.edges.length === 1);
    expect(body.edges[0]).toMatchObject({ from: "api", to: "db" });
    expect(body.edges[0]).not.toHaveProperty("targetSide");
    // The drop's own notice replaced that one; the next gesture asks again and says so again. Cancel it, then Retry.
    const asked = dots.requests;
    await drag(page, page.getByTestId("handle-api-right"), page.getByTestId("handle-billing-left"));
    await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
    expect(dots.requests).toBeGreaterThan(asked);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
    dots.fail = false;
    const retried = dots.requests;
    await page.getByTestId("lazy-load-retry").click();
    await expect.poll(() => dots.requests).toBeGreaterThan(retried);
    await drag(page, page.getByTestId("handle-api-right"), page.getByTestId("handle-billing-left"));
    await expect(page.getByTestId("handle-billing-left")).toHaveClass(/is-connect-port/);
    await page.mouse.up();
    await savedWhen(page, (s) => s.edges.some((e) => e.to === "billing" && e.targetSide === "left"));
  });

  test("Escape cancels a dot connection, clears the highlight and adds no undo", async ({ page }) => {
    await open(page);
    await drag(page, page.getByTestId("handle-api-bottom"), page.getByTestId("handle-db-top"));
    await expect(page.getByTestId("handle-db-top")).toHaveClass(/is-connect-port/);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("connection-line")).toHaveCount(0);
    await expect(page.getByTestId("handle-db-top")).not.toHaveClass(/is-connect-port/);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    expect((await saved(page))?.edges).toEqual([]);
  });

  test("Escape cancels a same-node dot reconnect without an undo step", async ({ page }) => {
    await open(page, pinned);
    await selectEnd(page);
    await drag(page, page.getByTestId("reconnect-api-db-target"), page.getByTestId("handle-db-left"));
    await expect(page.getByTestId("handle-db-left")).toHaveClass(/is-connect-port/);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
    await expect(page.getByTestId("handle-db-left")).not.toHaveClass(/is-connect-port/);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    expect((await saved(page))?.edges).toEqual(pinned);
  });
});
