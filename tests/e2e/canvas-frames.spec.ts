import {
  frameCrowdedFixture,
  frameRoutingFixture,
  frameFanFixture,
  framePackedFanFixture,
} from "../../src/lab/frameRoutingFixture";
import { test, expect, gotoCanvas, waitForCameraIdle } from "./fixtures";

for (const kind of ["async", "sync"] as const) {
  test(`unselected ${kind} captions retain readable, collision-free ink`, async ({ page }) => {
    const diagram = frameRoutingFixture();
    diagram.edges[0].kind = kind;
    await page.addInitScript(
      (diagram) => localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram)),
      diagram,
    );
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("canvas-wrap").press("Shift+0");
    await waitForCameraIdle(page);
    for (let step = 0; step < 2; step++) {
      await page.getByTestId("zoom-out-button").click();
      await waitForCameraIdle(page);
    }
    const label = page.getByTestId("edge-label-request");
    await expect(label).toBeVisible();
    await expect
      .poll(() =>
        label.evaluate((el) => {
          const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
          if (!canvas) throw new Error("Expected the canvas frame");
          return parseFloat(getComputedStyle(el).fontSize) * Number(canvas.style.getPropertyValue("--rf-zoom-exact"));
        }),
      )
      .toBeGreaterThanOrEqual(10.5);
    const collisions = await label.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid^="rf__node-"]')]
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        })
        .map((node) => node.getAttribute("data-testid"));
    });
    expect(collisions).toEqual([]);
  });
}

for (const kind of ["node", "note"] as const)
  test(`rejected caption enlargement restores every style after a rendered ${kind} moves`, async ({ page }) => {
    await page.addInitScript(
      (diagram) => localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram)),
      frameCrowdedFixture(kind),
    );
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("node-source").click();
    await page.getByTestId("canvas-wrap").press("Shift+0");
    await waitForCameraIdle(page);
    for (let step = 0; step < 2; step++) {
      await page.getByTestId("zoom-out-button").click();
      await waitForCameraIdle(page);
    }
    const label = page.getByTestId("edge-label-request");
    await expect(label).toBeVisible();
    await expect.poll(() => label.evaluate((el) => (el as HTMLElement).style.width)).toBe("max-content");
    const obstacle = page.getByTestId("rf__node-obstruction");
    const before = await obstacle.evaluate((el) => {
      const before = (el as HTMLElement).style.transform;
      (el as HTMLElement).style.transform = "translate(-1000px,-1000px) scale(100)";
      return before;
    });
    await page.getByTestId("canvas-wrap").evaluate((el) => el.setAttribute("data-detail-measure", "crowded"));
    await expect(label).toHaveAttribute("data-detail-hidden", "");
    expect(
      await label.evaluate((el) => {
        const s = (el as HTMLElement).style;
        return [s.fontSize, s.width, s.height, s.lineHeight, s.translate];
      }),
    ).toEqual(["", "", "", "", ""]);
    await obstacle.evaluate((el, before) => {
      (el as HTMLElement).style.transform = before;
    }, before);
    await page.getByTestId("canvas-wrap").evaluate((el) => el.setAttribute("data-detail-measure", "clear"));
    await expect(label).toBeVisible();
    await expect.poll(() => label.evaluate((el) => (el as HTMLElement).style.width)).toBe("max-content");
  });

test("a pinned route shares its stroke, halo and pointer target", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "outbox-saga-checkout");
  await page.getByTestId("node-order-api").click();
  await page.getByTestId("view-focus").click();
  await waitForCameraIdle(page);
  await expect(page.getByTestId("focus-offscreen-saga")).toBeVisible();
  const id = "saga-to-order-api";
  const stroke = page.getByTestId(`connection-stroke-${id}`);
  const path = await stroke.getAttribute("d");
  if (!path) throw new Error("Expected the displayed route");
  await expect(page.getByTestId(`connection-halo-${id}`)).toHaveAttribute("d", path);
  await expect(page.getByTestId(`connection-hit-${id}`)).toHaveAttribute("d", path);
  const at = await stroke.evaluate((el, id) => {
    const path = el as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Expected the route transform");
    for (let f = 0.2; f < 0.9; f += 0.05) {
      const p = path.getPointAtLength(path.getTotalLength() * f);
      const at = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      if (document.elementFromPoint(at.x, at.y)?.getAttribute("data-testid") === `connection-hit-${id}`)
        return { x: at.x, y: at.y };
    }
    throw new Error("Expected a pointer target on the displayed route");
  }, id);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId(`reconnect-${id}-source`)).toBeVisible();
});

