import { openDiagramProperties } from "./fixtures";
import { toggleTheme, expectTheme, openAnnotate } from "./fixtures";
import { openLibrary } from "./fixtures";
import {
  waitForHistoryIdle,
  waitForCameraIdle,
  TEXT_END,
  test,
  expect,
  gotoCanvas,
  gotoLab,
  expectNoErrors,
  STORAGE_KEYS,
  waitForStableBox,
  waitForSelectionSettled,
  savedDiagram,
  emptyCanvasPoint,
  waitForStableViewport,
  pauseClock,
  fitDiagram,
  waitForLiveSession,
} from "./fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { annotationShapesFixture } from "../../src/lab/annotationShapesFixture";
import { pickSides } from "../../src/canvas/edges/routing";
import type { Locator, Page } from "@playwright/test";

// Annotations: free text, sticky notes, zones and shapes. Documentation only, never simulated.
// Selectors are data-testid only.

const SLUG = "kafka-order-pipeline";
const MOD = "ControlOrMeta";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const annotation = (page: Page, id: string) => page.getByTestId(`annotation-${id}`);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}

/** An empty spot on the pane: top-centre of the canvas (fit view keeps it clear). */
async function emptySpot(page: Page, dx = 0) {
  return emptyCanvasPoint(page, dx);
}

/** Waits for the opening fit to finish (a viewport move closes any open menu). */
function settle(page: Page, nodeId = "payments") {
  return waitForStableBox(page.getByTestId(`node-${nodeId}`));
}

