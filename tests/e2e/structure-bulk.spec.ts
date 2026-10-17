import { savedDiagram } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  expectNoErrors,
  fitDiagram,
  waitForStableViewport,
  waitForSelectionSettled,
  STORAGE_KEYS,
} from "./fixtures";

// Structure and bulk (docs/research/drawing-ux.md, batch 4): boundaries that keep up (D12), bulk edit in the
// inspector and Select similar (D11), tidy the selection (D15), and keyboard selection between nodes (D14).
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const KEY = STORAGE_KEYS.autosavePrefix + SLUG;
const MOD = "ControlOrMeta";
/** Nodes, not their tooltip or inline editor. */
const NODES = /^node-(?!tooltip$|editor)/;

/**
 * Known geometry (cards 220 × 72). Payments (0, 0, 640 × 400) holds Orders API, Payment worker and Ledger;
 * Shipping (1000, 0, 600 × 400) holds Carrier API; Cache and Billing sit below, in no boundary, and a note
 * between them.
 */
const SEED = {
  format: "diagrams/v1",
  title: "Structure and bulk",
  groups: [
    { id: "pay", label: "Payments", tone: "azure", x: 0, y: 0, width: 640, height: 400 },
    { id: "ship", label: "Shipping", tone: "aws", x: 1000, y: 0, width: 600, height: 400 },
  ],
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 40, y: 80, group: "pay" },
    { id: "worker", stencil: "service.go", label: "Payment worker", x: 380, y: 80, group: "pay" },
    { id: "ledger", stencil: "postgres", label: "Ledger", x: 40, y: 260, group: "pay" },
    { id: "carrier", stencil: "service.node", label: "Carrier API", x: 1060, y: 80, group: "ship" },
    { id: "cache", stencil: "redis.cache", label: "Cache", x: 700, y: 560 },
    { id: "billing", stencil: "service.go", label: "Billing", x: 1060, y: 560 },
  ],
  edges: [
    { id: "a-w", from: "api", to: "worker", label: "Authorize" },
    { id: "w-l", from: "worker", to: "ledger", kind: "sync" },
    { id: "a-c", from: "api", to: "carrier", label: "Ship order" },
  ],
  annotations: [
    { id: "n1", kind: "note", text: "Retry budget", x: 300, y: 560, width: 160, height: 100 },
    { id: "n2", kind: "note", text: "Carrier SLA", x: 1400, y: 560, width: 160, height: 100, color: "blue" },
  ],
};

type Saved = {
  groups?: { id: string; x: number; y: number; width: number; height: number; tone?: string }[];
  nodes: { id: string; stencil: string; label: string; x: number; y: number; group?: string }[];
  edges: { id: string; from: string; to: string; kind?: string; label?: string; relation?: string }[];
  annotations?: { id: string; color?: string }[];
};

async function seed(page: Page, viewport = { width: 1440, height: 900 }, diagram: object = SEED) {
  await page.setViewportSize(viewport);
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
  if (diagram === SEED) await expect(page.getByTestId("node-billing")).toBeVisible();
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
  if (!last) throw new Error("Expected the autosave");
  return last;
}
function found<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`Expected ${what}`);
  return v;
}
const node = (d: Saved, id: string) =>
  found(
    d.nodes.find((n) => n.id === id),
    `node ${id}`,
  );
const group = (d: Saved, id: string) =>
  found(
    d.groups?.find((g) => g.id === id),
    `boundary ${id}`,
  );

type Box = { x: number; y: number; width: number; height: number };
async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The view's zoom and where flow (0, 0) is on screen, from the Payments boundary (at 0, 0, 640 wide). */
async function view(page: Page) {
  const b = await box(page.getByTestId("group-pay"));
  return { k: b.width / 640, x: b.x, y: b.y };
}
/** Flow coordinates to screen. Valid while Payments hasn't moved or grown. */
async function toScreen(page: Page, p: { x: number; y: number }) {
  const v = await view(page);
  return { x: v.x + p.x * v.k, y: v.y + p.y * v.k };
}

