import { eventPipeline } from "../../src/bench/workloads/pipeline";
import { Bench } from "../bench/ui/harness";
import { test, expect, pauseClock } from "./fixtures";

test.beforeEach(async ({ page, baseURL }) => {
  const d = eventPipeline(100);
  const b = await Bench.create(page);
  await b.open({ text: JSON.stringify(d), d }, { url: baseURL });
  await b.canvasSettled();
});

test("benchmark selection waits for the deferred Inspector reveal and pan", async ({ page }) => {
  const b = new Bench(page, await page.context().newCDPSession(page));
  const ids = eventPipeline(100).nodes.map((n) => n.id);
  const target = await b.nodeNearCentre(ids);
  await page.clock.install();
  await pauseClock(page);
  let returned = false;
  const selecting = b.clickNode(target).then(() => {
    returned = true;
  });
  try {
    await expect(page.getByTestId(`grow-chip-${target.slice(5)}`)).toBeVisible();
    await page.evaluate(() => undefined);
    expect(returned, "selection cannot return while the reveal clock is held").toBe(false);
    await page.clock.resume();
    await selecting;
    expect(await page.getByTestId("inspector").getAttribute("data-collapsed")).not.toBe("1");
    // Reading the point immediately on return must use the new pane and camera.
    const point = await b.pointOn(target, { fit: false });
    expect(
      await page
        .getByTestId(target)
        .evaluate((node, at) => node.contains(document.elementFromPoint(at.x, at.y)), point),
    ).toBe(true);
  } finally {
    await page.clock.resume();
    await selecting;
  }
});

test("benchmark finds cards outside the old centre circle without moving the camera", async ({ page }) => {
  const b = new Bench(page, await page.context().newCDPSession(page));
  await b.fitDiagram();
  const ids = eventPipeline(100).nodes.map((n) => n.id);
  const target = await page.getByTestId("canvas-wrap").evaluate((pane, ids) => {
    const box = pane.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const radius = Math.min(box.width, box.height) / 2;
    return ids.find((id) => {
      const node = document.querySelector(`[data-testid="node-${id}"]`);
      if (!node) return false;
      const r = node.getBoundingClientRect();
      const dx = Math.max(r.left - cx, 0, cx - r.right);
      const dy = Math.max(r.top - cy, 0, cy - r.bottom);
      return (
        r.left >= box.left &&
        r.right <= box.right &&
        r.top >= box.top &&
        r.bottom <= box.bottom &&
        Math.hypot(dx, dy) > radius
      );
    });
  }, ids);
  if (!target) throw new Error("Expected a visible card outside the inscribed circle");
  const before = await b.viewport();
  const point = await b.pointOn(`node-${target}`, { fit: false });
  expect(
    await page
      .getByTestId(`node-${target}`)
      .evaluate((node, at) => node.contains(document.elementFromPoint(at.x, at.y)), point),
  ).toBe(true);
  expect(await b.viewport()).toEqual(before);
});

test("benchmark fits an off-pane card through the app before clicking it", async ({ page }) => {
  const b = new Bench(page, await page.context().newCDPSession(page));
  const target = await b.nodeNearCentre(eventPipeline(100).nodes.map((n) => n.id));
  await b.clickNode(target);
  await b.pan(await b.emptySpot(), 80);
  await b.canvasSettled();
  await expect(b.pointOn(target, { fit: false })).rejects.toThrow("no clickable point");
  const before = await b.viewport();
  await b.clickNode(target);
  expect(await b.viewport()).not.toEqual(before);
  const point = await b.pointOn(target, { fit: false });
  expect(
    await page.getByTestId(target).evaluate((node, at) => node.contains(document.elementFromPoint(at.x, at.y)), point),
  ).toBe(true);
  await expect(page.getByTestId(`grow-chip-${target.slice(5)}`)).toBeVisible();
});