async function openCanvasMenu(page: Page, dx = 0) {
  // Retried: a fit animation still running when the page opens closes a menu as it appears.
  await expect(async () => {
    await page.getByTestId("canvas-wrap").click({ button: "right", position: await emptySpot(page, dx) });
    await expect(page.getByTestId("context-menu")).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Types into the inline editor that just opened, then commits with Esc. */
async function typeAndCommit(page: Page, text: string) {
  const editor = page.getByTestId("annotation-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.press(`${MOD}+a`);
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
}

const kafka = JSON.parse(readFileSync(join(process.cwd(), "src/examples", `${SLUG}.json`), "utf8"));

/** The Kafka example with a zone, two notes, a title and a shape, seeded as its autosave. */
const annotatedKafka = {
  ...kafka,
  annotations: [
    { id: "zone-edge", kind: "zone", text: "Public edge", x: 10, y: 210, width: 690, height: 200, color: "purple" },
    { id: "title", kind: "text", text: "How an order flows", x: 40, y: 60, width: 520, height: 44, textSize: "xl" },
    { id: "note-retry", kind: "note", text: "Gateway retries 3x,\nthen 503.", x: 420, y: 440, width: 230, height: 96 },
    {
      id: "note-replay",
      kind: "note",
      text: "Compacted topic.",
      x: 1150,
      y: 640,
      width: 260,
      height: 96,
      color: "blue",
    },
    { id: "legacy", kind: "shape", shape: "cylinder", text: "Legacy FTP", x: 2240, y: 270, width: 160, height: 90 },
  ],
  edges: [...kafka.edges, { id: "to-legacy", from: "payment-db", to: "legacy", kind: "async" }],
};

async function seed(page: Page, diagram: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      // Only on the first load: later reloads keep what the test did.
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [STORAGE_KEYS.autosavePrefix + SLUG, JSON.stringify(diagram)] as const,
  );
}

test.describe("annotations", () => {
  test("moving more shapes than the shared handle cache retains reuses each node's handles", async ({ page }) => {
    const count = 129;
    await seed(page, {
      format: "diagrams/v1",
      title: "Memoized handles",
      nodes: [],
      edges: [],
      annotations: Array.from({ length: count }, (_, i) => ({
        id: `memo-${i}`,
        kind: "shape",
        shape: i === count - 1 ? "tri" : "ellipse",
        text: "",
        x: (i % 13) * 300,
        y: Math.floor(i / 13) * 160,
        width: 160 + i,
        height: 90,
      })),
    });
    await gotoCanvas(page, SLUG);
    // The last outline publishes only after attachment geometry is ready for every node.
    await expect
      .poll(() =>
        annotation(page, `memo-${count - 1}`)
          .getByTestId("shape-outline")
          .evaluate((svg) => svg.firstElementChild?.tagName),
      )
      .toBe("polygon");
    await annotation(page, "memo-0").click();
    await waitForSelectionSettled(page);
    await page.evaluate(() => {
      const cos = Math.cos;
      document.documentElement.dataset.outlineSamples = "0";
      Math.cos = (value: number) => {
        document.documentElement.dataset.outlineSamples = String(
          Number(document.documentElement.dataset.outlineSamples) + 1,
        );
        return cos(value);
      };
    });
    await page.keyboard.press(`${MOD}+a`);
    await waitForSelectionSettled(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await savedDiagram(page)).annotations?.[0].x).toBe(10);
    // Sampling an ellipse's attachment outline calls cos for each segment. Moving and selection
    // keep the dimensions: even a selection larger than the shared cache must not resample.
    expect(await page.evaluate(() => Number(document.documentElement.dataset.outlineSamples))).toBeLessThan(
      Math.min(24, count / 8),
    );
  });

  test("default outlines do not download the extended catalog until a non-default shape is rendered", async ({
    page,
  }) => {
    test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
    let downloads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/extendedGeometry-[^/]+\.js$/, async (route) => {
      downloads++;
      await held;
      await route.continue();
    });
    try {
      await seed(page, {
        format: "diagrams/v1",
        title: "Deferred outline",
        nodes: [],
        annotations: [
          { id: "source", kind: "shape", shape: "rect", text: "Source", x: 0, y: 0, width: 160, height: 90 },
          { id: "target", kind: "shape", shape: "cylinder", text: "Target", x: 500, y: 0, width: 160, height: 90 },
        ],
        edges: [{ id: "connection", from: "source", to: "target" }],
      });
      await gotoCanvas(page, SLUG);
      await annotation(page, "source").click();
      await waitForSelectionSettled(page);
      expect(downloads).toBe(0);
      await page.getByTestId("inspector-more-shapes-btn").click();
      await page.getByTestId("shape-picker-search").fill("triangle");
      await page.getByTestId("context-menu-item-pick-shape:tri").click();
      await expect.poll(() => downloads).toBe(1);
      const outline = annotation(page, "source").getByTestId("shape-outline");
      expect(await outline.evaluate((svg) => svg.firstElementChild?.tagName)).toBe("rect");
      const dimensions = await outline.evaluate((svg) => [svg.getAttribute("width"), svg.getAttribute("height")]);
      const handle = page.getByTestId("handle-source-right");
      const before = (await handle.getAttribute("style")) ?? "";
      expect(before).not.toBe("");
      const endpoint = (locator: Locator) =>
        locator.evaluate((root) => {
          const path = root.children[0];
          if (!(path instanceof SVGPathElement)) throw new Error("Missing connection path");
          const matrix = path.getScreenCTM();
          if (!matrix) throw new Error("Missing path transform");
          const point = path.getPointAtLength(0).matrixTransform(matrix);
          return { x: point.x, y: point.y };
        });
      const edge = page.getByTestId("edge-connection");
      const distance = async (locator: Locator) => {
        const point = await endpoint(locator);
        const bounds = await box(handle);
        return Math.hypot(point.x - bounds.x - bounds.width / 2, point.y - bounds.y - bounds.height / 2);
      };
      await expect.poll(() => distance(edge)).toBeLessThan(1);
      const originalPath = await edge.evaluate((el) => el.firstElementChild?.getAttribute("d"));
      release();
      await expect.poll(() => outline.evaluate((svg) => svg.firstElementChild?.tagName)).toBe("polygon");
      expect(await outline.evaluate((svg) => [svg.getAttribute("width"), svg.getAttribute("height")])).toEqual(
        dimensions,
      );
      await expect(handle).not.toHaveAttribute("style", before);
      await expect.poll(() => edge.evaluate((el) => el.firstElementChild?.getAttribute("d"))).not.toBe(originalPath);
      await expect.poll(() => distance(edge)).toBeLessThan(1);
      const from = await box(handle);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 80, from.y + from.height / 2 + 40, { steps: 8 });
      const preview = page.getByTestId("connection-line");
      await expect(preview).toBeVisible();
      await expect.poll(() => distance(preview)).toBeLessThan(1);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(downloads).toBe(1);
    } finally {
      release();
    }
  });

  test("every shape handle meets its visible stroke", async ({ page }) => {
    const fixture = annotationShapesFixture();
    fixture.annotations = fixture.annotations
      ?.filter((a) => a.id.startsWith("outline-"))
      .map((a) => ({ ...a, width: a.shape === "delay" ? 40 : 160, height: a.shape === "delay" ? 100 : 90 }));
    await seed(page, fixture);
    await gotoCanvas(page, SLUG);
    const distances = await page.getByTestId(/^annotation-outline-/).evaluateAll((roots) =>
      roots.flatMap((root) => {
        const svg = root.querySelector('[data-testid="shape-outline"]');
        if (!(svg instanceof SVGSVGElement)) throw new Error("Missing outline");
        const bounds = svg.getBBox();
        if (
          bounds.x < 0 ||
          bounds.y < 0 ||
          bounds.x + bounds.width > svg.width.baseVal.value ||
          bounds.y + bounds.height > svg.height.baseVal.value
        )
          throw new Error("Outline exceeds its shape bounds");
        const strokes = Array.from(svg.children).filter(
          (el): el is SVGGeometryElement => el instanceof SVGGeometryElement && getComputedStyle(el).stroke !== "none",
        );
        // The four handles share the same stroke. Keep every sample and the same tolerance,
        // but make the expensive browser geometry calls once per stroke, rather than per handle.
        const samples = strokes.flatMap((stroke) => {
          const length = stroke.getTotalLength();
          return Array.from({ length: 2049 }, (_, i) => stroke.getPointAtLength((length * i) / 2048));
        });
        return Array.from(root.querySelectorAll('[data-testid^="handle-"]')).map((handle) => {
          if (!(handle instanceof HTMLElement)) throw new Error("Missing handle");
          const x = parseFloat(handle.style.left),
            y = parseFloat(handle.style.top);
          const distance = samples.reduce((nearest, p) => Math.min(nearest, Math.hypot(x - p.x, y - p.y)), Infinity);
          return { id: handle.getAttribute("data-testid"), distance };
        });
      }),
    );
    expect(distances).toHaveLength(44 * 4);
    for (const { id, distance } of distances) expect(distance, id ?? "handle").toBeLessThan(0.5);
  });

  test("mounting and pasting shapes rely on batched observer measurements", async ({ page }) => {
    await page.addInitScript(() => {
      const state = { forcedQueries: 0 };
      Object.assign(window, { __shapeMeasurements: state });
      const original = Element.prototype.querySelector;
      Element.prototype.querySelector = function (selector: string) {
        // React Flow's explicit updateInternals queries a node by data-id; ResizeObserver does not.
        if (selector.includes("data-id=")) state.forcedQueries++;
        return original.call(this, selector);
      };
    });
    await seed(page, annotationShapesFixture());
    await gotoCanvas(page, SLUG);
    await annotation(page, "outline-rect").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.getByTestId(/^annotation-/).filter({ has: page.getByTestId("shape-outline") })).toHaveCount(116);
    await waitForSelectionSettled(page);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __shapeMeasurements?: { forcedQueries: number } }).__shapeMeasurements?.forcedQueries,
      ),
    ).toBe(0);
  });

  for (const operation of ["pasted", "resized", "height-resized", "reshaped"] as const)
    test(`${operation} handles use current connection geometry`, async ({ page }) => {
      await seed(page, {
        format: "diagrams/v1",
        title: "Measured connections",
        nodes: [],
        edges: [],
        annotations: [
          { id: "source", kind: "shape", shape: "rect", text: "Source", x: 0, y: 0, width: 160, height: 90 },
          { id: "target", kind: "shape", shape: "rect", text: "Target", x: 600, y: 120, width: 160, height: 90 },
        ],
      });
      await gotoCanvas(page, SLUG);
      await annotation(page, "source").click();
      await waitForSelectionSettled(page);
      let source = "source";
      if (operation === "pasted") {
        await page.keyboard.press(`${MOD}+c`);
        await page.keyboard.press(`${MOD}+v`);
        await expect(page.getByTestId(/^annotation-/).filter({ has: page.getByTestId("shape-outline") })).toHaveCount(
          3,
        );
        await expect.poll(async () => (await savedDiagram(page)).annotations?.length).toBe(3);
        const copy = (await savedDiagram(page)).annotations?.find((a) => a.id !== "source" && a.id !== "target");
        if (!copy) throw new Error("Missing pasted shape");
        source = copy.id;
      } else if (operation === "reshaped") {
        await page.getByTestId("inspector-more-shapes-btn").click();
        await page.getByTestId("shape-picker-search").fill("triangle");
        await page.getByTestId("context-menu-item-pick-shape:tri").click();
        await expect(annotation(page, source)).toHaveAttribute("data-shape", "tri");
      } else {
        const dimension = operation === "resized" ? "width" : "height";
        const field = page.getByTestId(`inspector-field-${dimension}`);
        await field.fill("300");
        await field.press("Enter");
        await expect
          .poll(async () => (await savedDiagram(page)).annotations?.find((a) => a.id === source)?.[dimension])
          .toBe(300);
      }
      await waitForSelectionSettled(page);
      // Clear the resize grips before connecting: a rectangle's border grip shares its handle's position.
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      // Collapse publishes before the pane finishes changing. Measure handles only in its settled view.
      await waitForStableBox(page.getByTestId("canvas-wrap"));
      await waitForCameraIdle(page);
      await fitDiagram(page);
      await waitForCameraIdle(page);
      await waitForStableBox(annotation(page, source));
      await waitForStableBox(page.getByTestId(`handle-${source}-right`));
      const from = await box(page.getByTestId(`handle-${source}-right`));
      const to = await box(page.getByTestId("handle-target-left"));
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      // Read the path in screen coordinates, the same coordinate space as the rendered handles.
      const endpoints = (locator: Locator) =>
        locator.evaluate((root) => {
          const path = root.children[0];
          if (!(path instanceof SVGPathElement)) throw new Error("Missing connection path");
          const matrix = path.getScreenCTM();
          if (!matrix) throw new Error("Missing path transform");
          const start = path.getPointAtLength(0).matrixTransform(matrix);
          const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
          return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
        });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      const preview = page.getByTestId("connection-line");
      await expect(preview).toBeVisible();
      await expect
        .poll(async () => {
          const point = (await endpoints(preview)).start;
          return Math.hypot(point.x - start.x, point.y - start.y);
        })
        .toBeLessThan(1);
      await page.mouse.up();
      await expect.poll(async () => (await savedDiagram(page)).edges).toMatchObject([{ from: source, to: "target" }]);
      const saved = await savedDiagram(page);
      const edge = saved.edges[0];
      // A dot fixes its own side; verify the stored choice, resolved sides and exact endpoints.
      expect(edge.sourceSide).toBe("right");
      expect(edge.targetSide).toBe("left");
      const sourceBox = saved.annotations?.find((a) => a.id === source);
      const targetBox = saved.annotations?.find((a) => a.id === "target");
      if (!sourceBox || !targetBox) throw new Error("Missing saved connection endpoint");
      expect(pickSides(sourceBox, targetBox, edge)).toEqual({ sourceSide: "right", targetSide: "left" });
      // Selecting the edge can pan the canvas: remeasure both handles with the path each poll.
      await expect
        .poll(async () => {
          const path = await endpoints(page.getByTestId(`edge-${edge.id}`));
          const a = await box(page.getByTestId(`handle-${source}-right`));
          const b = await box(page.getByTestId("handle-target-left"));
          return Math.max(
            Math.hypot(path.start.x - a.x - a.width / 2, path.start.y - a.y - a.height / 2),
            Math.hypot(path.end.x - b.x - b.width / 2, path.end.y - b.y - b.height / 2),
          );
        })
        .toBeLessThan(1);
    });

  for (const shape of ["hourglass", "comment", "brace-r"] as const)
    test(`${shape} opposite handles independently start connections`, async ({ page }) => {
      const held = Promise.withResolvers<undefined>();
      await page.route(
        /\/(?:assets\/attachmentGeometry-[^/]+\.js|src\/canvas\/shapes\/attachmentGeometry\.ts)(?:\?|$)/,
        async (route) => {
          await held.promise;
          await route.continue();
        },
      );
      try {
        await seed(page, {
          format: "diagrams/v1",
          title: "Distinct ports",
          nodes: [],
          edges: [],
          annotations: [{ id: "shape", kind: "shape", shape, text: "", x: 0, y: 0, width: 160, height: 90 }],
        });
        await gotoCanvas(page, SLUG);
        await annotation(page, "shape").click();
        await waitForSelectionSettled(page);
        for (const side of ["left", "right"] as const) {
          await waitForCameraIdle(page);
          const handle = page.getByTestId(`handle-shape-${side}`);
          await expect(handle).toBeVisible();
          // Selection and camera readiness do not mean the lazy attachment
          // geometry has arrived. Keep the exact hit assertion, waiting for the
          // real ports to replace their rectangular placeholders. Holding that
          // download until the first probe makes the old immediate read fail.
          await expect
            .poll(async () => {
              const hit = await handle.evaluate((element) => {
                const r = element.getBoundingClientRect();
                return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute("data-testid");
              });
              held.resolve(undefined);
              return hit;
            })
            .toBe(`handle-shape-${side}`);
          const r = await box(handle);
          await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
          await page.mouse.down();
          await page.mouse.move(r.x + (side === "right" ? 70 : -70), r.y, { steps: 4 });
          await expect(page.getByTestId("connection-line")).toBeVisible();
          await page.mouse.up();
          await page.keyboard.press("Escape");
          await expect(page.getByTestId("context-menu")).toHaveCount(0);
        }
      } finally {
        held.resolve(undefined);
      }
    });

  test("bulk selection adds no per-annotation Shift listeners", async ({ page }) => {
    await seed(page, annotationShapesFixture());
    await gotoCanvas(page, SLUG);
    await annotation(page, "outline-rect").click();
    await waitForSelectionSettled(page);
    await page.evaluate(() => {
      const w = window as Window & { __modifierListeners?: number };
      w.__modifierListeners = 0;
      const original = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if ((this === window || this === document) && (type === "keydown" || type === "keyup"))
          w.__modifierListeners = (w.__modifierListeners ?? 0) + 1;
        return original.call(this, type, listener, options);
      };
    });
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByTestId(/^annotation-resize-.*-bottom-right$/)).toHaveCount(58);
    expect(
      await page.evaluate(() => (window as Window & { __modifierListeners?: number }).__modifierListeners),
    ).toBeLessThanOrEqual(4);
  });

  test("connected preview follows the destination and matches shape creation", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Destination",
      nodes: [],
      edges: [],
      annotations: [{ id: "source", kind: "shape", shape: "tri", text: "Source", x: 0, y: 0, width: 400, height: 240 }],
    });
    await gotoCanvas(page, SLUG);
    await annotation(page, "source").click();
    await waitForSelectionSettled(page);
    await page.keyboard.press("Alt+ArrowRight");
    const outline = page.getByTestId("landing-outline");
    await expect(outline).toHaveCSS("width", "220px");
    const menu = page.getByTestId("quick-add");
    await waitForStableViewport(page);
    await waitForStableBox(menu);
    const menuBefore = await box(menu);
    await page.getByTestId("context-menu-item-quick-add:shapes").hover();
    await page.getByTestId("context-menu-item-quick-add-shape:cat:basic").hover();
    await expect(page.getByTestId("context-menu-item-quick-add-shape:hexagon")).toBeVisible();
    await expect(outline).toHaveCSS("width", "160px");
    expect((await box(menu)).x).toBeCloseTo(menuBefore.x, 1);
    const search = page.getByTestId("quick-add-search");
    await search.focus();
    await page.keyboard.type("hexagon");
    await expect(outline).toHaveCSS("width", "160px");
    const preview = await outline.evaluate((el) => ({
      transform: el.style.transform,
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    }));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await savedDiagram(page)).annotations?.find((a) => a.id !== "source"))
      .toMatchObject({ width: preview.width, height: preview.height });
    const added = (await savedDiagram(page)).annotations?.find((a) => a.id !== "source");
    if (!added) throw new Error("Missing new shape");
    expect(preview.transform).toBe(`translate(${added.x}px, ${added.y}px)`);
  });
  for (const shape of ["tri", "flip-tri"] as const)
    test(`${shape} labels remain visible after wide, short resizing`, async ({ page }) => {
      await seed(page, {
        format: "diagrams/v1",
        title: "Visible labels",
        nodes: [],
        edges: [],
        annotations: [{ id: "shape", kind: "shape", shape, text: "Invoice", x: 0, y: 0, width: 160, height: 90 }],
      });
      await gotoCanvas(page, SLUG);
      await annotation(page, "shape").click();
      await waitForSelectionSettled(page);
      await page.getByTestId("inspector-field-width").fill("400");
      await page.getByTestId("inspector-field-width").press("Enter");
      await waitForStableBox(annotation(page, "shape"));
      const bounds = await page.getByTestId("annotation-text-shape").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const shape = el.parentElement?.parentElement;
        if (!shape) throw new Error("Missing shape");
        const root = shape.getBoundingClientRect();
        return {
          left: (text.left - root.left) / root.width,
          right: (text.right - root.left) / root.width,
          top: (text.top - root.top) / root.height,
          bottom: (text.bottom - root.top) / root.height,
        };
      });
      expect(bounds.top).toBeGreaterThan(0);
      expect(bounds.bottom).toBeLessThan(1);
      const narrowest = shape === "tri" ? bounds.top : 1 - bounds.bottom;
      expect(bounds.left).toBeGreaterThan((1 - narrowest) / 2);
      expect(bounds.right).toBeLessThan((1 + narrowest) / 2);
    });

  test("window-pane dividers leave rendered label glyphs clear", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Window",
      nodes: [],
      edges: [],
      annotations: [
        { id: "shape", kind: "shape", shape: "win-pane", text: "Invoice", x: 0, y: 0, width: 160, height: 90 },
      ],
    });
    await gotoCanvas(page, SLUG);
    const clear = await annotation(page, "shape").evaluate((root) => {
      const text = root.querySelector('[data-testid="annotation-text-shape"]');
      if (!text) throw new Error("Missing label");
      const range = document.createRange();
      range.selectNodeContents(text);
      const r = range.getBoundingClientRect();
      const svg = root.querySelector('[data-testid="shape-outline"]');
      if (!svg) throw new Error("Missing outline");
      return Array.from(svg.children)
        .slice(1)
        .every((line) => {
          const b = line.getBoundingClientRect();
          return b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom;
        });
    });
    expect(clear).toBe(true);
  });

  test("Shift-resizing a new ellipse produces a circle and releasing Shift allows a rectangle", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Square",
      nodes: [],
      edges: [],
      annotations: [
        { id: "shape", kind: "shape", shape: "ellipse", text: "Circle", x: 0, y: 0, width: 160, height: 90 },
      ],
    });
    await gotoCanvas(page, SLUG);
    await annotation(page, "shape").click();
    await waitForSelectionSettled(page);
    const handle = page.getByTestId("annotation-resize-shape-bottom-right");
    const drag = async (dx: number, dy: number) => {
      const r = await box(handle);
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.down();
      await page.mouse.move(r.x + dx, r.y + dy, { steps: 8 });
      await page.mouse.up();
    };
    await page.keyboard.down("Shift");
    await drag(80, 30);
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => {
        const a = (await savedDiagram(page)).annotations?.[0];
        if (!a) throw new Error("Missing shape");
        return a.width - a.height;
      })
      .toBe(0);
    await waitForStableBox(handle);
    await drag(80, 0);
    await expect
      .poll(async () => {
        const a = (await savedDiagram(page)).annotations?.[0];
        if (!a) throw new Error("Missing shape");
        return a.width > a.height;
      })
      .toBe(true);
  });

  test("releasing Shift during a top-right resize restores the opposite corner", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Anchored resize",
      nodes: [],
      edges: [],
      annotations: [{ id: "shape", kind: "shape", text: "", x: 100, y: 200, width: 160, height: 90 }],
    });
    await gotoCanvas(page, SLUG);
    await annotation(page, "shape").click();
    await waitForSelectionSettled(page);
    const handle = page.getByTestId("annotation-resize-shape-top-right");
    await waitForStableBox(handle);
    const r = await box(handle);
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(x + 60, y, { steps: 8 });
    await expect
      .poll(async () => {
        const b = await box(annotation(page, "shape"));
        return Math.abs(b.width - b.height);
      })
      .toBeLessThan(1);
    await page.keyboard.up("Shift");
    await page.mouse.move(x + 100, y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await savedDiagram(page)).annotations?.[0])
      .toMatchObject({ x: 100, y: 200, height: 90 });
    expect((await savedDiagram(page)).annotations?.[0].width).toBeGreaterThan(160);
  });

  for (const finish of ["Escape", "ControlOrMeta+Enter"])
    test(`placement buffers annotation newlines and saves with ${finish}`, async ({ page }) => {
      await seed(page, {
        format: "diagrams/v1",
        title: "Typing",
        nodes: [{ id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 }],
        edges: [],
      });
      await gotoCanvas(page, SLUG);
      await page.getByTestId("node-web").click();
      await waitForSelectionSettled(page);
      await page.keyboard.press("Alt+ArrowRight");
      const search = page.getByTestId("quick-add-search");
      await expect(search).toBeFocused();
      await page.keyboard.type("hexagon");
      await page.clock.install();
      await pauseClock(page);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
      await page.keyboard.type("alpha");
      await page.keyboard.press("Enter");
      await page.keyboard.type("beta");
      await page.keyboard.press(finish);
      await page.clock.resume();
      await expect(page.getByTestId("annotation-text-shape-1")).toHaveText("alpha\nbeta");
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
      await expect
        .poll(() => annotation(page, "shape-1").evaluate((el) => document.activeElement === el.parentElement))
        .toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("annotation-editor")).toBeFocused();
      await page.keyboard.press("Escape");
    });

  test("solid shape labels meet WCAG AA across the preset colours in light and dark", async ({ page }) => {
    await seed(page, annotationShapesFixture());
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("shape-outline")).toHaveCount(58);
    for (const theme of ["light", "dark"]) {
      await expectTheme(page, theme);
      await expect
        .poll(async () => {
          const contrasts = await page.getByTestId(/^annotation-solid-/).evaluateAll((els) => {
            const ctx = document.createElement("canvas").getContext("2d");
            if (!ctx) throw new Error("Missing colour context");
            const luminance = (color: string) => {
              ctx.fillStyle = color;
              ctx.fillRect(0, 0, 1, 1);
              return Array.from(ctx.getImageData(0, 0, 1, 1).data)
                .slice(0, 3)
                .map((v) => {
                  const c = v / 255;
                  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
            };
            return els.map((el) => {
              const ink = luminance(getComputedStyle(el).color);
              const outline = el.firstElementChild?.firstElementChild;
              if (!outline) throw new Error("Missing shape outline");
              const fill = luminance(getComputedStyle(outline).fill);
              return {
                id: el.getAttribute("data-testid"),
                ratio: (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05),
              };
            });
          });
          expect(contrasts).toHaveLength(14);
          return contrasts.filter((c) => c.ratio < 4.5);
        })
        .toEqual([]);
      if (theme === "light") await toggleTheme(page);
    }
  });
  for (const control of ["top-left", "line-left"] as const) {
    test(`${control} resize stops at the persistence limit and a connected shape reopens`, async ({
      page,
      consoleErrors,
    }) => {
      await seed(page, {
        format: "diagrams/v1",
        title: "Resize budget",
        nodes: [{ id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 }],
        annotations: [{ id: "shape", kind: "shape", text: "Shape", x: 400, y: 0, width: 160, height: 90 }],
        edges: [{ id: "edge", from: "web", to: "shape" }],
      });
      await gotoCanvas(page, SLUG);
      await annotation(page, "shape").click();
      await waitForSelectionSettled(page);
      await page.getByTestId("inspector-field-width").fill("19990");
      await page.getByTestId("inspector-field-width").press("Enter");
      if (control === "top-left") {
        await page.getByTestId("inspector-field-height").fill("19990");
        await page.getByTestId("inspector-field-height").press("Enter");
      }
      let previous = "";
      await expect
        .poll(
          async () => {
            const current = JSON.stringify(await annotation(page, "shape").boundingBox());
            const stable = current === previous;
            previous = current;
            return stable;
          },
          { intervals: [100, 150, 250] },
        )
        .toBe(true);
      const testId = control === "line-left" ? "annotation-resize-line-shape-left" : "annotation-resize-shape-top-left";
      const handle = await box(page.getByTestId(testId));
      const startY = handle.y + handle.height * (control === "line-left" ? 0.25 : 0.5);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"), {
        x: handle.x + handle.width / 2,
        y: startY,
      });
      expect(hit).toBe(testId);
      await page.mouse.move(handle.x + handle.width / 2, startY);
      await page.mouse.down();
      await page.mouse.move(handle.x - 100, control === "line-left" ? startY : handle.y - 100, { steps: 8 });
      await page.mouse.up();
      const width = () => annotation(page, "shape").evaluate((el) => el.parentElement?.style.width);
      await expect.poll(width).toBe("20000px");
      if (control === "top-left")
        await expect
          .poll(() => annotation(page, "shape").evaluate((el) => el.parentElement?.style.height))
          .toBe("20000px");
      await expect
        .poll(async () => (await savedDiagram(page)).annotations?.find((a) => a.id === "shape")?.width)
        .toBe(20000);
      await page.reload();
      await expect(annotation(page, "shape")).toBeAttached();
      await expect.poll(width).toBe("20000px");
      await expect(page.getByTestId("edge-edge")).toBeAttached();
      expectNoErrors(consoleErrors);
    });
  }
  test("live caption text meets AA contrast in both themes after compositing", async ({ page }) => {
    const colors = ["neutral", "yellow", "green", "blue", "purple", "red"];
    await seed(page, {
      ...kafka,
      annotations: colors.map((color, i) => ({
        id: `caption-${color}`,
        kind: "text",
        text: color,
        color,
        x: 100 + i * 150,
        y: 80,
        width: 140,
        height: 30,
      })),
    });
    await gotoCanvas(page, SLUG);
    await page.getByTestId("live-toggle").click();
    await waitForLiveSession(page);
    await waitForCameraIdle(page);
    for (const theme of ["light", "dark"]) {
      await expectTheme(page, theme);
      // Measured once the live view and theme transitions (opacity, colours) have settled.
      const measure = () =>
        page.getByTestId("canvas-wrap").evaluate((wrap) => {
          const ctx = document.createElement("canvas").getContext("2d");
          if (!ctx) throw new Error("Missing color context");
          const rgb = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
          };
          const luminance = (channels: number[]) =>
            channels
              .map((v) => {
                const c = v / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              })
              .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
          const bg = rgb(getComputedStyle(wrap).getPropertyValue("--bg"));
          return [...wrap.querySelectorAll('[data-testid^="annotation-text-caption-"]')].map((el) => {
            let opacity = 1;
            for (let parent: Element | null = el; parent; parent = parent.parentElement)
              opacity *= Number(getComputedStyle(parent).opacity);
            const ink = rgb(getComputedStyle(el).color).map((c, i) => c * opacity + bg[i] * (1 - opacity));
            const a = luminance(ink),
              b = luminance(bg);
            return { id: el.getAttribute("data-testid"), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          });
        });
      await expect
        .poll(async () => {
          const contrasts = await measure();
          if (contrasts.length !== colors.length) return [`${contrasts.length} of ${colors.length} captions`];
          return contrasts.filter((c) => c.ratio < 4.5).map((c) => `${theme}: ${c.id} at ${c.ratio.toFixed(2)}:1`);
        })
        .toEqual([]);
      if (theme === "light") await toggleTheme(page);
    }
  });
  test("keyboard commits restore canvas focus for F2, movement and Delete; blur keeps the next control focused", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "Keyboard note");
    const focused = () => annotation(page, "note-1").evaluate((el) => el.parentElement === document.activeElement);
    await expect.poll(focused).toBe(true);
    await waitForSelectionSettled(page);
    const before = await box(annotation(page, "note-1"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await box(annotation(page, "note-1"))).x).toBeGreaterThan(before.x);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect.poll(focused).toBe(true);
    await page.keyboard.press("F2");
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.getByTestId("inspector-field-text-rendered").click();
    await expect(page.getByTestId("inspector-field-text")).toBeFocused();
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await annotation(page, "note-1").click();
    await page.keyboard.press("F2");
    await page.keyboard.press("Escape");
    await expect.poll(focused).toBe(true);
    await page.keyboard.press("Delete");
    await expect(annotation(page, "note-1")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("inline auto-growth and inspector text stay within persistence limits on reload", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-note").click();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.insertText("x\n".repeat(1300));
    await page.keyboard.press("Escape");
    const size = () =>
      annotation(page, "note-1").evaluate((el) => ({
        width: el.parentElement?.style.width,
        height: el.parentElement?.style.height,
      }));
    await expect.poll(async () => (await size()).height).toBe("20000px");
    const field = page.getByTestId("inspector-field-text");
    await field.fill("x".repeat(10050));
    await expect.poll(async () => (await field.inputValue()).length).toBe(10000);
    await expect
      .poll(async () => (await savedDiagram(page)).annotations?.find((a) => a.id === "note-1")?.text.length)
      .toBe(10000);
    await page.reload();
    await expect(annotation(page, "note-1")).toBeVisible();
    await expect.poll(async () => (await size()).height).toBe("20000px");
    await expect.poll(async () => (await page.getByTestId("annotation-text-note-1").textContent())?.length).toBe(10000);
    expectNoErrors(consoleErrors);
  });

  test("Send to back restores visible stacking through Undo, Redo and reload", async ({ page, consoleErrors }) => {
    await gotoLab(page, "overlapping-layers");
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    // The same Lab fixture runs on the editor's real persistence/history path.
    const top = () =>
      page.getByTestId("node-service").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit
          ?.closest('[data-testid="annotation-note"], [data-testid="node-service"]')
          ?.getAttribute("data-testid");
      });
    const clear = async () => {
      await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page) });
      await expect
        .poll(() => annotation(page, "note").evaluate((el) => el.classList.contains("is-selected")))
        .toBe(false);
    };
    await expect.poll(top).toBe("annotation-note");
    await settle(page, "service");
    await annotation(page, "note").click({ button: "right" });
    await menuItem(page, "annotation.back").click();
    await clear();
    await expect.poll(top).toBe("node-service");
    await page.keyboard.press(`${MOD}+z`);
    await clear();
    await expect.poll(top).toBe("annotation-note");
    await page.keyboard.press(`${MOD}+Shift+z`);
    await clear();
    await expect.poll(top).toBe("node-service");
    await expect.poll(async () => (await savedDiagram(page)).layerOrder?.at(-1)).toBe("service");
    await page.reload();
    await expect(page.getByTestId("node-service")).toBeVisible();
    await expect.poll(top).toBe("node-service");
    expectNoErrors(consoleErrors);
  });
  test("adds text, a note, a zone and each shape from the canvas menu", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);

    // One spot for all: each annotation is checked, then deleted, so the next right-click lands on the pane.
    for (const [kind, text] of [
      ["text", "A caption"],
      ["note", "A note"],
      ["zone", "A zone"],
    ] as const) {
      await openCanvasMenu(page);
      await menuItem(page, "canvas.annotate").click();
      await menuItem(page, `annotate:${kind}`).click();
      await typeAndCommit(page, text);
      await expect(annotation(page, `${kind}-1`)).toHaveAttribute("data-kind", kind);
      const shown = page.getByTestId(kind === "zone" ? "annotation-label-zone-1" : `annotation-text-${kind}-1`);
      await expect(shown).toHaveText(text);
      await shown.click();
      await expect(page.getByTestId("inspector-title")).toHaveText(kind[0].toUpperCase() + kind.slice(1));
      await page.keyboard.press("Delete");
      await expect(annotation(page, `${kind}-1`)).toHaveCount(0);
      // With nothing selected the inspector folds and the view refits: wait, or the refit closes the next menu.
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await settle(page);
    }

    for (const shape of ["rect", "rounded", "ellipse", "diamond", "cylinder"] as const) {
      await openCanvasMenu(page);
      await menuItem(page, "canvas.annotate").click();
      await menuItem(page, "annotate:shape").click();
      await menuItem(page, `annotate:shape:${shape}`).click();
      await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", shape);
      // Selected, no editor; the inspector shows the shape.
      await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
      await expect(page.getByTestId("inspector-title")).toHaveText("Shape");
      await expect(page.getByTestId(`inspector-shape-${shape}`)).toHaveAttribute("aria-checked", "true");
      await annotation(page, "shape-1").click();
      await page.keyboard.press("Delete");
      await expect(annotation(page, "shape-1")).toHaveCount(0);
      // With nothing selected the inspector folds and the view refits: wait, or the refit closes the next menu.
      await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
      await settle(page);
    }
    expectNoErrors(consoleErrors);
  });

  test("adds from the stencil rail's Annotate group and edits in the inspector", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await openAnnotate(page);
    await expect(page.getByTestId("palette-annotate")).toBeAttached();
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "From the rail");
    await expect(page.getByTestId("annotation-text-note-1")).toHaveText("From the rail");
    await expect(page.getByTestId("inspector-title")).toHaveText("Note");
    await page.getByTestId("inspector-color-green").click();
    await expect(annotation(page, "note-1")).toHaveAttribute("data-color", "green");
    await page.getByTestId("inspector-field-text-size-l").click();
    const before = (await box(annotation(page, "note-1"))).width;
    await page.getByTestId("inspector-field-width").fill("320");
    await page.getByTestId("inspector-field-width").press("Enter");
    // 200 -> 320 at whatever zoom the view has.
    await expect.poll(async () => (await box(annotation(page, "note-1"))).width / before).toBeGreaterThan(1.5);

    // One Shape tile: a rectangle, whose outline the inspector changes.
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-shape").click();
    await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", "rect");
    await page.getByTestId("inspector-shape-diamond").click();
    await expect(annotation(page, "shape-1")).toHaveAttribute("data-shape", "diamond");
    // The search finds the Annotate items too, each outline by name.
    await openLibrary(page);
    await page.getByTestId("palette-search").fill("sticky");
    await openAnnotate(page);
    await expect(page.getByTestId("palette-annotate-note")).toBeVisible();
    await openLibrary(page);
    await page.getByTestId("palette-search").fill("ellipse");
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-shape-ellipse").click();
    await expect(annotation(page, "shape-2")).toHaveAttribute("data-shape", "ellipse");
    expectNoErrors(consoleErrors);
  });

  test("a click in the rail places each annotation in free space, never on a node or the last one", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await settle(page);
    for (const kind of ["note", "shape", "note", "text"] as const) {
      await openAnnotate(page);
      await page.getByTestId(`palette-annotate-${kind}`).click();
      if (kind !== "shape") await page.keyboard.press("Escape");
    }
    await expect(annotation(page, "text-1")).toBeVisible();
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          annotation: el.classList.contains("react-flow__node-annotation"),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      }),
    );
    const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const added = boxes.filter((b) => b.annotation);
    expect(added).toHaveLength(4);
    for (const a of added) for (const b of boxes) if (a !== b) expect(overlap(a, b)).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("T adds text at the pointer; double-click edits it, multi-line", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await waitForCameraIdle(page);
    const wrap = await box(page.getByTestId("canvas-wrap"));
    // Left of centre, but clear of the diagram card (top left, 380 px wide) at any canvas width.
    const spot = await emptySpot(page, -150);
    await page.mouse.move(wrap.x + spot.x, wrap.y + spot.y);
    await page.keyboard.press("t");
    await typeAndCommit(page, "Order flow");
    const text = annotation(page, "text-1");
    await expect(page.getByTestId("annotation-text-text-1")).toHaveText("Order flow");
    await waitForCameraIdle(page);
    // It starts where the pointer was.
    const b = await box(text);
    expect(Math.abs(b.x - (wrap.x + spot.x))).toBeLessThan(40);
    expect(Math.abs(b.y + b.height / 2 - (wrap.y + spot.y))).toBeLessThan(30);

    // Double-click: edit in place, Enter adds a line, clicking away commits; the box grows to fit.
    const before = b.height;
    await text.dblclick();
    await expect(page.getByTestId("annotation-editor")).toBeFocused();
    await page.keyboard.press(TEXT_END);
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page, 200) });
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("annotation-text-text-1")).toHaveText("Order flow\nsecond line");
    await expect.poll(async () => (await box(text)).height).toBeGreaterThan(before + 5);
    expectNoErrors(consoleErrors);
  });

  test("resize, undo / redo, copy / paste and delete", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await openAnnotate(page);
    await page.getByTestId("palette-annotate-note").click();
    await typeAndCommit(page, "Resize me");
    // Let the new note settle into its own undo step (history commits after a quiet moment).
    await waitForHistoryIdle(page);
    const note = annotation(page, "note-1");
    await note.click();
    const b0 = await box(note);
    const handle = page.getByTestId("annotation-resize-note-1-bottom-right");
    await expect(handle).toBeVisible();
    const h = await box(handle);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 80, h.y + 50, { steps: 8 });
    await page.mouse.up();
    const b1 = await box(note);
    expect(b1.width).toBeGreaterThan(b0.width + 40);
    expect(b1.height).toBeGreaterThan(b0.height + 20);
    await waitForHistoryIdle(page);

    // Undo the resize, then redo it.
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => Math.round((await box(note)).width)).toBe(Math.round(b0.width));
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(async () => Math.round((await box(note)).width)).toBe(Math.round(b1.width));

    // Copy / paste makes a second note with a fresh id and the same text.
    await note.click();
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId("annotation-text-note-2")).toHaveText("Resize me");
    await waitForHistoryIdle(page);
    // Delete it, undo brings it back.
    await page.keyboard.press("Delete");
    await expect(annotation(page, "note-2")).toHaveCount(0);
    await waitForHistoryIdle(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(annotation(page, "note-2")).toBeVisible();
    // Undo the whole note away.
    for (let i = 0; i < 6 && (await annotation(page, "note-1").count()); i++) await page.keyboard.press(`${MOD}+z`);
    await expect(annotation(page, "note-1")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("align works across nodes and annotations", async ({ page }) => {
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await annotation(page, "note-retry").click();
    await annotation(page, "note-replay").click({ modifiers: [MOD] });
    await expect(page.getByTestId("inspector-title")).toHaveText("2 selected");
    await waitForSelectionSettled(page);
    await page.getByTestId("inspector-align-top").click();
    await expect
      .poll(async () => Math.round((await box(annotation(page, "note-retry"))).y))
      .toBe(Math.round((await box(annotation(page, "note-replay"))).y));
  });

  test("export JSON and import it back keeps every annotation", async ({ page, consoleErrors }, info) => {
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "note-retry")).toBeVisible();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      expect(page.getByTestId("toast")).toContainText("Exported"),
      page.getByTestId("export-json").click(),
    ]);
    const file = info.outputPath("annotated.diagram.json");
    await download.saveAs(file);
    // Observe the lazy notification with the click, before saving the download can outlast it.
    // Export is complete before importing, so its toast cannot replace the import notification.
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.annotations.map((a: { id: string }) => a.id).sort()).toEqual(
      annotatedKafka.annotations.map((a: { id: string }) => a.id).sort(),
    );

    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    for (const a of annotatedKafka.annotations) await expect(annotation(page, a.id)).toBeVisible();
    await expect(page.getByTestId("annotation-text-note-retry")).toHaveText("Gateway retries 3x,\nthen 503.");
    await expect(page.getByTestId("edge-to-legacy")).toBeAttached();
    expectNoErrors(consoleErrors);
  });

  test("the overlap audit stays clean: labels may cross zones, never notes or shapes", async ({ page }) => {
    await gotoLab(page, "overlap-audit", { diagram: "annotations" });
    await expect(page.getByTestId("audit-summary")).toHaveAttribute("data-total", "0");

    // On the real canvas: no edge label covers a note or a shape (zones and text may sit under one).
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "legacy")).toBeVisible();
    await waitForCameraIdle(page);
    const problems = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const solid = [...document.querySelectorAll('[data-testid^="annotation-"][data-obstacle="1"]')];
      const labels = [...document.querySelectorAll('[data-testid^="edge-label-"]')];
      const out: string[] = [];
      for (const l of labels)
        for (const s of solid) {
          const a = rect(l),
            b = rect(s);
          if (a.x + 0.5 < b.right && b.x + 0.5 < a.right && a.y + 0.5 < b.bottom && b.y + 0.5 < a.bottom)
            out.push(`${l.getAttribute("data-testid")} on ${s.getAttribute("data-testid")}`);
        }
      return { out, solid: solid.length };
    });
    expect(problems.solid).toBe(3);
    expect(problems.out).toEqual([]);
  });

  test("live view keeps annotation text opaque and sends no traffic to or from them", async ({ page }) => {
    await page.clock.install();
    const diagram = {
      format: "diagrams/v1",
      title: "Only a shape downstream",
      nodes: [{ id: "web", stencil: "client.browser", label: "Storefront", x: 40, y: 200 }],
      edges: [{ id: "to-shape", from: "web", to: "box", kind: "async" }],
      annotations: [
        { id: "box", kind: "shape", shape: "rect", text: "Somewhere", x: 400, y: 190, width: 160, height: 90 },
        { id: "memo", kind: "note", text: "Not simulated", x: 40, y: 360, width: 200, height: 90 },
      ],
    };
    await seed(page, diagram);
    await gotoCanvas(page, SLUG);
    await expect(annotation(page, "box")).toBeVisible();
    const opacity = () =>
      annotation(page, "memo").evaluate((el) => Number(getComputedStyle(el.parentElement ?? el).opacity));
    expect(await opacity()).toBe(1);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(opacity).toBe(1);
    // Presenting, they're part of the story: full strength. Esc steps back out of presentation only.
    await page.getByTestId("present-toggle").click();
    await expect.poll(opacity).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(opacity).toBe(1);
    await expect(annotation(page, "box")).toBeVisible();
    await waitForLiveSession(page);
    await pauseClock(page);
    // Traffic leaves the storefront, but its only edge ends on a shape: nothing is ever drawn.
    for (let i = 0; i < 8; i++) {
      await page.clock.runFor(250);
      expect(Number((await page.getByTestId("live-canvas").getAttribute("data-particles")) ?? 0)).toBe(0);
    }
    expect(Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time"))).toBeGreaterThan(0);
    // T adds nothing while live.
    await page.keyboard.press("t");
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
  });

  test("live control: the same diagram with a real node downstream does draw particles", async ({ page }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Control",
      nodes: [
        { id: "web", stencil: "client.browser", label: "Storefront", x: 40, y: 200 },
        { id: "api", stencil: "service.go", label: "Checkout", x: 400, y: 200 },
      ],
      edges: [{ id: "real", from: "web", to: "api", kind: "async" }],
    });
    await gotoCanvas(page, SLUG);
    await page.getByTestId("live-toggle").click();
    await expect
      .poll(async () => Number((await page.getByTestId("live-canvas").getAttribute("data-particles")) ?? 0), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test("renders markdown and supports formatting shortcuts in diagram description, text, and note annotations", async ({
    page,
    consoleErrors,
  }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Markdown Architecture",
      description: "Handles **orders** via `gRPC` — see [Runbook](https://example.com/runbook).",
      nodes: [{ id: "api", stencil: "service.go", label: "Orders API", x: 80, y: 220 }],
      edges: [],
      annotations: [
        {
          id: "caption-1",
          kind: "text",
          text: "### Tier 1\nSupports *async* `events`",
          x: 80,
          y: 120,
          width: 220,
          height: 60,
        },
        {
          id: "note-1",
          kind: "note",
          text: "## SLOs\n- [x] 99.95% uptime\n- [ ] Multi-region\n\n| Metric | Target |\n| :--- | ---: |\n| p99 | 45ms |",
          x: 360,
          y: 160,
          width: 260,
          height: 180,
        },
      ],
    });
    await gotoCanvas(page, SLUG);

    // 1. Diagram description renders rich markdown on the diagram card
    await openDiagramProperties(page);
    const desc = page.getByTestId("diagram-description");
    await expect(desc).toBeVisible();
    await expect(desc.locator("strong")).toHaveText("orders");
    await expect(desc.locator("code.md-inline-code")).toHaveText("gRPC");
    await expect(desc.locator("a.md-link")).toHaveAttribute("href", "https://example.com/runbook");

    // 2. Text annotation renders markdown on the canvas
    const textContent = page.getByTestId("annotation-text-caption-1");
    await expect(textContent.locator("h3.md-h3")).toHaveText("Tier 1");
    await expect(textContent.locator("em")).toHaveText("async");
    await expect(textContent.locator("code.md-inline-code")).toHaveText("events");

    // 3. Note annotation renders headings, task lists, and tables on the canvas
    const noteContent = page.getByTestId("annotation-text-note-1");
    await expect(noteContent.locator("h2.md-h2")).toHaveText("SLOs");
    await expect(noteContent.locator("input.md-task-checkbox")).toHaveCount(2);
    await expect(noteContent.locator("table.md-table th")).toHaveText(["Metric", "Target"]);
    await expect(noteContent.locator("table.md-table td")).toHaveText(["p99", "45ms"]);

    // 4. Inline annotation editor supports Markdown shortcuts (Ctrl/Cmd+B and smart list Enter)
    await annotation(page, "caption-1").dblclick();
    const inlineEditor = page.getByTestId("annotation-editor");
    await expect(inlineEditor).toBeFocused();
    // The editable shell is immediate; formatting attaches after its separate lazy module.
    await expect(inlineEditor).toHaveAttribute("data-markdown-ready", "");
    await inlineEditor.fill("critical");
    await inlineEditor.selectText();
    await page.keyboard.press(`${MOD}+b`);
    await expect(inlineEditor).toHaveValue("**critical**");
    await page.keyboard.press("Escape");
    await expect(textContent.locator("strong")).toHaveText("critical");

    // 5. Inspector MarkdownEditor shows Preview first when populated, switches to Edit on click, and supports Ctrl/Cmd+K
    await page.getByTestId("canvas-wrap").click({ position: await emptySpot(page) });
    await openDiagramProperties(page);
    await expect(page.getByTestId("inspector-field-description-rendered")).toBeVisible();
    const descField = page.getByTestId("inspector-field-description");
    await page.getByTestId("inspector-field-description-rendered").click();
    await expect(page.getByTestId("inspector-field-description-rendered")).toHaveCount(0);
    await descField.fill("https://example.com/docs");
    await descField.selectText();
    await page.keyboard.press(`${MOD}+k`);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(descField).toHaveValue("[title](https://example.com/docs)");
    await expect(desc.locator("a.md-link")).toHaveAttribute("href", "https://example.com/docs");
    await page.getByTestId("inspector-field-description-tab-preview").click();
    await expect(page.getByTestId("inspector-field-description-rendered").locator("a.md-link")).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );

    // 6. Node documentation starts in Edit mode when empty, renders Preview & top-right badge when populated, and previews in tooltip
    await expect(page.getByTestId("doc-badge-api")).toHaveCount(0);
    await page.getByTestId("node-api").click();
    const nodeDoc = page.getByTestId("inspector-field-node-description");
    await expect(nodeDoc).toBeVisible();
    await expect(page.getByTestId("inspector-field-node-description-rendered")).toHaveCount(0);
    await nodeDoc.click();
    await nodeDoc.fill("### Endpoints\n- `POST /orders`\n- **Idempotent**");
    await expect(page.getByTestId("doc-badge-api")).toBeVisible();
    await page.getByTestId("inspector-field-node-description-tab-preview").click();
    const nodeDocPreview = page.getByTestId("inspector-field-node-description-rendered");
    await expect(nodeDocPreview).toBeVisible();
    await expect(nodeDocPreview.locator("h3.md-h3")).toHaveText("Endpoints");
    await expect(nodeDocPreview.locator("code.md-inline-code")).toHaveText("POST /orders");
    await expect(nodeDocPreview.locator("strong")).toHaveText("Idempotent");

    // Hovering the documented node shows its rendered Markdown in the tooltip
    await page.getByTestId("node-api").hover();
    const tooltipDoc = page.getByTestId("node-tooltip-doc");
    await expect(tooltipDoc).toBeVisible();
    await expect(tooltipDoc.locator("h3.md-h3")).toHaveText("Endpoints");
    await expect(tooltipDoc.locator("code.md-inline-code")).toHaveText("POST /orders");

    // Clicking the documentation badge when the inspector is folded reopens the inspector on the node
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-collapsed", "1");
    await page.getByTestId("doc-badge-api").click();
    await expect(page.getByTestId("inspector-field-node-description-rendered")).toBeVisible();

    // In Live mode, documentation badges are hidden to keep simulation telemetry clean
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("canvas-view")).toHaveClass(/is-live/);
    await expect(page.getByTestId("doc-badge-api")).toBeHidden();
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("doc-badge-api")).toBeVisible();

    // In Present mode, documentation badges remain visible and hovering renders the markdown tooltip
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("canvas-view")).toHaveClass(/is-presenting/);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("doc-badge-api")).toBeVisible();
    await page.getByTestId("node-api").hover();
    await expect(page.getByTestId("node-tooltip-doc")).toBeVisible();
    await page.getByTestId("present-exit").click();
    await expect(page.getByTestId("canvas-view")).not.toHaveClass(/is-presenting/);

    expectNoErrors(consoleErrors);
  });
});

