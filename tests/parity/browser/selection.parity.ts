import { test, expect } from "./fixtures";
import { canvasSelection, command, openExample, readCanvas, restoreOpening, settledCanvas, tidyAll } from "./canvas";

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
  const opened = await openExample(page, "rag-assistant");
  await command(page, "Auto-layout", "canvas.auto-layout");
  await restoreOpening(page, opened, await settledCanvas(page));
  const undone = await canvasSelection(page);
  expect(undone.nodes).toEqual(
    Object.keys(opened.nodes)
      .filter((id) => id !== "user")
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
  const opened = await openExample(page, "aws-fanout");
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