/**
 * Drags a node's card so its centre ends at `to` (screen), slowly, and calls `during` while it's still held.
 */
async function dragTo(page: Page, id: string, to: { x: number; y: number }, during?: () => Promise<void>) {
  const from = centre(await box(page.getByTestId(`node-${id}`)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  // Rest so the guides settle where the pointer is.
  await page.waitForTimeout(150);
  if (during) await during();
  await page.mouse.up();
}

/** The selected nodes and edges, by test id. */
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

/** Every node's box on screen, by test id. */
async function nodeBoxes(page: Page) {
  const ids = await page.getByTestId(NODES).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
  const out = new Map<string, Box>();
  for (const id of ids) out.set(id, await box(page.getByTestId(id)));
  return out;
}

const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
/** Items on each open level of the context menu. */
const menuCounts = (page: Page) =>
  page
    .getByTestId(/^context-menu(?:-sub)*$/)
    .evaluateAll((menus) => menus.map((m) => m.querySelectorAll('[data-testid^="context-menu-item-"]').length));

test.describe("boundaries that keep up (D12)", () => {
  test("a boundary lights up while a node is dragged into it, and grows on drop to hold it", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page);
    // Cache's centre to just inside Shipping's right edge: the card pokes 70 px out.
    const to = await toScreen(page, { x: 1560, y: 200 });
    await dragTo(page, "cache", to, async () => {
      await expect(page.getByTestId("group-ship")).toHaveAttribute("data-membership", "join");
      await expect(page.getByTestId("group-pay")).not.toHaveAttribute("data-membership", /.+/);
    });
    // The outline goes with the drag.
    await expect(page.getByTestId("group-ship")).not.toHaveAttribute("data-membership", /.+/);
    const d = await savedWhen(page, (s) => node(s, "cache").group === "ship");
    const ship = group(d, "ship");
    const cache = node(d, "cache");
    // Grown to hold it with the usual padding (40 px), on its right only.
    expect(ship.x + ship.width).toBeGreaterThanOrEqual(cache.x + 220 + 40);
    expect(ship.x).toBe(1000);
    expect(ship.y).toBe(0);
    expect(ship.height).toBe(400);
    // Nothing else moved or grew.
    expect(group(d, "pay")).toMatchObject({ x: 0, y: 0, width: 640, height: 400 });
    expectNoErrors(consoleErrors);
  });

  test("a member poking out keeps its boundary lit, grows it, and one undo takes both back", async ({ page }) => {
    await seed(page);
    // Ledger down until it pokes out of Payments' bottom, its centre still inside.
    const at = centre(await box(page.getByTestId("node-ledger")));
    const v = await view(page);
    await dragTo(page, "ledger", { x: at.x, y: at.y + 90 * v.k }, async () => {
      await expect(page.getByTestId("group-pay")).toHaveAttribute("data-membership", "hold");
    });
    const d = await savedWhen(page, (s) => group(s, "pay").height > 400);
    const ledger = node(d, "ledger");
    expect(ledger.group).toBe("pay");
    expect(group(d, "pay").y + group(d, "pay").height).toBeGreaterThanOrEqual(ledger.y + 72 + 40);
    // The boundary's growth is the drop's undo step.
    await page.getByTestId("undo-button").click();
    const back = await savedWhen(page, (s) => group(s, "pay").height === 400);
    expect(node(back, "ledger")).toMatchObject({ x: 40, y: 260, group: "pay" });
  });

  test("leaving a boundary is explicit: dashed while dragging, said on drop, with Undo", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page);
    // Payment worker's centre out past Payments' right edge, into the gap before Shipping.
    const to = await toScreen(page, { x: 820, y: 116 });
    await dragTo(page, "worker", to, async () => {
      await expect(page.getByTestId("group-pay")).toHaveAttribute("data-membership", "leave");
    });
    await expect(page.getByTestId("toast")).toContainText("Payment worker left Payments");
    let d = await savedWhen(page, (s) => node(s, "worker").group === undefined);
    // Leaving never shrinks or grows the boundary.
    expect(group(d, "pay")).toMatchObject({ x: 0, y: 0, width: 640, height: 400 });
    await page.getByTestId("membership-undo").click();
    d = await savedWhen(page, (s) => node(s, "worker").group === "pay");
    expect(node(d, "worker")).toMatchObject({ x: 380, y: 80 });
    expectNoErrors(consoleErrors);
  });

  test("resizing a boundary adopts the nodes now inside it, and says so", async ({ page }) => {
    await seed(page);
    await page.getByTestId("group-label-ship").click();
    // The selected boundary's corner can be behind the opening Inspector. Fit
    // the settled canvas, then target the real handle rather than an old corner.
    await waitForSelectionSettled(page);
    await fitDiagram(page);
    const resize = page.getByTestId("group-resize-ship-bottom-right");
    await resize.hover();
    const handle = centre(await box(resize));
    const v = await view(page);
    // Down past Billing (at 1060, 560): Billing's centre comes inside.
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y + 300 * v.k, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId("toast")).toContainText("Added 1 node to Shipping");
    await savedWhen(page, (s) => node(s, "billing").group === "ship");
  });
});