test("mixed fan lanes share their hit targets and editable geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    (diagram) => localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram)),
    frameFanFixture(),
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("node-source").click();
  await page.getByTestId("view-focus").click();
  await waitForCameraIdle(page);
  await expect(page.getByTestId(/^focus-offscreen-/)).toHaveCount(0);
  const id = "request";
  const stroke = page.getByTestId(`connection-stroke-${id}`);
  for (const edge of ["dependency", "message", "request"]) {
    const path = await page.getByTestId(`connection-stroke-${edge}`).getAttribute("d");
    if (!path) throw new Error("Expected the displayed route");
    await expect(page.getByTestId(`connection-hit-${edge}`)).toHaveAttribute("d", path);
    await expect(page.getByTestId(`connection-halo-${edge}`)).toHaveAttribute("d", path);
  }
  const at = await stroke.evaluate((el) => {
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Expected the route transform");
    const at = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: at.x, y: at.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId(`reconnect-${id}-source`)).toBeVisible();
  await waitForCameraIdle(page);
  const errors = await stroke.evaluate((el, id) => {
    const path = el as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Expected the route transform");
    const length = path.getTotalLength();
    return [
      ...document.querySelectorAll(`[data-testid^="route-segment-${id}-"], [data-testid^="reconnect-${id}-"]`),
    ].map((handle) => {
      const b = handle.getBoundingClientRect();
      const x = b.x + b.width / 2,
        y = b.y + b.height / 2;
      let distance = Infinity;
      for (let i = 0; i <= Math.ceil(length * 2); i++) {
        const p = path.getPointAtLength(Math.min(length, i / 2));
        const at = new DOMPoint(p.x, p.y).matrixTransform(matrix);
        distance = Math.min(distance, Math.hypot(at.x - x, at.y - y));
      }
      return { id: handle.getAttribute("data-testid"), distance };
    });
  }, id);
  expect(errors.length).toBeGreaterThan(2);
  for (const handle of errors) expect(handle.distance, handle.id ?? "Route control").toBeLessThan(1);
});

test("accepted and obstructed mixed fans use the shared packed lanes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    (diagram) => localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram)),
    framePackedFanFixture(),
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  const read = async () => {
    const readings = [];
    for (const id of ["dependency", "message", "request"])
      readings.push(
        await page.getByTestId(`connection-stroke-${id}`).evaluate((el) => {
          const path = el as SVGPathElement;
          const length = path.getTotalLength();
          const start = path.getPointAtLength(0),
            end = path.getPointAtLength(length);
          const y = (start.y + end.y) / 2;
          let track = start,
            error = Infinity;
          for (let at = 0; at <= length; at += 0.25) {
            const p = path.getPointAtLength(at);
            if (Math.abs(p.y - y) < error) {
              error = Math.abs(p.y - y);
              track = p;
            }
          }
          const matrix = path.getScreenCTM();
          if (!matrix) throw new Error("Expected the route transform");
          const d = path.getAttribute("d");
          if (!d) throw new Error("Expected the displayed route");
          const screen = new DOMPoint(track.x, track.y).matrixTransform(matrix);
          return {
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            track: track.x,
            screen: { x: screen.x, y: screen.y },
            d,
          };
        }),
      );
    return readings;
  };
  const natural = await read();
  await page.getByTestId("canvas-wrap").press("ControlOrMeta+a");
  await page.getByTestId("canvas-wrap").press("Shift+2");
  await waitForCameraIdle(page);
  await expect(page.getByTestId(/^focus-offscreen-/)).toHaveCount(0);
  const accepted = await read();
  const tracks = accepted.map((r) => r.screen.x).sort((a, b) => a - b);
  // Every relationship participates, including the two outer lanes.
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) expect(Math.abs(tracks[j] - tracks[i] - (j - i) * 8)).toBeLessThan(0.1);
    expect(accepted[i].start).toEqual(natural[i].start);
    expect(accepted[i].end).toEqual(natural[i].end);
  }
  expect(accepted.map((r) => r.track)).not.toEqual(natural.map((r) => r.track));
  const shared = async (readings: Awaited<ReturnType<typeof read>>) => {
    for (const [i, id] of ["dependency", "message", "request"].entries()) {
      await expect(page.getByTestId(`connection-hit-${id}`)).toHaveAttribute("d", readings[i].d);
      await expect(page.getByTestId(`connection-halo-${id}`)).toHaveAttribute("d", readings[i].d);
    }
  };
  await shared(accepted);
  const centre = accepted[1].screen;
  await page.getByTestId("rf__node-packing-obstacle").evaluate((el, centre) => {
    const probe = window.__flowProbe?.();
    if (!probe) throw new Error("Expected the canvas coordinate mapping");
    const at = probe.toFlow(centre.x - 14, centre.y - 35);
    const style = (el as HTMLElement).style;
    style.transform = `translate(${at.x}px, ${at.y}px)`;
    style.width = `${28 / probe.zoom}px`;
    style.height = `${70 / probe.zoom}px`;
  }, centre);
  await page.getByTestId("canvas-wrap").evaluate((el) => el.setAttribute("data-detail-measure", "obstructed-fan"));
  await expect.poll(async () => (await read()).map((r) => r.track)).toEqual(natural.map((r) => r.track));
  const rejected = await read();
  await shared(rejected);
  expect(rejected.map((r) => r.d)).toEqual(natural.map((r) => r.d));
  for (let i = 0; i < 3; i++) {
    expect(rejected[i].start).toEqual(natural[i].start);
    expect(rejected[i].end).toEqual(natural[i].end);
  }
});