async function documentedNode(page: Page, source = "- alpha\n- beta") {
  await seed(page, {
    format: "diagrams/v1",
    title: "Documentation",
    nodes: [{ id: "api", stencil: "service.go", label: "API", x: 80, y: 220, description: source }],
    edges: [],
  });
  await gotoCanvas(page, SLUG);
}

test("documentation badge supports native keyboard activation", async ({ page }) => {
  await documentedNode(page);
  const badge = page.getByTestId("doc-badge-api");
  await expect(badge).toHaveAttribute("aria-label", "Open documentation");
  expect(await badge.evaluate((el) => el.tagName)).toBe("BUTTON");
  await badge.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-field-node-description-rendered")).toBeVisible();
});

test("Markdown previews scroll over rendered text", async ({ page }) => {
  await documentedNode(page, Array.from({ length: 80 }, (_, i) => "- Item " + i).join("\n"));
  await page.getByTestId("node-api").click();
  const preview = page.getByTestId("inspector-field-node-description-rendered");
  await expect(preview).toBeVisible();
  await preview.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("keyboard editing preserves navigation, selection and focus", async ({ page }) => {
  await documentedNode(page);
  await page.getByTestId("node-api").click();
  const preview = page.getByTestId("inspector-field-node-description-rendered");
  await page.getByTestId("inspector-field-node-description-tab-edit").click();
  const field = page.getByTestId("inspector-field-node-description");
  await field.fill("- alpha\n- beta");
  await field.selectText();
  await page.keyboard.press("ControlOrMeta+]");
  await expect(field).toHaveValue("  - alpha\n  - beta");
  await expect.poll(() => field.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(16);
  await page.keyboard.press("ControlOrMeta+[");
  await expect(field).toHaveValue("- alpha\n- beta");
  await page.keyboard.press("Shift+Tab");
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue("- alpha\n- beta");
  await field.focus();
  await page.keyboard.press("Tab");
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue("- alpha\n- beta");
  await field.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector-field-node-description-tab-preview")).toBeFocused();
  await expect(preview).toBeVisible();
});

for (const enter of ["Enter", "Shift+Enter"]) {
  test(`cold annotation editing takes caret movement and ${enter} immediately`, async ({ page, consoleErrors }) => {
    await seed(page, {
      format: "diagrams/v1",
      title: "Captions",
      nodes: [{ id: "api", stencil: "service.go", label: "API", x: 80, y: 80 }],
      annotations: [{ id: "caption", kind: "text", text: "Caption", x: 80, y: 220, width: 240, height: 80 }],
      edges: [],
    });
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    await annotation(page, "caption").dblclick();
    // No readiness wait: these keys belong to the editor from the instant it is opened.
    await page.keyboard.press(TEXT_END);
    await page.keyboard.press(enter);
    await page.keyboard.type("second line");
    await expect(page.getByTestId("annotation-editor")).toHaveValue("Caption\nsecond line");
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
    await expect(page.getByTestId("annotation-text-caption")).toHaveText("Caption\nsecond line");
    expectNoErrors(consoleErrors);
  });
}

test("annotation typing and selection survive a delayed formatting chunk", async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 2800, height: 1200 });
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let intercepted = false;
  await page.route(
    /\/(?:assets\/AnnotationFormatting-[\w-]+\.js|src\/canvas\/nodes\/AnnotationFormatting\.tsx)(?:\?.*)?$/,
    async (route) => {
      intercepted = true;
      await gate;
      await route.continue();
    },
  );
  try {
    await seed(page, annotatedKafka);
    await gotoCanvas(page, SLUG);
    await annotation(page, "title").dblclick();
    const editor = page.getByTestId("annotation-editor");
    await expect(editor).toBeFocused();
    await expect.poll(() => intercepted).toBe(true);
    const original = await editor.elementHandle();
    await page.keyboard.type("alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bravo");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("charlie");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("_");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    const text = "alpha\nbravo\nchar_lie";
    await expect(editor).toHaveValue(text);
    await expect(editor).not.toHaveAttribute("data-markdown-ready");
    await page.keyboard.press(`${MOD}+b`);
    await expect(editor).toHaveValue(text);
    const selection = await editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
    expect(selection).toEqual([text.length - 3, text.length]);

    release();
    await expect(editor).toHaveAttribute("data-markdown-ready", "");
    expect(await editor.evaluate((el, before) => el === before, original)).toBe(true);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(text);
    expect(await editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual(selection);
    await page.keyboard.press(`${MOD}+b`);
    await expect(editor).toHaveValue("alpha\nbravo\nchar_**lie**");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    expectNoErrors(consoleErrors);
  } finally {
    release();
  }
});

test("cold Markdown keeps annotation geometry and image exports await the rendered text", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let requested = false;
  await page.route(
    /\/(?:assets\/MarkdownView-[\w-]+\.js|src\/components\/markdown\/MarkdownView\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  await seed(page, {
    format: "diagrams/v1",
    title: "Runbook",
    description: "**Orders** via `gRPC`",
    nodes: [{ id: "api", stencil: "service.go", label: "API", x: 80, y: 220 }],
    annotations: [
      {
        id: "cold-note",
        kind: "note",
        text: "**Retry** <script>plain</script>",
        x: 340,
        y: 220,
        width: 240,
        height: 120,
      },
    ],
    edges: [],
  });
  await gotoCanvas(page, SLUG);
  await expect.poll(() => requested).toBe(true);
  const note = page.getByTestId("annotation-text-cold-note");
  await expect(note).toHaveText("**Retry** <script>plain</script>");
  expect(await note.evaluate((el) => el.getElementsByTagName("script").length)).toBe(0);
  await waitForStableViewport(page);
  const before = await box(annotation(page, "cold-note"));
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  const exporter = page.waitForResponse(/\/(?:assets\/image-[\w-]+\.js|src\/interop\/image\.ts)(?:\?.*)?$/);
  const downloaded = page.waitForEvent("download");
  let completed = false;
  page.on("download", () => (completed = true));
  await page.getByTestId("image-export").click();
  await (await exporter).finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  // Starting the export must leave its annotation fallback untouched until the held renderer arrives.
  await expect(page.getByTestId("image-dialog")).toHaveCount(0);
  await expect(page.getByTestId("export-header")).toBeVisible();
  expect(completed).toBe(false);
  await expect(note).toHaveText("**Retry** <script>plain</script>");
  release();
  const download = await downloaded;
  const path = await download.path();
  if (!path) throw new Error("SVG download did not complete");
  const svg = readFileSync(path, "utf8");
  expect(svg).toContain('data-testid="export-header-description"');
  expect(svg).toMatch(/<strong[^>]*>Orders<\/strong>/);
  expect(svg).not.toContain("**Orders**");
  expect(svg).toMatch(/<strong[^>]*>Retry<\/strong>/);
  expect(svg).not.toContain("data-markdown-pending");
  expect(await box(annotation(page, "cold-note"))).toEqual(before);
  await expect(page.getByTestId("export-header")).toHaveCount(0);
});

test("Markdown preview tab order reaches its region and links", async ({ page }) => {
  await documentedNode(page, "[Runbook](https://example.com/runbook)");
  await page.getByTestId("node-api").click();
  const preview = page.getByTestId("inspector-field-node-description-rendered");
  await page.getByTestId("inspector-field-node-description-tab-edit").focus();
  await page.keyboard.press("Tab");
  await expect(preview).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(preview.getByTestId("markdown-link")).toBeFocused();
  await expect(preview).toBeVisible();
});

test("Markdown editing leaves IME Escape and indentation to composition", async ({ page }) => {
  await documentedNode(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("inspector-field-node-description-tab-edit").click();
  const field = page.getByTestId("inspector-field-node-description");
  await expect(field).toBeFocused();
  await field.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "]", ctrlKey: true, isComposing: true, bubbles: true }));
  });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("- alpha\n- beta");
  await expect(page.getByTestId("inspector-field-node-description-rendered")).toHaveCount(0);
});

