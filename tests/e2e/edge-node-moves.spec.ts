import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
  waitForSelectionSettled,
  waitForHistoryIdle,
  waitForCameraIdle,
  fitDiagram,
} from "./fixtures";

const SLUG = "kafka-order-pipeline";
const bends = [
  { x: 400, y: 36 },
  { x: 400, y: 276 },
];
const seed = {
  format: "diagrams/v1",
  title: "Move shaped lines",
  direction: "LR",
  nodes: [
    { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "Database", x: 800, y: 240 },
  ],
  edges: [
    { id: "api-db", from: "api", to: "db", kind: "sync", sourceSide: "right", targetSide: "left", waypoints: bends },
  ],
};
async function open(page: Page, boundary = false, tidy = false) {
  const diagram = boundary
    ? {
        ...seed,
        nodes: seed.nodes.map((n) => ({ ...n, group: "cloud" })),
        groups: [{ id: "cloud", label: "Cloud", x: -40, y: -80, width: 1100, height: 440 }],
      }
    : tidy
      ? { ...seed, nodes: [...seed.nodes, { id: "worker", stencil: "service.node", label: "Worker", x: 400, y: 120 }] }
      : seed;
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + SLUG,
    diagram,
  });
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await waitForStableViewport(page);
  await waitForHistoryIdle(page);
  return diagram;
}
async function box(page: Page, id: string) {
  const b = await page.getByTestId(id).boundingBox();
  if (!b) throw new Error(`Missing ${id}`);
  return b;
}
async function selectBoth(page: Page, count = 3) {
  const a = await box(page, "node-api"),
    b = await box(page, "node-db");
  await page.mouse.move(a.x + a.width / 2, a.y - 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("inspector-title")).toHaveText(`${count} selected`);
  await waitForSelectionSettled(page);
  await waitForCameraIdle(page);
  await waitForStableViewport(page);
  await fitDiagram(page);
}
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing expected geometry");
  return value;
}
const path = (page: Page) => page.getByTestId("edge-api-db").evaluate((g) => g.children[1].getAttribute("d") ?? "");
const coordinates = (d: string) => must(d.match(/-?\d+(?:\.\d+)?/g)).map(Number);
async function startDrag(page: Page, id: string) {
  const b = await box(page, id);
  const x = b.x + b.width * 0.3,
    y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
}
async function saved(page: Page) {
  await waitForHistoryIdle(page);
  return savedDiagram(page);
}

for (const cancel of ["Escape", "pointercancel", "lostpointercapture", "blur"] as const) {
  test(`cancelling a shared-end drag via ${cancel} restores nodes and bends without history`, async ({ page }) => {
    await open(page);
    await selectBoth(page);
    const before = await saved(page);
    const beforePath = await path(page);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    await startDrag(page, "node-api");
    expect(await path(page)).not.toBe(beforePath);
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else await page.getByTestId("node-api").dispatchEvent(cancel, { pointerId: 1, bubbles: true });
    await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-interaction-state", "gesture");
    // React Flow can keep delivering moves and a final stop after cancellation.
    await page.mouse.move(240, 320, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => path(page)).toBe(beforePath);
    await expect.poll(async () => (await saved(page)).nodes).toEqual(before.nodes);
    expect((await saved(page)).edges).toEqual(before.edges);
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    await expect(page.getByTestId("redo-button")).toBeDisabled();
  });
}

test("cancelling an Alt-drag removes copied nodes and bends without history", async ({ page }) => {
  await open(page);
  await selectBoth(page);
  const before = await saved(page);
  const beforePath = await path(page);
  await page.keyboard.down("Alt");
  await startDrag(page, "node-api");
  await expect(page.getByTestId("node-api-1")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(240, 320, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("node-api-1")).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).nodes).toEqual(before.nodes);
  expect((await saved(page)).edges).toEqual(before.edges);
  expect(await path(page)).toBe(beforePath);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});

