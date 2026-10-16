import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, pageLoadTimeout, waitForStableBox } from "./fixtures";

// Interaction performance guards (dev server, so React runs in development mode: tagged @dev, which
// playwright.config.ts runs in the "dev" project).
//
// Two kinds of check:
//  - Render counts: a fake React DevTools hook (installed before React loads) counts, per component
//    name, the components that rendered in each commit. Hovering a menu must re-render only the menu
//    rows whose highlight changed, never the canvas or the whole menu.
//  - Long frames: a long-animation-frame observer, as a backstop for a frozen page only (FROZEN). The counts are
//    the guard: they don't depend on the machine, where a frame budget in ms failed on a busy one (docs/QUALITY.md
//    § Timing in tests).

const SLUG = "kafka-order-pipeline";
/** A frame this long is a hung page, not a slow machine. */
const FROZEN = 5_000;

/** Counts renders per component name, commit by commit (dev builds keep names and profiler timings). */
const RENDER_HOOK = `(() => {
  const counts = new Map();
  let on = false;
  let timed = true;
  const name = (f) => {
    const t = f.type;
    if (!t || typeof t === "string") return null;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || "anonymous";
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!on) return;
      const start = root.current.actualStartTime;
      if (typeof start !== "number") timed = false;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        // Function, class, forwardRef, memo and simple-memo components that did work in this render.
        if ([0, 1, 11, 14, 15].includes(f.tag) && f.actualStartTime >= start && (f.flags & 1)) {
          const k = name(f);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  window.__renders = {
    start() { counts.clear(); on = true; },
    stop() { on = false; return { timed, counts: Object.fromEntries(counts) }; },
  };
  window.__frames = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__frames.push(e.duration); })
    .observe({ type: "long-animation-frame" });
})();`;

declare global {
  interface Window {
    __renders: { start(): void; stop(): { timed: boolean; counts: Record<string, number> } };
    __frames: number[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(RENDER_HOOK);
});

/** Moves the pointer over each element's centre, `rounds` times, letting each hover settle. */
async function hoverEach(page: Page, testIds: string[], rounds = 2): Promise<number> {
  let moves = 0;
  for (let r = 0; r < rounds; r++)
    for (const id of testIds) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`${id} has no box`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      await expect(page.getByTestId(id)).toHaveAttribute("data-active", "true");
      moves++;
    }
  return moves;
}

/** Runs `fn` while counting renders and long frames. */
async function measure(page: Page, fn: () => Promise<void>) {
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__renders.start();
  });
  await fn();
  // Let the last hover's frame land.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
  const { timed, counts } = await page.evaluate(() => window.__renders.stop());
  const longest = await page.evaluate(() => Math.max(0, ...window.__frames));
  expect(timed, "React no longer exposes per-fiber render timings: update RENDER_HOOK").toBe(true);
  return { counts, longest };
}

/** Item test ids of the open menu that the pointer can highlight (no submenus: they open on hover). */
async function plainItems(page: Page, menuTestId: string, itemPrefix: string): Promise<string[]> {
  const ids = await page
    .getByTestId(menuTestId)
    .locator(`[data-testid^="${itemPrefix}"]:not([aria-disabled="true"]):not([aria-haspopup])`)
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
  expect(ids.length).toBeGreaterThan(3);
  return ids;
}

/** Opens the diagram and waits for the view to settle (the initial fit animates the viewport). */
async function openDiagram(page: Page, live = false) {
  if (live) {
    await page.goto(`./?view=canvas&example=${SLUG}&live=1`);
    // The live session's code loads on first use: seconds on a busy dev server.
    await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  } else await gotoCanvas(page, SLUG);
  await waitForStableBox(page.getByTestId("node-gateway"));
  // Code loaded in idle time (the dialogs, the AI panel) re-renders the canvas once when it arrives: let it land
  // before measuring, or a busy machine (where idle comes late) counts that commit as the hover's.
  await page.waitForLoadState("networkidle");
}

