import { savedDiagram } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  fitDiagram,
  waitForStableViewport,
  pauseClock,
  STORAGE_KEYS,
} from "./fixtures";

// Flow building (docs/research/drawing-ux.md, batch 3): the "+" on a selected node and Alt+arrow quick-add
// with Alt+Shift+arrow clone-and-connect (D3), reconnecting an edge's end and inserting a node by dropping
// it on an edge (D8), and the stencil rail's drag preview and selection-aware clicks (D13).
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
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
  edges: { id: string; from: string; to: string; kind?: string; label?: string; relation?: string; props?: object }[];
};

async function seed(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(SEED)] as const,
  );
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-hub")).toBeVisible();
  await waitForStableViewport(page);
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

/** Selects a node with a click on its card (which also focuses it, so canvas keys reach it). */
async function select(page: Page, id: string) {
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId(`grow-chip-${id}`)).toBeVisible();
}

/**
 * Clicks Undo up to `max` times until `gone` holds: a name typed right after an add is its own step. The
 * history records a step once edits settle (350 ms) and the autosave follows 300 ms later.
 */
async function undoUntil(page: Page, gone: (d: Saved) => boolean, max = 3) {
  for (let i = 0; i < max; i++) {
    await page.waitForTimeout(450);
    await page.getByTestId("undo-button").click();
    for (let t = 0; t < 8; t++) {
      await page.waitForTimeout(150);
      const d = await saved(page);
      if (d && gone(d)) return;
    }
  }
  await savedWhen(page, gone);
}

/** Holds the pointer on a point long enough for an edge under it to light up. */
async function hold(page: Page, p: { x: number; y: number }) {
  await page.mouse.move(p.x + 2, p.y, { steps: 2 });
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.waitForTimeout(450);
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
    await page.keyboard.down("Shift");
    await page.getByTestId("node-api").click();
    await page.keyboard.up("Shift");
    await expect(chips).toHaveCount(0);

    await page.keyboard.press("Escape");
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
    await page.getByTestId("edge-label-api-db").click();
    const end = page.getByTestId("reconnect-api-db-target");
    await expect(end).toBeVisible();
    await expect(page.getByTestId("reconnect-api-db-source")).toBeVisible();
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
    const from = centre(await box(page.getByTestId("reconnect-api-db-source")));
    const wrap = await box(page.getByTestId("canvas-wrap"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(wrap.x + 60, wrap.y + wrap.height - 140, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("reconnect-line")).toHaveCount(0);
    await page.waitForTimeout(500);
    const d = await saved(page);
    expect(d?.edges[0] ?? SEED.edges[0]).toMatchObject({ from: "api", to: "db" });
  });

  test("Esc during a reconnect over a valid node cancels it: nothing changes, nothing to undo", async ({ page }) => {
    await page.getByTestId("edge-label-api-db").click();
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
    await page.waitForTimeout(600);
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
    await page.waitForTimeout(500);
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
    await page.waitForTimeout(500);
    expect(must(await saved(page), "the autosave").edges).toHaveLength(1);
  });

  test("a connected node never splits an edge it's dropped on", async ({ page }) => {
    // Connect billing first, so it has an edge.
    await select(page, "billing");
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.type("redis");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await savedWhen(page, (s) => s.edges.length === 2);
    // The new node was brought into view (a pan): measure after it settles.
    await waitForStableViewport(page);
    const before = await flowPos(page, "node-billing");
    const press = centre(await box(page.getByTestId("node-billing")));
    const mid = await edgeMiddle(page, "api-db");
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 10 });
    await hold(page, mid);
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
    await expect(page.getByTestId("palette-search")).toBeVisible();
  });

  /** Finds a stencil in the rail. */
  async function railItem(page: Page, query: string, id: string) {
    await page.getByTestId("palette-search").fill(query);
    const item = page.getByTestId(`palette-item-${id}`);
    await expect(item).toBeVisible();
    return item;
  }

  test("dragging a stencil shows a node card, not the browser's picture of the row", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
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
    await item.dispatchEvent("dragend", { dataTransfer: dt });
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId("landing-outline")).toHaveCount(0);
    await savedWhen(page, (s) => s.nodes.length === 6);
  });

  test("a stencil held over an edge and dropped goes in between", async ({ page }) => {
    const item = await railItem(page, "redis cache", "redis.cache");
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent("dragstart", { dataTransfer: dt });
    const mid = await edgeMiddle(page, "api-db");
    const at = { clientX: mid.x, clientY: mid.y };
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await page.waitForTimeout(400);
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-insert", "1");
    await page.getByTestId("canvas-wrap").dispatchEvent("drop", { dataTransfer: dt, ...at });
    await item.dispatchEvent("dragend", { dataTransfer: dt });
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
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent("dragstart", { dataTransfer: dt });
    const at = centre(await box(page.getByTestId("node-api")));
    const drop = { dataTransfer: dt, clientX: at.x, clientY: at.y };
    await page.getByTestId("canvas-wrap").dispatchEvent("dragover", drop);
    // Over a node: no outline (it won't land there), the node lights up instead.
    await expect(page.getByTestId("landing-outline")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").dispatchEvent("drop", drop);
    await item.dispatchEvent("dragend", { dataTransfer: dt });
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
  await key("Control+k");
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
  await key("Control+k");
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