test.describe("bulk edit and Select similar (D11)", () => {
  test("several nodes: Stencil and Boundary show Mixed, apply to all, and each change is one undo", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page);
    const selectThree = async () => {
      await page.getByTestId("node-api").click();
      await expect(page.getByTestId("inspector-title")).toHaveText("Node");
      await fitDiagram(page);
      await page.getByTestId("node-worker").click({ modifiers: [MOD] });
      await page.getByTestId("node-carrier").click({ modifiers: [MOD] });
      await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    };
    await selectThree();
    const stencil = page.getByTestId("inspector-field-stencil");
    const boundary = page.getByTestId("inspector-field-group");
    // Node.js, Go and Node.js; Payments, Payments and Shipping.
    await expect(stencil).toContainText("Mixed");
    await expect(boundary).toHaveValue("__mixed");
    await expect(boundary.locator("option:checked")).toHaveText("Mixed");

    await stencil.click();
    await page.getByTestId("stencil-picker-search").fill("postgres");
    await menuItem(page, "pick-stencil:postgres").click();
    await savedWhen(page, (s) => ["api", "worker", "carrier"].every((id) => node(s, id).stencil === "postgres"));
    await expect(stencil).not.toContainText("Mixed");
    // One undo takes all three back.
    await page.getByTestId("undo-button").click();
    let d = await savedWhen(page, (s) => node(s, "api").stencil === "service.node");
    expect([node(d, "worker").stencil, node(d, "carrier").stencil]).toEqual(["service.go", "service.node"]);
    // Undo keeps the three selected, and their panel open.
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await expect(stencil).toContainText("Mixed");

    await boundary.selectOption("ship");
    await savedWhen(page, (s) => ["api", "worker", "carrier"].every((id) => node(s, id).group === "ship"));
    await expect(boundary).toHaveValue("ship");
    await page.getByTestId("undo-button").click();
    d = await savedWhen(page, (s) => node(s, "api").group === "pay");
    expect([node(d, "worker").group, node(d, "carrier").group]).toEqual(["pay", "ship"]);
    // Undo keeps the three selected, and their panel open.
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await expect(boundary).toHaveValue("__mixed");
    expectNoErrors(consoleErrors);
  });

  test("Select similar picks every node of the stencil, from the right-click and from Ctrl+K", async ({ page }) => {
    await seed(page);
    await page.getByTestId("node-api").click({ button: "right" });
    await menuItem(page, "item.select-similar").click();
    // Orders API and Carrier API are both Node.js services.
    await expect.poll(() => selectedIds(page)).toEqual(["node-api", "node-carrier"]);
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");

    await page.getByTestId("node-worker").click();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("select similar");
    await page.keyboard.press("Enter");
    await expect.poll(() => selectedIds(page)).toEqual(["node-billing", "node-worker"]);
  });

  test("Select similar on an edge, then one Relationship and Label for both, one undo each", async ({ page }) => {
    await seed(page);
    const selectMessages = async () => {
      await page.getByTestId("edge-label-a-w").click({ button: "right" });
      await menuItem(page, "item.select-similar").click();
    };
    await selectMessages();
    // The two messages (the request from the worker to the ledger is another relationship).
    await expect.poll(() => selectedIds(page)).toEqual(["edge-a-c", "edge-a-w"]);
    const relation = page.getByTestId("inspector-field-relation");
    const label = page.getByTestId("inspector-field-label");
    await expect(relation).toContainText("Message");
    // "Authorize" and "Ship order": the label is mixed.
    await expect(label).toHaveValue("");
    await expect(label).toHaveAttribute("placeholder", "Mixed");
    await relation.click();
    await menuItem(page, "request").click();
    await savedWhen(page, (s) => s.edges.filter((e) => e.kind === "sync").length === 3);
    await page.getByTestId("undo-button").click();
    await savedWhen(page, (s) => s.edges.filter((e) => e.kind === "sync").length === 1);
    await selectMessages();
    await label.fill("Event");
    await savedWhen(page, (s) => ["a-w", "a-c"].every((id) => s.edges.find((e) => e.id === id)?.label === "Event"));
    await page.getByTestId("undo-button").click();
    const d = await savedWhen(page, (s) => s.edges.find((e) => e.id === "a-w")?.label === "Authorize");
    expect(d.edges.find((e) => e.id === "a-c")?.label).toBe("Ship order");
  });

  test("a mixed relationship dropdown announces Mixed and applies one keyboard choice to both edges", async ({
    page,
  }) => {
    await seed(
      page,
      { width: 1440, height: 900 },
      {
        ...SEED,
        edges: [
          { ...SEED.edges[0], kind: "async" },
          { ...SEED.edges[2], kind: "sync" },
        ],
      },
    );
    await page.getByTestId("edge-label-a-w").click();
    await page.getByTestId("edge-label-a-c").click({ modifiers: [MOD] });
    const trigger = page.getByTestId("inspector-field-relation");
    await expect(trigger).toHaveAccessibleName("Relationship of 2 edges");
    await expect(trigger).toHaveAccessibleDescription("Mixed");
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByTestId("inspector-field-relation-menu");
    await expect(menu).toBeFocused();
    await menu.press("Home");
    await menu.press("ArrowDown");
    await menu.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleDescription("Request");
    for (const id of ["a-w", "a-c"]) await expect(page.getByTestId(`edge-${id}`)).toHaveAttribute("class", /fe-sync/);
  });

  test("the menus stay within budget with Select similar and Tidy up", async ({ page }) => {
    await seed(page);
    for (const open of [
      () => page.getByTestId("node-api").click({ button: "right" }),
      () => page.getByTestId("edge-label-a-w").click({ button: "right" }),
    ]) {
      await open();
      await expect(menuItem(page, "item.select-similar")).toBeVisible();
      for (const n of await menuCounts(page)) expect(n).toBeLessThanOrEqual(12);
      await page.keyboard.press("Escape");
    }
    // Route from / to side fold into one row on the edge's menu.
    await page.getByTestId("edge-label-a-w").click({ button: "right" });
    await menuItem(page, "edge.route").click();
    await expect(menuItem(page, "edge.from-side")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByTestId("node-api").click();
    await page.getByTestId("node-worker").click({ modifiers: [MOD] });
    await page.getByTestId("node-ledger").click({ modifiers: [MOD] });
    await page.getByTestId("node-ledger").click({ button: "right" });
    await expect(menuItem(page, "selection.tidy")).toBeVisible();
    for (const n of await menuCounts(page)) expect(n).toBeLessThanOrEqual(12);
  });

  test("a mixed selection's panel fits one screen at 1280 × 800", async ({ page, consoleErrors }) => {
    await seed(page, { width: 1280, height: 800 });
    await page.getByTestId("node-api").click();
    await page.getByTestId("node-worker").click({ modifiers: [MOD] });
    await page.getByTestId("node-carrier").click({ modifiers: [MOD] });
    await page.getByTestId("edge-label-a-w").click({ modifiers: [MOD] });
    await page.getByTestId("edge-label-a-c").click({ modifiers: [MOD] });
    await page.getByTestId("annotation-n1").click({ modifiers: [MOD] });
    await page.getByTestId("group-label-ship").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("7 selected");
    // Every kind's section: Arrange, the nodes', the edges', the annotation's and the boundary's colour.
    for (const id of [
      "inspector-align-left",
      "inspector-tidy",
      "inspector-field-stencil",
      "inspector-field-group",
      "inspector-field-relation",
      "inspector-field-label",
      "inspector-field-color",
      "inspector-field-tone",
      "inspector-delete-selection",
    ])
      await expect(page.getByTestId(id)).toBeVisible();
    const body = page.getByTestId("inspector-body");
    const fits = await body.evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(fits).toBe(true);
    // The last control is inside the window.
    const del = await box(page.getByTestId("inspector-delete-selection"));
    expect(del.y + del.height).toBeLessThanOrEqual(800);
    // A colour for both kinds at once: one undo.
    await page.getByTestId("inspector-tone-gcp").click();
    await savedWhen(page, (s) => group(s, "ship").tone === "gcp");
    await page.getByTestId("inspector-color-green").click();
    await savedWhen(page, (s) => s.annotations?.find((a) => a.id === "n1")?.color === "green");
    await page.getByTestId("undo-button").click();
    const after = await savedWhen(page, (s) => s.annotations?.find((a) => a.id === "n1")?.color === undefined);
    expect(group(after, "ship").tone).toBe("gcp");
    expectNoErrors(consoleErrors);
  });
});