/** Right-clicks the empty canvas above the diagram. */
async function openCanvasMenu(page: Page) {
  const wrap = await page.getByTestId("canvas-wrap").boundingBox();
  if (!wrap) throw new Error("no canvas");
  await page.mouse.click(wrap.x + wrap.width / 2, wrap.y + 90, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
}

test.describe("perf: interactions", { tag: "@dev" }, () => {
  test("hovering the canvas menu re-renders only the rows that change", async ({ page, consoleErrors }) => {
    await openDiagram(page);
    await openCanvasMenu(page);
    const ids = await plainItems(page, "context-menu", "context-menu-item-");
    // Bring the pointer into the menu first: on its way it may cross a node (whose tooltip is canvas state).
    await hoverEach(page, ids.slice(-1), 1);

    let moves = 0;
    const { counts, longest } = await measure(page, async () => {
      moves = await hoverEach(page, ids);
    });

    // Only the menu renders: nothing above it (canvas, nodes, edges, rail, inspector) reacts to a hover.
    // (React Flow's background and minimap may still settle from the initial fit; they don't count.)
    const fanOut = [
      "CanvasInner",
      "Palette",
      "PaletteItem",
      "Inspector",
      "DiagramNodeImpl",
      "FlowEdgeImpl",
      "ContextMenu",
    ];
    expect(
      fanOut.filter((k) => counts[k]),
      JSON.stringify(counts),
    ).toEqual([]);
    // Each hover re-renders the list once and two rows (the one left, the one entered). StrictMode
    // and a stray extra commit get slack; a whole-menu re-render per hover (rows x moves) doesn't fit.
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(moves * 2 * 2);
    expect(counts.MenuList ?? 0).toBeLessThanOrEqual(moves * 2);
    expect(longest).toBeLessThan(FROZEN);
    expectNoErrors(consoleErrors);
  });

  test("arrow keys through the canvas menu re-render only the rows that change", async ({ page, consoleErrors }) => {
    await openDiagram(page);
    await openCanvasMenu(page);
    const presses = 12;
    const { counts, longest } = await measure(page, async () => {
      for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowDown");
      await expect(page.getByTestId("context-menu").locator("[data-active]")).toHaveCount(1);
    });
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(presses * 2 * 2);
    expect(longest).toBeLessThan(FROZEN);
    expectNoErrors(consoleErrors);
  });

  test("hovering the command palette re-renders only the rows that change", async ({ page, consoleErrors }) => {
    await openDiagram(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    const ids = (await plainItems(page, "command-list", "command-item-")).slice(0, 10);

    let moves = 0;
    const { counts, longest } = await measure(page, async () => {
      moves = await hoverEach(page, ids, 1);
    });
    expect(counts.Row ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.Row ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(moves * 2 * 2);
    expect(counts.PaletteDialog ?? 0).toBeLessThanOrEqual(moves * 2);
    expect(longest).toBeLessThan(FROZEN);
    expectNoErrors(consoleErrors);
  });

  test("selecting, dragging and undoing on the canvas leave the stencil rail alone", async ({
    page,
    consoleErrors,
  }) => {
    await openDiagram(page);
    const { counts } = await measure(page, async () => {
      await page.getByTestId("node-gateway").click();
      const box = await page.getByTestId("node-inventory").boundingBox();
      if (!box) throw new Error("no node");
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++)
        await page.mouse.move(box.x + box.width * 0.3 + i * 8, box.y + box.height / 2 + i * 4);
      await page.mouse.up();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    });
    // The canvas itself re-renders on each of these; the 155-stencil rail beside it must not.
    expect(counts.CanvasInner ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.Palette ?? 0, JSON.stringify(counts)).toBe(0);
    expect(counts.PaletteItem ?? 0, JSON.stringify(counts)).toBe(0);
    expectNoErrors(consoleErrors);
  });

  test("opening a stencil's details re-renders that tile, not the whole gallery", async ({ page, consoleErrors }) => {
    await page.goto("./?view=gallery");
    const tiles = page.getByTestId(/^stencil-tile-/);
    await expect(tiles.first()).toBeVisible();
    const { counts } = await measure(page, async () => {
      await tiles.nth(3).click();
      await expect(page.getByTestId("stencil-drawer")).toBeVisible();
    });
    expect(counts.StencilDrawer ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.StencilTile ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(4);
    expectNoErrors(consoleErrors);
  });

  test("the live menu stays row-granular while messages flow", async ({ page, consoleErrors }) => {
    await openDiagram(page, true);
    await openCanvasMenu(page);
    const ids = await plainItems(page, "context-menu", "context-menu-item-");

    let moves = 0;
    const { counts, longest } = await measure(page, async () => {
      moves = await hoverEach(page, ids);
    });
    // The live badges re-render at the UI clock regardless; the menu itself must stay row-granular.
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.MenuRow ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(moves * 2 * 2);
    expect(longest).toBeLessThan(FROZEN);
    expectNoErrors(consoleErrors);
  });

  // React Flow re-renders a node's wrapper (and its minimap rect) when the canvas hands it a new handler or a new
  // node object: an inline handler re-rendered all of them on every click, key and drag frame. The cards that change
  // render; the other nodes don't (the example has 15, so one pass over them all would read as 15 or more).
  test("clicking, typing a name and dragging re-render the nodes that change, not every node", async ({
    page,
    consoleErrors,
  }) => {
    await openDiagram(page);
    const every = await page.locator(".react-flow__node").count();
    expect(every).toBeGreaterThanOrEqual(15);
    const { counts: click } = await measure(page, async () => {
      await page.getByTestId("node-orders").click();
      await page.getByTestId("node-payments").click();
    });
    expect(click.CanvasInner ?? 0, JSON.stringify(click)).toBeGreaterThan(0);
    expect(click.NodeWrapper ?? 0, JSON.stringify(click)).toBeLessThan(every);
    expect(click.NodeComponentWrapperInner ?? 0, JSON.stringify(click)).toBeLessThan(every);

    await page.getByTestId("node-inventory").dblclick();
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeFocused();
    await label.press("End");
    const { counts: typing } = await measure(page, async () => {
      for (const key of "-v2") {
        await page.keyboard.type(key);
        await expect(label).toHaveValue(new RegExp(`${key}$`));
      }
    });
    await expect(page.getByTestId("node-inventory")).toContainText("Inventory service-v2");
    expect(typing.NodeWrapper ?? 0, JSON.stringify(typing)).toBeGreaterThan(0);
    expect(typing.NodeWrapper ?? 0, JSON.stringify(typing)).toBeLessThan(every);
    expect(typing.NodeComponentWrapperInner ?? 0, JSON.stringify(typing)).toBeLessThan(every);
    await label.press("Enter");
    await page.keyboard.press("Escape");

    const box = await page.getByTestId("node-notifications").boundingBox();
    if (!box) throw new Error("no node");
    const { counts: drag } = await measure(page, async () => {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++)
        await page.mouse.move(box.x + box.width * 0.3 + i * 8, box.y + box.height / 2 + i * 4);
      await page.mouse.up();
    });
    expect(drag.CanvasInner ?? 0, JSON.stringify(drag)).toBeGreaterThan(0);
    expect(drag.NodeWrapper ?? 0, JSON.stringify(drag)).toBeLessThan(every);
    expectNoErrors(consoleErrors);
  });

  test("a node's tooltip shows and hides without rendering the canvas", async ({ page, consoleErrors }) => {
    await openDiagram(page);
    const box = await page.getByTestId("node-orders").boundingBox();
    if (!box) throw new Error("no node");
    const { counts } = await measure(page, async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      await expect(page.getByTestId("node-tooltip")).toBeVisible();
      await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 2 });
      await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
    });
    expect(counts.NodeTooltip ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts.CanvasInner ?? 0, JSON.stringify(counts)).toBe(0);
    expectNoErrors(consoleErrors);
  });
});
