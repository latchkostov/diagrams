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
async function open(
  page: Page,
  straight = false,
  style: "smoothstep" | "bezier" | "straight" = "smoothstep",
  waypoints?: { x: number; y: number }[],
) {
  const diagram = {
    ...structuredClone(seedDiagram),
    edges: seedDiagram.edges.map((edge) => ({
      ...edge,
      ...(waypoints ? { waypoints, sourceSide: "right", targetSide: "left" } : {}),
    })),
  };
  if (straight) diagram.nodes[0].y = diagram.nodes[1].y = 4;
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
  if (style === "smoothstep") await expect(page.getByTestId(`route-segment-api-db-${waypoints ? 1 : 0}`)).toBeVisible();
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
  await expect(page.getByTestId("shortcut-segment-prev")).toContainText("Previous segment");
  await expect(page.getByTestId("shortcut-segment-next")).toContainText("Next segment");
  await expect(page.getByTestId("shortcut-segment-nudge")).toContainText("On a selected line");
});

async function focusEdge(page: Page, straight = false) {
  await page.getByTestId("node-api").click();
  // eslint-disable-next-line no-restricted-syntax -- Edge navigation uses literal Ctrl on every platform.
  await page.keyboard.press("Control+Alt+]");
  await expect
    .poll(() => page.getByTestId("edge-api-db").evaluate((el) => el.parentElement === document.activeElement))
    .toBe(true);
  await expect(page.getByTestId(`route-segment-api-db-${straight ? 0 : 1}`)).toBeVisible();
}

test("keyboard segment cycling keeps edge focus and announces the active leg", async ({ page }) => {
  await open(page);
  await focusEdge(page);
  const initial = page.getByTestId("route-segment-api-db-1");
  await expect(initial).toHaveClass(/is-active/);
  expect(await initial.evaluate((el) => getComputedStyle(el, "::after").outlineStyle)).toBe("solid");
  // The label lies on the inner vertical leg. Stepping next reaches the horizontal tail.
  await page.keyboard.press("]");
  await expect(page.getByTestId("route-segment-api-db-2")).toHaveClass(/is-active/);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment 3 of 3, horizontal. Up and down move it.");
  await page.keyboard.press("[");
  await expect(page.getByTestId("route-segment-api-db-1")).toHaveClass(/is-active/);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment 2 of 3, vertical. Left and right move it.");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("canvas-announce")).toHaveText("Use ← → to move a vertical segment.");
  expect((await savedDiagram(page)).edges[0].waypoints).toBeUndefined();
  expect(await page.getByTestId("edge-api-db").evaluate((el) => el.parentElement === document.activeElement)).toBe(
    true,
  );
});

test("three keyboard nudges separated by history commits merge into one undo step", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await focusEdge(page);
  await waitForHistoryIdle(page);
  await pauseClock(page);
  const original = await path(page);
  let previousAnnouncement: string | undefined;
  const initialX = await page
    .getByTestId("route-segment-api-db-1")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  for (let n = 0; n < 3; n++) {
    await page.getByTestId("canvas-announce").evaluate((el) => {
      if (el.firstChild instanceof Element) el.firstChild.setAttribute("data-previous-announcement", "1");
    });
    await page.keyboard.press("ArrowRight");
    // Effects may register the debounce after a clock tick. Drive it until the actual commit;
    // the single-Undo assertion below still proves the nudges stayed within the merge window.
    await expect
      .poll(async () => {
        await page.clock.runFor(400);
        return page.evaluate(() => window.__historyProbe?.().pending);
      })
      .toBe(false);
    const bends = await custom(page);
    await expect(page.getByTestId("route-segment-api-db-1")).toHaveClass(/is-active/);
    const x = (Math.floor(initialX / 10) + n + 1) * 10;
    expect(bends).toEqual([
      { x, y: 36 },
      { x, y: 276 },
    ]);
    const announcement = await page.getByTestId("canvas-announce").getAttribute("data-seq");
    expect(announcement).not.toBe(previousAnnouncement);
    previousAnnouncement = announcement ?? undefined;
    expect(
      await page
        .getByTestId("canvas-announce")
        .evaluate((el) => el.firstChild instanceof Element && el.firstChild.hasAttribute("data-previous-announcement")),
    ).toBe(false);
  }
  const after = await path(page);
  expect(after).not.toBe(original);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Moved right 10 px.");
  await page.keyboard.press("ControlOrMeta+z");
  await page.clock.runFor(32);
  await expect.poll(() => path(page)).toBe(original);
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.clock.runFor(32);
  await expect.poll(() => path(page)).toBe(after);
});

test("keyboard nudging a straight line adds a jog, then merges its segments back to automatic", async ({ page }) => {
  await open(page, true);
  await focusEdge(page, true);
  const original = await path(page);
  await page.keyboard.press("ArrowDown");
  expect(await custom(page)).toHaveLength(4);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment selection reset");
  await expectNoActiveSegment(page);
  await page.keyboard.press("]");
  await expect(page.getByTestId("route-segment-api-db-0")).toHaveClass(/is-active/);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await page.keyboard.press("ArrowUp");
  await expectNoActiveSegment(page);
  await expect(page.getByTestId("edge-api-db")).not.toHaveAttribute("data-route", "custom");
  await expect.poll(() => path(page)).toBe(original);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment selection reset");
  await page.keyboard.press("]");
  await expect(page.getByTestId("route-segment-api-db-0")).toHaveClass(/is-active/);
});