test.describe("tidy the selection (D15)", () => {
  test("Tidy up lays out just the selection, moves nothing else, overlaps nothing, one undo", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page);
    const before = await saved(page);
    const start = before ?? SEED;
    await page.getByTestId("node-api").click();
    await page.getByTestId("node-worker").click({ modifiers: [MOD] });
    await page.getByTestId("node-ledger").click({ modifiers: [MOD] });
    await page.getByTestId("inspector-tidy").click();
    // Orders API → Payment worker → Ledger: one row, in that order.
    const d = await savedWhen(page, (s) => node(s, "ledger").y === node(s, "api").y);
    expect(node(d, "api").x).toBeLessThan(node(d, "worker").x);
    expect(node(d, "worker").x).toBeLessThan(node(d, "ledger").x);
    // Its top-left kept.
    expect(Math.min(node(d, "api").x, node(d, "ledger").x)).toBe(40);
    expect(node(d, "api").y).toBe(80);
    // Nothing else moved.
    for (const id of ["carrier", "cache", "billing"])
      expect(node(d, id)).toMatchObject({ x: node(start as Saved, id).x, y: node(start as Saved, id).y });
    // Nothing overlaps, on screen.
    await waitForStableViewport(page);
    const boxes = [...(await nodeBoxes(page)).entries()];
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (overlap(boxes[i][1], boxes[j][1])) hits.push(`${boxes[i][0]} × ${boxes[j][0]}`);
    expect(hits).toEqual([]);
    // Payments grew to hold its tidied members, which are all still in it, and nothing else changed boundary.
    expect(group(d, "pay").x + group(d, "pay").width).toBeGreaterThanOrEqual(node(d, "ledger").x + 220);
    for (const id of ["api", "worker", "ledger"]) expect(node(d, id).group).toBe("pay");
    expect(group(d, "ship")).toEqual(group(start as Saved, "ship"));
    // One undo puts all three back, and Payments' size with them.
    await page.getByTestId("undo-button").click();
    const back = await savedWhen(page, (s) => node(s, "ledger").y === 260);
    for (const n of (start as Saved).nodes) expect(node(back, n.id)).toEqual(n);
    expect(back.groups).toEqual((start as Saved).groups);
    expectNoErrors(consoleErrors);
  });

  test("Tidy up is in Ctrl+K with a selection", async ({ page }) => {
    await seed(page);
    await page.getByTestId("node-api").click();
    await page.getByTestId("node-worker").click({ modifiers: [MOD] });
    await page.getByTestId("node-ledger").click({ modifiers: [MOD] });
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("tidy");
    await page.keyboard.press("Enter");
    await savedWhen(page, (s) => node(s, "ledger").y === node(s, "api").y);
  });
});