test("box-select both ends and drag carries bends live and saves one undo step", async ({ page }) => {
  await open(page);
  await selectBoth(page);
  const before = coordinates(await path(page));
  await startDrag(page, "node-api");
  const during = coordinates(await path(page));
  const dx = during[0] - before[0],
    dy = during[1] - before[1];
  expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  expect(during).toEqual(before.map((n, i) => n + (i % 2 ? dy : dx)));
  // The gesture preview never writes the line's document coordinates.
  expect((await savedDiagram(page)).edges[0].waypoints).toEqual(bends);
  await page.mouse.up();
  const after = await saved(page);
  const a = must(after.nodes.find((n) => n.id === "api"));
  expect(after.edges[0].waypoints).toEqual(bends.map((p) => ({ x: p.x + a.x, y: p.y + a.y })));
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page)).edges[0].waypoints).toEqual(bends);
  expect((await saved(page)).nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(
    seed.nodes.map(({ id, x, y }) => ({ id, x, y })),
  );
});

test("moving one end leaves bends absolute and the target leg unchanged", async ({ page }) => {
  await open(page);
  await page.getByTestId("node-api").click();
  await waitForSelectionSettled(page);
  await waitForStableViewport(page);
  const before = await path(page);
  await startDrag(page, "node-api");
  const during = await path(page);
  expect(during).not.toBe(before);
  // The last corner and the entire entry leg stay at their absolute coordinates.
  expect(during.slice(during.lastIndexOf(" Q"))).toBe(before.slice(before.lastIndexOf(" Q")));
  await page.mouse.up();
  const after = await saved(page);
  expect(after.edges[0].waypoints).toEqual(bends);
  expect(must(after.nodes.find((n) => n.id === "api")).x).not.toBe(0);
});

test("a boundary drag carries its members' shaped line in one undo", async ({ page }) => {
  await open(page, true);
  const before = coordinates(await path(page));
  const g = await box(page, "group-label-cloud");
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2 + 40, { steps: 6 });
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "gesture");
  const during = coordinates(await path(page));
  const dx = during[0] - before[0],
    dy = during[1] - before[1];
  expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  expect(during).toEqual(before.map((n, i) => n + (i % 2 ? dy : dx)));
  await page.mouse.up();
  const after = await saved(page),
    a = must(after.nodes.find((n) => n.id === "api"));
  expect(after.edges[0].waypoints).toEqual(bends.map((p) => ({ x: p.x + a.x, y: p.y + a.y })));
  await page.getByTestId("canvas-wrap").press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page)).edges[0].waypoints).toEqual(bends);
  expect(must((await saved(page)).groups)[0].x).toBe(-40);
});

test("Tidy announces reset lines and its Undo restores both layout and bends", async ({ page }) => {
  const diagram = await open(page, false, true);
  await selectBoth(page, 4);
  await page.getByTestId("inspector-tidy").click();
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
  await expect(page.getByTestId("toast")).toContainText("1 shaped line went back to automatic");
  await expect(page.getByTestId("route-reset-undo")).toBeVisible();
  expect((await saved(page)).edges[0].waypoints).toBeUndefined();
  await page.getByTestId("route-reset-undo").click();
  await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
  await expect.poll(async () => (await savedDiagram(page)).edges[0].waypoints).toEqual(bends);
  const restored = await saved(page);
  expect(restored.edges[0].waypoints).toEqual(bends);
  expect(restored.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
    diagram.nodes.map(({ id, x, y }) => ({ id, x, y })),
  );
});

test("Alt-drag carries only the copied line and Undo removes the whole copy", async ({ page }) => {
  await open(page);
  await selectBoth(page);
  await page.keyboard.down("Alt");
  await startDrag(page, "node-api");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("node-api-1")).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(4);
  const after = await saved(page),
    copy = must(after.nodes.find((n) => n.id === "api-1"));
  const copiedEdge = must(after.edges.find((e) => e.from === "api-1"));
  expect(copiedEdge.waypoints).toEqual(bends.map((p) => ({ x: p.x + copy.x, y: p.y + copy.y })));
  expect(must(after.edges.find((e) => e.id === "api-db")).waypoints).toEqual(bends);
  await page.getByTestId("canvas-wrap").press("ControlOrMeta+z");
  await expect(page.getByTestId("node-api-1")).toHaveCount(0);
  await expect.poll(async () => (await savedDiagram(page)).nodes.length).toBe(2);
});