test("node documentation survives reload and stays cleared", async ({ page }) => {
  await documentedNode(page, "Imported runbook");
  const source = "# Endpoints\n\n**Orders** via `gRPC`";
  await page.getByTestId("node-api").click();
  await page.getByTestId("inspector-field-node-description-tab-edit").click();
  await page.getByTestId("inspector-field-node-description").fill(source);
  await expect.poll(async () => (await savedDiagram(page, SLUG))?.nodes[0].description).toBe(source);
  await page.reload();
  await page.getByTestId("node-api").click();
  await expect(page.getByTestId("inspector-field-node-description")).toHaveValue(source);
  await page.getByTestId("inspector-field-node-description-tab-edit").click();
  await page.getByTestId("inspector-field-node-description").fill("");
  await expect.poll(async () => (await savedDiagram(page, SLUG))?.nodes[0].description).toBeUndefined();
  await page.reload();
  await page.getByTestId("node-api").click();
  await expect(page.getByTestId("inspector-field-node-description")).toHaveValue("");
  await expect(page.getByTestId("doc-badge-api")).toHaveCount(0);
});

test("node documentation remains copyable at the length limit", async ({ page }) => {
  await documentedNode(page, "");
  await page.getByTestId("node-api").click();
  const field = page.getByTestId("inspector-field-node-description");
  const source = "a".repeat(49_996) + "TAIL";
  await field.fill(source + "overflow");
  await expect(field).toHaveValue(source);
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 1));
  await page.keyboard.press("ControlOrMeta+b");
  await expect(field).toHaveValue(source);
  expect(
    await field.evaluate(
      (el: HTMLTextAreaElement) =>
        new Promise((resolve) => requestAnimationFrame(() => resolve([el.selectionStart, el.selectionEnd]))),
    ),
  ).toEqual([0, 1]);
  await page.keyboard.press("Escape");
  await page.getByTestId("node-api").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect
    .poll(async () => (await savedDiagram(page, SLUG))?.nodes.map((n) => n.description))
    .toEqual([source, source]);
});