test.describe("keyboard selection between nodes (D14)", () => {
  const announced = (page: Page) => page.getByTestId("canvas-announce");
  const focusedNode = (page: Page) =>
    page.evaluate(() => document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id") ?? null);

  test("two Tabs before the next frame step twice, from where the first one went", async ({ page }) => {
    await seed(page);
    await page.getByTestId("node-api").click();
    await expect.poll(() => focusedNode(page)).toBe("api");
    // Both presses arrive before the frame that moves focus (as when the page was busy for a moment).
    await page.evaluate(() => {
      const target = document.activeElement ?? document.body;
      for (let i = 0; i < 2; i++)
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true }),
        );
    });
    await expect.poll(() => focusedNode(page)).toBe("group:ship");
  });

  test("Tab steps through nodes in reading order, focus and selection together, and it's announced", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page);
    await page.getByTestId("node-api").click();
    await page.keyboard.press("Tab");
    await expect.poll(() => selectedIds(page)).toEqual(["node-worker"]);
    await expect.poll(() => focusedNode(page)).toBe("worker");
    await expect(announced(page)).toHaveText(
      /^Payment worker, Go Service, processor, in Payments\. \d+ of \d+\. 1 out, 1 in\.$/,
    );
    // Then the next boundary, before its first member.
    await page.keyboard.press("Tab");
    await expect.poll(() => focusedNode(page)).toBe("group:ship");
    await expect(announced(page)).toContainText("Shipping, boundary, 1 node");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => focusedNode(page)).toBe("api");
    // The canvas is one Tab stop: only the current node is in the page's Tab order.
    const stops = await page
      .getByTestId(NODES)
      .evaluateAll(
        (els) => els.filter((el) => el.closest(".react-flow__node")?.getAttribute("tabindex") === "0").length,
      );
    expect(stops).toBe(1);
    expectNoErrors(consoleErrors);
  });

  test("Tab past the last node leaves the canvas", async ({ page }) => {
    await seed(page);
    // The Carrier SLA note is last in reading order.
    await page.getByTestId("annotation-n2").click();
    await page.keyboard.press("Tab");
    await expect.poll(() => focusedNode(page)).toBeNull();
  });

  test("Ctrl+Alt+arrows go to the nearest node that way; Ctrl+Alt+] and [ to its edges", async ({ page }) => {
    await seed(page);
    await page.getByTestId("node-api").click();
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+ArrowDown");
    await expect.poll(() => selectedIds(page)).toEqual(["node-ledger"]);
    await expect(announced(page)).toContainText("Ledger");
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+ArrowUp");
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+ArrowRight");
    await expect.poll(() => selectedIds(page)).toEqual(["node-worker"]);
    // Nothing above: it says so, and the selection stays.
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+ArrowUp");
    await expect(announced(page)).toHaveText("Nothing above.");
    await expect.poll(() => selectedIds(page)).toEqual(["node-worker"]);
    // Arrows alone still nudge.
    const before = await box(page.getByTestId("node-worker"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await box(page.getByTestId("node-worker"))).x).toBeGreaterThan(before.x);
    // The worker's outgoing edge; from it, the incoming edges of where it goes.
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+BracketRight");
    await expect.poll(() => selectedIds(page)).toEqual(["edge-w-l"]);
    await expect(announced(page)).toContainText("Payment worker to Ledger");
    await expect(announced(page)).toContainText("Outgoing 1 of 1");
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+BracketLeft");
    await expect(announced(page)).toContainText("Incoming 1 of 1");
    // From the API, its two outgoing edges in turn.
    await page.getByTestId("node-api").click();
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+BracketRight");
    await expect(announced(page)).toContainText("Outgoing 1 of 2");
    await expect(page.getByTestId("relationship-wrapper-a-w")).toBeFocused();
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+BracketRight");
    await expect(announced(page)).toContainText("Outgoing 2 of 2");
    // A node with no incoming edges says so.
    await page.getByTestId("node-api").click();
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+BracketLeft");
    await expect(announced(page)).toHaveText("Orders API has no incoming edges.");
  });
});

