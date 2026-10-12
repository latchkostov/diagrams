import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, waitForStableViewport, viewportTransform } from "./fixtures";

// Drawing basics (docs/research/drawing-ux.md, batch 1): navigation (D4), selection gestures (D5),
// drop to create (D1), hittable handles and connect feedback (D2), copies that never overlap (D9) and
// zoom to selection (D10). Kafka example; selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
/** Nodes, not their tooltip or inline editor. */
const NODES = /^node-(?!tooltip$|editor)/;

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** React Flow's viewport: translate(x, y) scale(k). */
async function view(page: Page) {
  const t = await viewportTransform(page);
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
  if (!m) throw new Error(`Unexpected transform: ${t}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** A point on the empty pane: the top strip of the canvas is empty after a fit (clear of the title card). */
async function emptyPoint(page: Page, dx = 0) {
  const wrap = await box(page.getByTestId("canvas-wrap"));
  return { x: wrap.x + wrap.width / 2 + dx, y: wrap.y + 70 };
}

/** A box from a map that must have it. */
function must(m: Map<string, Box>, id: string): Box {
  const b = m.get(id);
  if (!b) throw new Error(`No box for ${id}`);
  return b;
}

/** Every node's box, by test id. */
async function nodeBoxes(page: Page) {
  const nodes = page.getByTestId(NODES);
  const ids = await nodes.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
  const out = new Map<string, Box>();
  for (const id of ids) out.set(id, await box(page.getByTestId(id)));
  return out;
}

/** No two nodes overlap (the "nothing overlaps by default" rule). */
async function expectNoNodeOverlaps(page: Page) {
  const boxes = [...(await nodeBoxes(page)).entries()];
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlap(boxes[i][1], boxes[j][1])) hits.push(`${boxes[i][0]} × ${boxes[j][0]}`);
  expect(hits).toEqual([]);
}

/** The flow-space end point of an edge's drawn path. */
async function pathEnd(page: Page, edgeTestId: string) {
  const d = await page
    .getByTestId(edgeTestId)
    .evaluate((g) => g.querySelector("path.fe-path")?.getAttribute("d") ?? g.querySelector("path")?.getAttribute("d"));
  const nums = (d ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
  return { x: nums[nums.length - 2], y: nums[nums.length - 1] };
}

/** Presses on a node's handle (hovering the node first, as a person does) and drags to `to`. */
async function dragFromHandle(page: Page, node: string, side: string, to: { x: number; y: number }, release = true) {
  await page.getByTestId(`node-${node}`).hover();
  const h = centre(await box(page.getByTestId(`handle-${node}-${side}`)));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move((h.x + to.x) / 2, (h.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  if (release) await page.mouse.up();
}

const cursorAt = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? getComputedStyle(el).cursor : "";
  }, p);

test.describe("drawing basics", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await waitForStableViewport(page);
  });

  test("the wheel pans (both axes); Ctrl+wheel zooms at the pointer", async ({ page, consoleErrors }) => {
    const p = await emptyPoint(page);
    await page.mouse.move(p.x, p.y);
    const v0 = await view(page);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await view(page)).y).toBeCloseTo(v0.y - 120, 0);
    await page.mouse.wheel(80, 0);
    await expect.poll(async () => (await view(page)).x).toBeCloseTo(v0.x - 80, 0);
    expect((await view(page)).zoom).toBe(v0.zoom);

    await page.keyboard.down(MOD);
    await page.mouse.wheel(0, -200);
    await page.keyboard.up(MOD);
    await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(v0.zoom);
    expectNoErrors(consoleErrors);
  });

  test("Space+drag pans even when it starts on a node; the middle button pans", async ({ page, consoleErrors }) => {
    const before = await nodeBoxes(page);
    const v0 = await view(page);
    const start = centre(must(before, "node-payments"));
    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 60, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const v1 = await view(page);
    expect(v1.x).toBeCloseTo(v0.x + 120, 0);
    expect(v1.y).toBeCloseTo(v0.y + 60, 0);
    // The node didn't move on the diagram: it's still where it was relative to its neighbour.
    const after = await nodeBoxes(page);
    const rel = (m: Map<string, Box>) => must(m, "node-payments").x - must(m, "node-inventory").x;
    expect(rel(after)).toBeCloseTo(rel(before), 0);

    // The middle button, from the empty canvas and from a node.
    for (const from of [await emptyPoint(page), centre(must(after, "node-orders"))]) {
      const v = await view(page);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(from.x - 90, from.y + 40, { steps: 5 });
      await page.mouse.up({ button: "middle" });
      await expect.poll(async () => (await view(page)).x).toBeCloseTo(v.x - 90, 0);
    }
    // Nothing got selected on the way (the inspector waits for a selection at 1440).
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    expectNoErrors(consoleErrors);
  });

  test("a drag on empty canvas draws a selection box: it picks what it touches, and edges with both ends", async ({
    page,
    consoleErrors,
  }) => {
    const inv = await box(page.getByTestId("node-inventory"));
    const db = await box(page.getByTestId("node-stock-db"));
    // From above-left of inventory to the middle of stock-db: it only touches stock-db.
    const from = { x: inv.x + inv.width / 2, y: inv.y - 30 };
    const v0 = await view(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 3, db.y + db.height / 2, { steps: 8 });
    // A box, not a pan: the view held still under the drag.
    expect(await view(page)).toEqual(v0);
    await page.mouse.up();
    // Two nodes and the edge between them; not the edges to nodes outside the box.
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    expectNoErrors(consoleErrors);
  });

  test("Shift+click adds to the selection and Shift+click again takes it out", async ({ page }) => {
    await page.getByTestId("node-inventory").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await page.getByTestId("node-payments").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await page.getByTestId("node-notifications").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
    await page.getByTestId("node-payments").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
  });

  test("the inspector waits for pointer-up: it never opens under a drag", async ({ page }) => {
    // 1440 px: below 1680 the inspector waits for a selection.
    const inspector = page.getByTestId("inspector");
    await expect(inspector).toHaveAttribute("data-collapsed", "1");
    const inv = await box(page.getByTestId("node-inventory"));
    await page.mouse.move(inv.x - 20, inv.y - 30);
    await page.mouse.down();
    await page.mouse.move(inv.x + inv.width / 2, inv.y + inv.height / 2, { steps: 8 });
    // Mid-drag: the node is picked, the inspector still folded.
    await page.waitForTimeout(200);
    await expect(inspector).toHaveAttribute("data-collapsed", "1");
    await page.mouse.up();
    await expect(inspector).not.toHaveAttribute("data-collapsed", "1");

    // Pressing on another node and dragging it: still folded until the drop.
    await page.getByTestId("canvas-wrap").press("Escape");
    await expect(inspector).toHaveAttribute("data-collapsed", "1");
    const pay = centre(await box(page.getByTestId("node-payments")));
    await page.mouse.move(pay.x, pay.y);
    await page.mouse.down();
    await page.mouse.move(pay.x + 10, pay.y + 40, { steps: 5 });
    await page.waitForTimeout(200);
    await expect(inspector).toHaveAttribute("data-collapsed", "1");
    await page.mouse.up();
    await expect(inspector).not.toHaveAttribute("data-collapsed", "1");
  });

  test("a connection dropped on empty canvas opens quick-add there; the pick lands connected, ready to name", async ({
    page,
    consoleErrors,
  }) => {
    const from = await box(page.getByTestId("node-dashboard"));
    // Below the dashboard: empty canvas.
    const drop = { x: from.x + from.width / 2, y: from.y + from.height + 90 };
    await dragFromHandle(page, "dashboard", "bottom", drop, false);
    // Over empty canvas the line ends in a "+".
    await expect(page.getByTestId("connection-add")).toBeVisible();
    await page.mouse.up();
    const quickAdd = page.getByTestId("quick-add");
    await expect(quickAdd).toBeVisible();
    const before = await page.getByTestId(NODES).count();
    await page.keyboard.type("kafka topic");
    await expect(page.getByTestId("context-menu-item-quick-add:kafka.topic")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(quickAdd).toHaveCount(0);
    await expect(page.getByTestId(NODES)).toHaveCount(before + 1);
    // Its label editor is open with the stencil's name selected: typing names it.
    const label = page.getByTestId("node-editor-label");
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Kafka Topic");
    expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(11);
    await page.keyboard.type("audit.log");
    await page.keyboard.press("Enter");
    const node = page.getByTestId("node-topic-1");
    await expect(node).toContainText("audit.log");
    // Centred on the drop point, and connected from the dashboard.
    // (The view may have panned to keep it clear of the inspector, never zoomed: measure from the source.)
    await waitForStableViewport(page);
    const b = await box(node);
    const src = await box(page.getByTestId("node-dashboard"));
    expect(Math.abs(b.x + b.width / 2 - (src.x + src.width / 2))).toBeLessThan(12);
    expect(Math.abs(b.y + b.height / 2 - (src.y + src.height + 90))).toBeLessThan(12);
    // In view, clear of the inspector.
    const wrap = await box(page.getByTestId("canvas-wrap"));
    expect(b.x + b.width).toBeLessThanOrEqual(wrap.x + wrap.width);
    await expect(page.getByTestId("edge-e-1")).toBeAttached();
    // One step: undo takes the node and its edge away together.
    await page.waitForTimeout(500);
    await page.getByTestId("undo-button").click();
    await expect(node).toHaveCount(0);
    await expect(page.getByTestId("edge-e-1")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Esc on the drop's quick-add adds nothing", async ({ page }) => {
    const before = await page.getByTestId(NODES).count();
    const from = await box(page.getByTestId("node-dashboard"));
    await dragFromHandle(page, "dashboard", "bottom", { x: from.x + from.width / 2, y: from.y + from.height + 90 });
    await expect(page.getByTestId("quick-add")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(page.getByTestId(NODES)).toHaveCount(before);
  });

  test("a connection dropped anywhere on a node connects to it, on the side facing the source", async ({
    page,
    consoleErrors,
  }) => {
    // shopper (far left) to schemas (top middle): no edge between them yet.
    await expect(page.getByTestId("edge-e-1")).toHaveCount(0);
    const target = await box(page.getByTestId("node-schemas"));
    // The middle of the card, away from every handle.
    await dragFromHandle(
      page,
      "shopper",
      "right",
      { x: target.x + target.width / 2, y: target.y + target.height * 0.6 },
      false,
    );
    // The target lights up while hovered.
    await expect
      .poll(() =>
        page
          .getByTestId("node-schemas")
          .evaluate((el) => el.closest(".react-flow__node")?.classList.contains("is-connect-target")),
      )
      .toBe(true);
    await page.mouse.up();
    await expect(page.getByTestId("edge-e-1")).toBeAttached();
    // schemas is up and to the right of shopper: the edge meets its left side.
    const end = await pathEnd(page, "edge-e-1");
    expect(Math.abs(end.x - 1180)).toBeLessThan(16);
    expect(end.y).toBeGreaterThan(40);
    expect(end.y).toBeLessThan(40 + 80);
    // The highlight goes with the drag.
    expect(
      await page
        .getByTestId("node-schemas")
        .evaluate((el) => el.closest(".react-flow__node")?.classList.contains("is-connect-target")),
    ).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("handles have a 20 px hit area at the fitted zoom, outside the card", async ({ page }) => {
    expect((await view(page)).zoom).toBeLessThan(0.7);
    const card = await box(page.getByTestId("node-shopper"));
    await page.getByTestId("node-shopper").hover();
    const h = centre(await box(page.getByTestId("handle-shopper-left")));
    // The dot itself is ~4 px on screen here.
    expect((await box(page.getByTestId("handle-shopper-left"))).width).toBeLessThan(8);
    const hit = (x: number, y: number) =>
      page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"), { x, y });
    for (const [dx, dy] of [
      [-3, 0],
      [-18, 0],
      [-10, -9],
      [-10, 9],
    ])
      expect(await hit(h.x + dx, h.y + dy), `${dx},${dy}`).toBe("handle-shopper-left");
    // Inside the card near its edge, a press still moves the node.
    expect(await hit(card.x + 8, card.y + card.height / 2 - 10)).not.toBe("handle-shopper-left");
  });

  test("one crosshair for the whole connect drag, over edges, nodes and the canvas", async ({ page }) => {
    const label = centre(await box(page.getByTestId("edge-label-order-events-to-payments")));
    const node = await box(page.getByTestId("node-orders"));
    const empty = await emptyPoint(page);
    await dragFromHandle(page, "dashboard", "top", empty, false);
    for (const p of [empty, label, { x: node.x + node.width / 2, y: node.y + node.height / 2 }]) {
      await page.mouse.move(p.x, p.y, { steps: 4 });
      expect(await cursorAt(page, p)).toBe("crosshair");
    }
    await page.mouse.move(empty.x, empty.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
  });

  test("Ctrl+D puts the copy beside the original, and again beside that, never on anything", async ({ page }) => {
    await page.getByTestId("node-payments").click();
    await page.keyboard.press(`${MOD}+d`);
    await expect(page.getByTestId("node-payments-1")).toBeVisible();
    await expect(page.getByTestId("inspector-title")).toHaveText("Node");
    await page.keyboard.press(`${MOD}+d`);
    await expect(page.getByTestId("node-payments-2")).toBeVisible();
    await waitForStableViewport(page);
    await expectNoNodeOverlaps(page);
    // The copy is in view, not under the inspector or off the edge.
    const copy = await box(page.getByTestId("node-payments-2"));
    const wrap = await box(page.getByTestId("canvas-wrap"));
    expect(copy.x).toBeGreaterThanOrEqual(wrap.x);
    expect(copy.x + copy.width).toBeLessThanOrEqual(wrap.x + wrap.width);
    expect(copy.y + copy.height).toBeLessThanOrEqual(wrap.y + wrap.height);
  });

  test("Ctrl+V pastes at the pointer over the canvas, and a second paste steps clear of the first", async ({
    page,
  }) => {
    await page.getByTestId("node-inventory").click();
    await page.keyboard.press(`${MOD}+c`);
    // The inspector opened with the selection and the view moved to keep it in sight: let it settle.
    await waitForStableViewport(page);
    // Point at an empty spot below the diagram.
    const wrap = await box(page.getByTestId("canvas-wrap"));
    const spot = { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height - 120 };
    await page.mouse.move(spot.x, spot.y);
    await page.keyboard.press(`${MOD}+v`);
    const pasted = page.getByTestId("node-inventory-1");
    await expect(pasted).toBeVisible();
    const b = await box(pasted);
    expect(Math.abs(b.x + b.width / 2 - spot.x)).toBeLessThan(40);
    expect(Math.abs(b.y + b.height / 2 - spot.y)).toBeLessThan(40);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId("node-inventory-2")).toBeVisible();
    // Pointing at a node: the paste lands next to it, not on it.
    const orders = centre(await box(page.getByTestId("node-orders")));
    await page.mouse.move(orders.x, orders.y);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId("node-inventory-3")).toBeVisible();
    await page.waitForTimeout(100);
    await expectNoNodeOverlaps(page);
  });

  test("Alt-drag drags a copy away and leaves the original; a copy dropped on a node moves clear", async ({ page }) => {
    const pay = await box(page.getByTestId("node-payments"));
    const inv = await box(page.getByTestId("node-inventory"));
    const from = { x: pay.x + pay.width * 0.4, y: pay.y + pay.height / 2 };
    const notif = centre(await box(page.getByTestId("node-notifications")));
    await page.mouse.move(from.x, from.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 3 });
    // Drop it right onto notifications.
    await page.mouse.move(notif.x, notif.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect(page.getByTestId("node-payments-1")).toBeVisible();
    // The original stayed where it was (relative to its neighbour: the view may pan to show the copy).
    await page.waitForTimeout(400);
    const pay1 = await box(page.getByTestId("node-payments"));
    const inv1 = await box(page.getByTestId("node-inventory"));
    expect((pay1.x - inv1.x) / pay1.width).toBeCloseTo((pay.x - inv.x) / pay.width, 1);
    expect((pay1.y - inv1.y) / pay1.height).toBeCloseTo((pay.y - inv.y) / pay.height, 1);
    await expect
      .poll(async () =>
        overlap(await box(page.getByTestId("node-payments-1")), await box(page.getByTestId("node-notifications"))),
      )
      .toBe(false);
    await expectNoNodeOverlaps(page);
    // One undo step takes the copy away.
    await page.waitForTimeout(500);
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("node-payments-1")).toHaveCount(0);
  });

  test("Shift+2 zooms to the selection; the palette and the shortcuts sheet know it", async ({ page }) => {
    const v0 = await view(page);
    await page.getByTestId("node-stock-db").click();
    await page.keyboard.press("Shift+Digit2");
    await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(v0.zoom * 1.5);
    await waitForStableViewport(page);
    expect((await view(page)).zoom).toBeLessThanOrEqual(1.25);
    const b = await box(page.getByTestId("node-stock-db"));
    const wrap = await box(page.getByTestId("canvas-wrap"));
    expect(b.x).toBeGreaterThan(wrap.x);
    expect(b.x + b.width).toBeLessThan(wrap.x + wrap.width);

    // Back to the whole diagram, then the palette's command.
    await page.keyboard.press("Shift+Digit1");
    await waitForStableViewport(page);
    const fitted = (await view(page)).zoom;
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("zoom to selection");
    await expect(page.getByTestId("command-item-action:canvas.zoom-selection")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(fitted * 1.5);

    await page.getByTestId("shortcuts-button").click();
    await expect(page.getByTestId("shortcuts-dialog")).toContainText("Zoom to selection");
    await expect(page.getByTestId("shortcuts-dialog")).toContainText("Ctrl / ⌘ + scroll, pinch");
  });

  test("live view still pans with a drag on the canvas", async ({ page, consoleErrors }) => {
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await waitForStableViewport(page);
    const v0 = await view(page);
    const p = await emptyPoint(page, -200);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 140, p.y + 50, { steps: 6 });
    await page.mouse.up();
    const v1 = await view(page);
    expect(v1.x).toBeCloseTo(v0.x + 140, 0);
    expect(v1.y).toBeCloseTo(v0.y + 50, 0);
    expectNoErrors(consoleErrors);
  });
});

test("an embed lets the wheel scroll the host page", async ({ page, baseURL }) => {
  const src = new URL(`./?embed=1&example=${SLUG}`, baseURL).href;
  await page.goto(new URL("./", baseURL).href);
  await page.setContent(
    `<!doctype html><body style="margin:0"><div style="height:300px"></div>` +
      `<iframe data-testid="host-embed" src="${src}" width="900" height="500" style="border:0"></iframe>` +
      `<div style="height:2000px"></div></body>`,
  );
  const frame = page.frameLocator('[data-testid="host-embed"]');
  await expect(frame.getByTestId("embed-view")).toBeVisible();
  await expect(frame.getByTestId("node-payments")).toBeVisible();
  const transform = () =>
    frame
      .getByTestId("canvas-wrap")
      .evaluate((w) => w.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform);
  await page.waitForTimeout(600);
  const t0 = await transform();
  const ifr = await box(page.getByTestId("host-embed"));
  await page.mouse.move(ifr.x + ifr.width / 2, ifr.y + ifr.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect(await transform()).toBe(t0);
});