test("full annotations refuse formatting in both editors without losing text", async ({ page }) => {
  const source = "a".repeat(9_996) + "TAIL";
  await seed(page, {
    format: "diagrams/v1",
    nodes: [],
    edges: [],
    annotations: [{ id: "note", kind: "note", text: source, x: 0, y: 0, width: 240, height: 160 }],
  });
  await gotoCanvas(page, SLUG);
  await annotation(page, "note").dblclick();
  const inline = page.getByTestId("annotation-editor");
  await expect(inline).toBeFocused();
  await inline.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 1));
  await page.keyboard.press("ControlOrMeta+b");
  await expect(inline).toHaveValue(source);
  await page.keyboard.press("Escape");
  await annotation(page, "note").click();
  await page.getByTestId("inspector-field-text-tab-edit").click();
  const field = page.getByTestId("inspector-field-text");
  await expect(field).toBeFocused();
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 1));
  await page.keyboard.press("ControlOrMeta+b");
  await expect(field).toHaveValue(source);
});

test("canvas Tab visits annotation links before the next node", async ({ page }) => {
  await seed(page, {
    format: "diagrams/v1",
    nodes: [{ id: "after", stencil: "service.go", x: 500, y: 44 }],
    edges: [],
    annotations: [
      {
        id: "links",
        kind: "note",
        text: "[First](https://example.com/1) [Second](https://example.com/2)",
        x: 0,
        y: 0,
        width: 240,
        height: 160,
      },
    ],
  });
  await gotoCanvas(page, SLUG);
  await annotation(page, "links").click();
  await waitForSelectionSettled(page);
  const wrapper = annotation(page, "links");
  const links = wrapper.getByTestId("markdown-link");
  // Markdown enhances the plain note lazily: Tab can visit its links only after they arrive.
  await expect(links).toHaveCount(2);
  await expect(links.first()).toBeVisible();
  await wrapper.evaluate((el) => (el.parentElement as HTMLElement).focus());
  await page.keyboard.press("Tab");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await wrapper.evaluate((el) => document.activeElement === el.parentElement)).toBe(true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.getByTestId("node-after").evaluate((el) => document.activeElement === el.parentElement))
    .toBe(true);
});