test.describe("review follow-ups", () => {
  test("bulk colours update every selected item, show Mixed, and undo together", async ({ page, consoleErrors }) => {
    await seed(page);
    await page.getByTestId("annotation-n1").click();
    // The inspector opened and narrowed the canvas, keeping the first note in view: the second is past the edge.
    await fitDiagram(page);
    await page.getByTestId("annotation-n2").click({ modifiers: [MOD] });
    await page.getByTestId("group-label-pay").click({ modifiers: [MOD] });
    await page.getByTestId("group-label-ship").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("4 selected");
    // Yellow (the default) and blue; azure and AWS.
    await expect(page.getByTestId("inspector-field-color-mixed")).toBeVisible();
    await expect(page.getByTestId("inspector-field-tone-mixed")).toBeVisible();
    await page.getByTestId("inspector-color-green").click();
    await page.getByTestId("inspector-tone-gcp").click();
    let d = await savedWhen(
      page,
      (s) =>
        s.annotations?.every((a) => a.color === "green") === true && s.groups?.every((g) => g.tone === "gcp") === true,
    );
    expect(d.annotations?.map((a) => a.color)).toEqual(["green", "green"]);
    await expect(page.getByTestId("inspector-field-color-mixed")).toHaveCount(0);
    // One undo per edit: the tones first, then the colours.
    await page.getByTestId("undo-button").click();
    d = await savedWhen(page, (s) => group(s, "pay").tone === "azure");
    expect(group(d, "ship").tone).toBe("aws");
    expect(d.annotations?.map((a) => a.color)).toEqual(["green", "green"]);
    await page.getByTestId("undo-button").click();
    d = await savedWhen(page, (s) => s.annotations?.find((a) => a.id === "n2")?.color === "blue");
    expect(d.annotations?.find((a) => a.id === "n1")?.color).toBeUndefined();
    expectNoErrors(consoleErrors);
  });

  test("dragging a boundary with a node that isn't its member still settles that node", async ({ page }) => {
    await seed(page);
    await page.getByTestId("group-label-ship").click();
    await page.getByTestId("node-cache").click({ modifiers: [MOD] });
    // Cache (700, 560) into Payments, Shipping along with it.
    await fitDiagram(page); // Bring Payments back into the pane before measuring the drop point.
    const v = await view(page);
    const at = centre(await box(page.getByTestId("node-cache")));
    await dragTo(page, "cache", { x: at.x - 400 * v.k, y: at.y - 360 * v.k });
    const d = await savedWhen(page, (s) => node(s, "cache").group === "pay");
    // Shipping's own member went with it and stays in it.
    expect(node(d, "carrier").group).toBe("ship");
  });

  test("a diagram of boundaries only can be reached and walked from the keyboard", async ({ page }) => {
    await seed(page, undefined, {
      format: "diagrams/v1",
      title: "Boundaries only",
      groups: [
        { id: "a", label: "Alpha", x: 0, y: 0, width: 400, height: 300 },
        { id: "b", label: "Beta", x: 600, y: 0, width: 400, height: 300 },
      ],
      nodes: [],
      edges: [],
    });
    await expect(page.getByTestId("group-a")).toBeVisible();
    // One of them is in the page's Tab order.
    const stops = await page
      .getByTestId(/^group-[ab]$/)
      .evaluateAll(
        (els) => els.filter((el) => el.closest(".react-flow__node")?.getAttribute("tabindex") === "0").length,
      );
    expect(stops).toBe(1);
    // eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt navigates the canvas on every OS (including macOS).
    await page.keyboard.press("Control+Alt+ArrowRight");
    await expect(page.getByTestId("canvas-announce")).toContainText("Alpha, boundary, 0 nodes");
    await expect(page.getByTestId("rf__node-group:a")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("canvas-announce")).toContainText("Beta, boundary");
  });

  test("with dependencies hidden, a node's pips aren't a Tab stop; its list opens on the node", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("diagrams.showDependencies.v1", "0"));
    await gotoCanvas(page, "aks-app-config-key-vault");
    const pips = page.getByTestId("node-pips-api");
    await expect(pips).toBeVisible();
    await expect(pips).toHaveAttribute("tabindex", "-1");
    // Tab through the whole canvas: focus is only ever on a node, then leaves it.
    await page.getByTestId("node-web").click();
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => {
        const el = document.activeElement;
        // Past the diagram: the canvas's own controls, or the rest of the page.
        if (!el?.closest(".react-flow__viewport, .react-flow__edgelabel-renderer")) return "outside";
        return el.closest(".react-flow__node") === el ? "node" : (el.getAttribute("data-testid") ?? el.tagName);
      });
      seen.push(at);
      if (at === "outside") break;
    }
    expect(seen.at(-1)).toBe("outside");
    expect(seen.filter((s) => s !== "node" && s !== "outside")).toEqual([]);
    // Reaching the API from the keyboard opens its dependency list, and the announcement reads it.
    // Back into the canvas (Shift+Tab lands on the node last visited), then back through the nodes.
    const focused = () =>
      page.evaluate(() => document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id") ?? null);
    for (let i = 0; i < 14; i++) {
      const before = await focused();
      await page.keyboard.press("Shift+Tab");
      // Each step lands before the next.
      await expect.poll(focused).not.toBe(before);
      if ((await focused()) === "api") break;
    }
    expect(await focused()).toBe("api");
    await expect(page.getByTestId("node-dependencies-api")).toBeVisible();
    await expect(page.getByTestId("canvas-announce")).toContainText("Dependencies:");
  });
});