async function expectNoActiveSegment(page: Page) {
  for (const segment of await page.getByTestId(/^route-segment-api-db-/).all())
    await expect(segment).not.toHaveClass(/is-active/);
}

test("pointer shaping resets the active segment and cycling restarts at the first leg", async ({ page }) => {
  await open(page);
  await focusEdge(page);
  await startDrag(page, 1, 60, 0);
  await page.mouse.up();
  await custom(page);
  await expectNoActiveSegment(page);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment selection reset");
  // Restore edge focus without changing selection.
  await page.getByTestId("edge-api-db").evaluate((el) => (el.parentElement as HTMLElement).focus());
  await page.keyboard.press("]");
  await expect(page.getByTestId("route-segment-api-db-0")).toHaveClass(/is-active/);
});

test("keyboard selection resets when an endpoint escape detour renumbers its legs", async ({ page }) => {
  await open(page, false, "smoothstep", [
    { x: 240, y: 36 },
    { x: 240, y: 276 },
  ]);
  await focusEdge(page);
  await page.keyboard.press("ArrowLeft");
  const bends = await custom(page);
  expect(bends.some((p, i) => p.x === 230 && bends[i + 1]?.x === 230)).toBe(true);
  await expectNoActiveSegment(page);
  await expect(page.getByTestId("canvas-announce")).toHaveText("Segment selection reset");
  await page.keyboard.press("]");
  await expect(page.getByTestId("route-segment-api-db-0")).toHaveClass(/is-active/);
});

test.describe("touch shaping", () => {
  test.use({ hasTouch: true });
  test("a touch on a reconnect dot beside a short stub starts reconnecting", async ({ page, context }) => {
    await open(page, true);
    await focusEdge(page, true);
    await page.keyboard.press("ArrowDown");
    await custom(page);
    await page.keyboard.press("Shift+0");
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    const origin = await page.getByTestId("reconnect-api-db-source").boundingBox();
    if (!origin) throw new Error("Missing reconnect dot");
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, process.platform === "darwin" ? -16 : -160);
    await page.keyboard.up("Control");
    await waitForCameraIdle(page);
    await waitForStableViewport(page);
    const dot = page.getByTestId("reconnect-api-db-source");
    const source = await dot.boundingBox();
    const target = await page.getByTestId("reconnect-api-db-target").boundingBox();
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    if (!source || !target || !pane) throw new Error("Missing reconnect geometry");
    // Centre both ends in the reserved canvas space after zooming, clear of the inspector.
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.wheel((source.x + target.x + source.width) / 2 - (pane.x + pane.width / 2), 0);
    await waitForStableViewport(page);
    // Check the enlarged hit area too, including its side nearest the short segment.
    for (const end of ["source", "target"]) {
      const hit = await page.getByTestId(`reconnect-api-db-${end}`).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2,
          y = r.y + r.height / 2;
        return [0, -16, 16].map((dx) =>
          document
            .elementFromPoint(x + dx, y)
            ?.closest("[data-testid]")
            ?.getAttribute("data-testid"),
        );
      });
      expect(hit).toEqual(Array(3).fill(`reconnect-api-db-${end}`));
    }
    const box = await dot.boundingBox();
    if (!box) throw new Error("Missing reconnect dot");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 70, y: y + 70 }] });
    await expect(page.getByTestId("reconnect-line")).toBeVisible();
    await expect(page.getByTestId("route-preview")).toHaveCount(0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await cdp.detach();
  });
  for (const cancel of [false, true])
    test(
      cancel ? "pointercancel snaps back without history" : "touch release commits once despite implicit capture loss",
      async ({ page, context }) => {
        await open(page);
        await waitForHistoryIdle(page);
        const before = await path(page);
        const viewport = await viewportTransform(page);
        const handle = page.getByTestId("route-segment-api-db-1");
        expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
        expect(await handle.evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(44);
        await handle.evaluate((el) =>
          el.addEventListener(
            "pointerdown",
            (event) => {
              el.setAttribute("data-pointer-type", (event as PointerEvent).pointerType);
            },
            { once: true },
          ),
        );
        const box = await handle.boundingBox();
        if (!box) throw new Error("Missing touch handle");
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await expect(handle).toHaveAttribute("data-pointer-type", "touch");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 60, y }] });
        await expect(page.getByTestId("route-preview")).toBeVisible();
        if (cancel) await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(page.getByTestId("route-preview")).toHaveCount(0);
        await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
        expect(await viewportTransform(page)).toBe(viewport);
        if (cancel) {
          expect(await path(page)).toBe(before);
          expect((await savedDiagram(page)).edges[0].waypoints).toBeUndefined();
          await expect(page.getByTestId("undo-button")).toBeDisabled();
        } else {
          await custom(page);
          expect(await path(page)).not.toBe(before);
          await page.getByTestId("canvas-wrap").focus();
          await page.keyboard.press("ControlOrMeta+z");
          await expect.poll(() => path(page)).toBe(before);
          await expect(page.getByTestId("undo-button")).toBeDisabled();
        }
        await cdp.detach();
      },
    );
});
