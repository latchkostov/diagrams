import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
  waitForHistoryIdle,
  waitForCameraIdle,
  pauseClock,
  viewportTransform,
} from "./fixtures";

const SLUG = "kafka-order-pipeline";
const seedDiagram = {
  format: "diagrams/v1",
  title: "Shape a line",
  direction: "LR",
  nodes: [
    { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "Database", x: 800, y: 240 },
  ],
  edges: [{ id: "api-db", from: "api", to: "db", kind: "sync" }],
};
async function open(page: Page, straight = false, style: "smoothstep" | "bezier" | "straight" = "smoothstep") {
  const diagram = structuredClone(seedDiagram);
  if (straight) diagram.nodes[1].y = 0;
  await page.addInitScript(({ key, style }) => localStorage.setItem(key, JSON.stringify({ edgeStyle: style })), {
    key: STORAGE_KEYS.settings,
    style,
  });
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + SLUG,
    diagram,
  });
  await gotoCanvas(page, SLUG);
  await waitForStableViewport(page);
  const at = await page.getByTestId("edge-api-db").evaluate((el) => {
    const line = el.children[1] as SVGPathElement;
    const p = line.getPointAtLength(line.getTotalLength() / 2);
    const matrix = line.getScreenCTM();
    if (!matrix) throw new Error("Missing edge transform");
    const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("reconnect-api-db-source")).toBeVisible();
  if (style === "smoothstep") await expect(page.getByTestId("route-segment-api-db-0")).toBeVisible();
  await waitForCameraIdle(page);
  await waitForStableViewport(page);
}
for (const style of ["bezier", "straight"] as const)
  test(`${style} automatic routes expose reconnect controls without segment handles`, async ({ page }) => {
    await open(page, true, style);
    // At 100% the collinear samples of this aligned Bezier are long enough for handles.
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Shift+0");
    await waitForStableViewport(page);
    await expect(page.getByTestId(/^route-segment-/)).toHaveCount(0);
    await expect(page.getByTestId("reconnect-api-db-source")).toBeVisible();
  });

test("two consecutive segment drops have separate undo steps inside the history debounce", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await waitForHistoryIdle(page);
  await pauseClock(page);
  const original = await path(page);
  await startDrag(page, 1, 60, 0);
  await page.mouse.up();
  await page.clock.runFor(16);
  const first = await path(page);
  expect(first).not.toBe(original);
  await startDrag(page, 1, 60, 0);
  await page.mouse.up();
  await page.clock.runFor(16);
  expect(await path(page)).not.toBe(first);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => path(page)).toBe(first);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => path(page)).toBe(original);
});