test("Tidy up with no room says so and moves nothing", async ({ page }) => {
  // Three clear cards around a big shape: wherever the tidied row could go within reach, it would cover it.
  const diagram = {
    format: "diagrams/v1",
    title: "No room",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 4000 },
      { id: "b", stencil: "service.node", label: "B", x: 4000, y: 0 },
      { id: "c", stencil: "service.node", label: "C", x: 4000, y: 4000 },
    ],
    edges: [
      { id: "a-b", from: "a", to: "b" },
      { id: "b-c", from: "b", to: "c" },
    ],
    annotations: [{ id: "wall", kind: "shape", text: "", x: -1000, y: -1000, width: 4000, height: 4000 }],
  };
  await seed(page, undefined, diagram);
  // Everything, the shape too: a selected shape stays put, so it still counts.
  await page.getByTestId("node-a").click();
  await page.keyboard.press(`${MOD}+a`);
  await page.getByTestId("inspector-tidy").click();
  await expect(page.getByTestId("toast")).toContainText("Couldn't find room. Nothing moved.");
  await page.waitForTimeout(500);
  const d = await saved(page);
  // Nothing was written (no change), or the nodes are where they were.
  if (d) for (const n of diagram.nodes) expect(node(d, n.id)).toMatchObject({ x: n.x, y: n.y });
});