test("documentation tooltips fit the viewport using their rendered height", async ({ page }) => {
  await documentedNode(page, "# Runbook\n" + "Detailed documentation\n\n".repeat(20));
  for (const presenting of [false, true]) {
    if (presenting) await page.getByTestId("present-toggle").click();
    await waitForCameraIdle(page);
    const node = page.getByTestId("node-api");
    const before = await box(node);
    await page.getByTestId("canvas-wrap").hover();
    await page.mouse.wheel(0, before.y - 150);
    await waitForStableViewport(page);
    await expect.poll(async () => (await box(node)).y).toBeLessThan(200);
    await node.hover();
    const tip = page.getByTestId("node-tooltip");
    await expect(page.getByTestId("node-tooltip-doc")).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await box(tip);
        const viewport = page.viewportSize();
        if (!viewport) throw new Error("Expected viewport dimensions");
        return (
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= viewport.width &&
          bounds.y + bounds.height <= viewport.height
        );
      })
      .toBe(true);
  }
});

test("Markdown export measures decoded header images", async ({ page, context }) => {
  const response = Promise.withResolvers<undefined>();
  await page.route("**/header-readiness.svg", async (route) => {
    await response.promise;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="orange"/></svg>',
    });
  });
  await page.addInitScript(() => {
    const nativeDecode = HTMLImageElement.prototype.decode;
    const release = Promise.withResolvers<undefined>();
    (window as unknown as { releaseHeaderDecode: () => void }).releaseHeaderDecode = () => release.resolve(undefined);
    HTMLImageElement.prototype.decode = function () {
      const decoded = nativeDecode.call(this);
      if (!this.closest('[data-testid="export-header"]')) return decoded;
      this.dataset.decodeWaiting = "1";
      return decoded.then(() => release.promise);
    };
  });
  await seed(page, {
    format: "diagrams/v1",
    title: "Runbook",
    description:
      "## Orders\n\nSeveral lines of **documentation** wrap above the diagram.\n\n![Readiness](/header-readiness.svg)\n\nLast line.",
    nodes: [{ id: "api", stencil: "service.go", label: "API", x: 80, y: 220 }],
    edges: [],
  });
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByTestId("image-export").click();
  const header = page.getByTestId("export-header");
  const image = header.getByTestId("markdown-image");
  await expect(image).toHaveAttribute("data-decode-waiting", "1");
  // Even after layout has had an opportunity to run, measurement awaits decode.
  await image.evaluate(() => new Promise(requestAnimationFrame));
  expect(await header.evaluate((el) => el.style.top)).toBe("");
  response.resolve(undefined);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(180);
  await image.evaluate(() => new Promise(requestAnimationFrame));
  expect(await header.evaluate((el) => el.style.top)).toBe("");
  await page.evaluate(() => (window as unknown as { releaseHeaderDecode: () => void }).releaseHeaderDecode());
  const download = await pendingDownload;
  const path = await download.path();
  if (!path) throw new Error("SVG download did not complete");
  const svg = readFileSync(path, "utf8");
  const exported = await context.newPage();
  try {
    await exported.setContent(svg);
    const exportedHeader = exported.getByTestId("export-header");
    const exportedNode = exported.getByTestId("node-api");
    const geometry = await exportedHeader.evaluate((el) => {
      const root = el.ownerDocument.documentElement;
      const svg = root.getElementsByTagName("svg")[0];
      const bounds = svg.getBoundingClientRect();
      const header = el.getBoundingClientRect();
      return {
        bounds: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom },
        header: { x: header.x, y: header.y, right: header.right, bottom: header.bottom },
      };
    });
    const node = await box(exportedNode);
    const { bounds, header: h } = geometry;
    expect(h.x).toBeGreaterThanOrEqual(bounds.x);
    expect(h.y).toBeGreaterThanOrEqual(bounds.y);
    expect(h.right).toBeLessThanOrEqual(bounds.right);
    expect(h.bottom).toBeLessThan(node.y);
    expect(node.x).toBeGreaterThanOrEqual(bounds.x);
    expect(node.x + node.width).toBeLessThanOrEqual(bounds.right);
    expect(node.y + node.height).toBeLessThanOrEqual(bounds.bottom);
    await expect(exportedHeader.getByTestId("markdown-image")).toBeVisible();
  } finally {
    await exported.close();
  }
});
