import { test, expect } from "./fixtures";
import { canvasSelection, command, openExample, readCanvas, restoreOpening, settledCanvas, tidyAll } from "./canvas";
import { waitForStableBox } from "../../e2e/fixtures";
import { holdResizeObservers } from "./holdReadiness";
import { expectGolden } from "../lib/golden";

test("selected shaped line exposes segment handles without changing its drawing", async ({ page }) => {
  const opened = await openExample(page, "corpus-hand-shaped-lines");
  const at = await page.getByTestId("edge-api-db").evaluate((edge) => {
    const line = edge.children[1] as SVGPathElement;
    const point = line.getPointAtLength(line.getTotalLength() / 4);
    const matrix = line.getScreenCTM();
    if (!matrix) throw new Error("Missing edge transform");
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("route-segment-api-db-0")).toBeVisible();
  const drawing = await settledCanvas(page);
  const selection = await canvasSelection(page);
  expect(selection).toEqual({ nodes: [], edges: ["api-db"] });
  expect(drawing.edges).toEqual(opened.edges);
  const handles = await page.getByTestId(/^route-segment-/).evaluateAll((elements) =>
    elements.map((element) => {
      const handle = element as HTMLElement;
      const style = getComputedStyle(handle);
      return {
        id: handle.dataset.testid,
        transform: handle.style.transform,
        cursor: style.cursor,
        title: handle.title,
      };
    }),
  );
  expectGolden("selection/corpus-hand-shaped-lines.json", { drawing, selection, handles });
});

test("Tidy waits for the Inspector pane opened by Select all", async ({ page }) => {
  await page.addInitScript(holdResizeObservers, false);
  const opened = await openExample(page, "shared-worker-pool");
  await page.evaluate(() => window.dispatchEvent(new Event("hold-resize-observers")));
  const pane = page.getByTestId("canvas-wrap");
  await pane.evaluate((scope) => {
    scope.setAttribute("data-tidy-during-pane", "0");
    document.addEventListener(
      "click",
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-testid="command-item-action:selection.tidy"]') &&
          (scope.getAttribute("data-pane-pending") === "true" || scope.getAttribute("data-fit-pending") === "true")
        )
          scope.setAttribute("data-tidy-during-pane", "1");
      },
      true,
    );
  });
  let finished = false;
  const tidying = tidyAll(page, opened).then(() => {
    finished = true;
  });
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heldResizeObservers(): number }).heldResizeObservers()))
    .toBeGreaterThan(0);
  // A stationary node settles in this same run while the pane's measurements are held.
  await waitForStableBox(page.getByTestId("node-orders"));
  expect(finished).toBe(false);
  await expect(pane).toHaveAttribute("data-tidy-during-pane", "0");
  await page.evaluate(() => window.dispatchEvent(new Event("release-resize-observers")));
  await tidying;
  await expect(pane).toHaveAttribute("data-tidy-during-pane", "0");
});

test("an unchanged Auto-layout needs no Undo; full selection offers Tidy without boundaries", async ({ page }) => {
  const opened = await openExample(page, "shared-worker-pool");
  await command(page, "Auto-layout", "canvas.auto-layout");
  const laidOut = await settledCanvas(page);
  expect(laidOut.nodes).toEqual(opened.nodes);
  await restoreOpening(page, opened, laidOut);
  await tidyAll(page, opened);
  await settledCanvas(page);
  expect((await canvasSelection(page)).nodes).toEqual(Object.keys(opened.nodes).sort());
});

test("Undo selects changed nodes; canvas Ctrl+A and palette Select all include the unchanged node", async ({
  page,
}) => {
  // Auto-layout moves every node of this example but one (its app database).
  const opened = await openExample(page, "nightly-batch-elt");
  await command(page, "Auto-layout", "canvas.auto-layout");
  // This assertion specifically observes Undo's selection, before the geometry helper clears it.
  await expect(page.getByTestId("undo-button")).toBeEnabled();
  await page.getByTestId("undo-button").click();
  await settledCanvas(page);
  const undone = await canvasSelection(page);
  expect(undone.nodes).toEqual(
    Object.keys(opened.nodes)
      .filter((id) => id !== "app-db")
      .sort(),
  );
  expect(undone.edges).toEqual([]);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Control+a");
  expect(await canvasSelection(page)).toEqual(undone);
  await page.getByTestId("fit-view-button").focus();
  // Selection shortcuts intentionally leave toolbar controls alone.
  await page.keyboard.press("Control+a");
  expect(await canvasSelection(page)).toEqual(undone);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Control+a");
  const all = { nodes: Object.keys(opened.nodes).sort(), edges: Object.keys(opened.edges).sort() };
  await expect.poll(() => canvasSelection(page)).toEqual(all);
  // The palette action works from the toolbar too, and reopening preserves the full selection.
  await page.keyboard.press("Escape");
  await expect.poll(() => canvasSelection(page)).toEqual({ nodes: [], edges: [] });
  await page.getByTestId("fit-view-button").focus();
  await tidyAll(page, opened);
  expect(await canvasSelection(page)).toEqual(all);
});

test("Tidy of all AWS nodes preserves the drawing when boundary membership leaves no room", async ({ page }) => {
  const opened = await openExample(page, "aws-serverless-orders");
  await tidyAll(page, opened);
  expect((await settledCanvas(page)).nodes).toEqual(opened.nodes);
  await expect(page.getByTestId("toast")).toContainText("Couldn't find room. Nothing moved.");
});

test("edge ids may start with deny-; nested deny markers are not edges", async ({ page }) => {
  await page.setContent(`<div data-testid="canvas-wrap"><svg>
    <g data-testid="edge-deny-admin"><path d="M0,0 L1,1" />
      <g data-testid="edge-deny-deny-admin"><path d="M2,2 L3,3" /></g>
    </g>
  </svg></div>`);
  expect((await readCanvas(page)).edges).toEqual({ "deny-admin": "M0,0 L1,1" });
});