test("Space drag over a segment handle pans without reshaping", async ({ page }) => {
  await open(page);
  const before = await path(page);
  const viewport = await viewportTransform(page);
  const box = await page.getByTestId("route-segment-api-db-1").boundingBox();
  if (!box) throw new Error("Missing segment handle");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.down("Space");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await expect(page.getByTestId("route-preview")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(() => viewportTransform(page)).not.toBe(viewport);
  expect(await path(page)).toBe(before);
  expect((await savedDiagram(page)).edges[0].waypoints).toBeUndefined();
});
const path = (page: Page) => page.getByTestId("edge-api-db").evaluate((el) => el.children[1].getAttribute("d"));
async function startDrag(page: Page, k: number, dx: number, dy: number) {
  const box = await page.getByTestId(`route-segment-api-db-${k}`).boundingBox();
  if (!box) throw new Error("Missing segment handle");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await expect(page.getByTestId("route-preview")).toBeVisible();
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
}
async function custom(page: Page) {
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await waitForHistoryIdle(page);
  const points = (await savedDiagram(page)).edges[0].waypoints;
  if (!points) throw new Error("Expected saved bends");
  return points;
}

test("first inner drag freezes the drawn route, previews without writing, and undoes in one step", async ({ page }) => {
  await open(page);
  const before = await path(page);
  await startDrag(page, 1, 60, 0);
  await expect(page.getByTestId("edge-api-db")).toHaveClass(/is-reshaping/);
  expect(await path(page)).toBe(before);
  expect((await savedDiagram(page)).edges[0].waypoints).toBeUndefined();
  await page.mouse.up();
  const bends = await custom(page);
  expect(bends).toHaveLength(2);
  expect(await path(page)).not.toBe(before);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
  await expect.poll(() => path(page)).toBe(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await custom(page)).toEqual(bends);
});

test("an end drag adds two bends while the port stub stays straight", async ({ page }) => {
  await open(page);
  await startDrag(page, 0, 0, -60);
  await page.mouse.up();
  expect(await custom(page)).toHaveLength(4);
});

test("a straight line gains a jog and lining its middle up removes all bends", async ({ page }) => {
  await open(page, true);
  await startDrag(page, 0, 0, 60);
  await page.mouse.up();
  expect(await custom(page)).toHaveLength(4);
  // Use flow coordinates from the saved bends to line the centre up with its port, at any zoom.
  const box = await page.getByTestId("route-segment-api-db-2").boundingBox();
  const end = await page.getByTestId("reconnect-api-db-source").boundingBox();
  if (!box || !end) throw new Error("Missing shaping chrome");
  await startDrag(page, 2, 0, end.y + end.height / 2 - box.y - box.height / 2);
  await expect(page.getByTestId("route-guide")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
});

for (const modifier of ["Control", "Meta"])
  test(`${modifier} drag preserves an off-grid position while an unmodified drag snaps`, async ({ page }) => {
    await open(page);
    const geometry = await page.getByTestId("edge-api-db").evaluate((el) => {
      const line = el.children[1] as SVGPathElement;
      const matrix = line.getScreenCTM();
      if (!matrix) throw new Error("Missing edge transform");
      return { zoom: matrix.a };
    });
    const handle = await page.getByTestId("route-segment-api-db-1").evaluate((el) => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return matrix.m41;
    });
    // Aim close to a grid line, away from ports/node guides and beyond the drag activation distance.
    const grid = Math.round((handle + 60) / 10) * 10;
    const expected = grid + 2;
    const dx = (expected - handle) * geometry.zoom;
    await startDrag(page, 1, dx, 0);
    await page.mouse.up();
    expect((await custom(page))[0].x).toBe(grid);
    await page.keyboard.press("ControlOrMeta+z");
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    await page.keyboard.down(modifier);
    await startDrag(page, 1, dx, 0);
    await expect(page.getByTestId("route-guide")).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up(modifier);
    expect((await custom(page))[0].x).toBeCloseTo(expected, 5);
  });

test("Escape and blur cancel the preview without freezing the line", async ({ page }) => {
  await open(page);
  const before = await path(page);
  await startDrag(page, 1, 60, 0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("route-preview")).toHaveCount(0);
  expect(await path(page)).toBe(before);
  await startDrag(page, 1, 60, 0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect(page.getByTestId("route-preview")).toHaveCount(0);
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
});

test("multi-selection hides segment handles; Live hides editing chrome", async ({ page }) => {
  await open(page);
  await page.keyboard.down("Shift");
  await page.getByTestId("node-api").click();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId(/^route-segment-/)).toHaveCount(0);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("l");
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(page.getByTestId(/^route-segment-/)).toHaveCount(0);
});

test("SVG excludes segment chrome and includes a far bend in its viewBox", async ({ page }) => {
  await open(page, true);
  await startDrag(page, 0, 0, 280);
  await page.mouse.up();
  const bends = await custom(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("image-export").click();
  const file = await download;
  const filename = await file.path();
  if (!filename) throw new Error("SVG download failed");
  const svg = await readFile(filename, "utf8");
  expect(svg).not.toContain("edge-seg");
  expect(svg).not.toContain("edge-route-preview");
  const viewBox = svg.match(/viewBox="([^"]+)"/);
  if (!viewBox) throw new Error("Missing viewBox");
  const [, , , height] = viewBox[1].split(/\s+/).map(Number);
  expect(height).toBeGreaterThan(Math.max(...bends.map((p) => p.y)));
});

test("a drag along a segment does not freeze an unchanged automatic route", async ({ page }) => {
  await open(page);
  const before = await path(page);
  await startDrag(page, 1, 0, 60);
  await page.mouse.up();
  await expect(page.getByTestId("route-preview")).toHaveCount(0);
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
  expect(await path(page)).toBe(before);
});

test("the shortcuts sheet explains dots and pointer shaping", async ({ page }) => {
  await open(page);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("?");
  const mouse = page.getByTestId("shortcuts-mouse");
  await expect(mouse).toContainText("Drag from a dot");
  await expect(mouse).toContainText("Connect: attach to a dot, let a node choose, or add on empty canvas");
  await expect(mouse).toContainText("Drag a selected line");
  await expect(mouse).toContainText("Line up neighbouring segments");
  await expect(mouse).toContainText("Route ▸ Reset route");
});
