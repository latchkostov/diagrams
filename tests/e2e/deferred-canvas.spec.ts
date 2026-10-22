import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, savedDiagram, STORAGE_KEYS, waitForSelectionSettled } from "./fixtures";

const slug = "kafka-order-pipeline";
async function seed(page: Page, diagram: object) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEYS.autosavePrefix + slug,
    JSON.stringify({ format: "diagrams/v1", title: "Deferred canvas", nodes: [], edges: [], ...diagram }),
  ] as const);
}

/** Module evaluation has its own loading boundary; the assertions below exercise geometry readiness. */
function imageEvaluation(page: Page) {
  const response = page.waitForResponse((response) => /\/assets\/image-[^/]+\.js$/.test(response.url()));
  return async () => {
    const module = await response;
    expect(module.ok()).toBe(true);
    expect(await module.finished()).toBeNull();
    await page.evaluate(async (url) => {
      await import(url);
    }, module.url());
  };
}

for (const gesture of ["double-click", "F2"] as const)
  test(`boundary rename survives a delayed inspector download: ${gesture}`, async ({ page }) => {
    test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
    const held = Promise.withResolvers<undefined>();
    let requested = false;
    await page.route(/\/assets\/GroupPanel-[^/]+\.js$/, async (route) => {
      requested = true;
      await held.promise;
      await route.continue();
    });
    try {
      await seed(page, { groups: [{ id: "region", label: "Region", x: 0, y: 0, width: 500, height: 300 }] });
      await gotoCanvas(page, slug);
      const boundary = page.getByTestId("group-label-region");
      if (gesture === "double-click") await boundary.dblclick();
      else {
        await boundary.click();
        await waitForSelectionSettled(page);
        await page.keyboard.press("F2");
      }
      await expect.poll(() => requested).toBe(true);
      await waitForSelectionSettled(page);
      const label = page.getByTestId("inspector-field-label");
      await expect(label).toHaveCount(0);
      held.resolve(undefined);
      await expect(label).toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 6]);
      await page.keyboard.type("West region");
      await expect(boundary).toContainText("West region");
      await expect.poll(async () => (await savedDiagram(page)).groups?.[0].label).toBe("West region");
    } finally {
      held.resolve(undefined);
    }
  });

for (const outcome of ["ready", "failed"] as const)
  for (const kind of ["png", "svg"] as const)
    test(`${kind} export commits deferred connection geometry before capture: ${outcome}`, async ({
      page,
      context,
    }) => {
      test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
      const held = Promise.withResolvers<undefined>();
      let requested = false;
      await page.route(/\/assets\/extendedGeometry-[^/]+\.js$/, async (route) => {
        requested = true;
        await held.promise;
        if (outcome === "failed") await route.abort("failed");
        else await route.continue();
      });
      // Observe the SVG used to rasterize PNG, so both exports must contain the real outline.
      await page.addInitScript(() => {
        const frame = window.requestAnimationFrame.bind(window);
        const measurements: FrameRequestCallback[] = [];
        window.requestAnimationFrame = (callback) => {
          if (
            document.documentElement.dataset.holdMeasurements &&
            callback.toString().includes("updateNodeInternals")
          ) {
            measurements.push(callback);
            document.documentElement.dataset.measurementPending = "1";
            return frame(() => {});
          }
          return frame(callback);
        };
        window.addEventListener("release-measurements", () => {
          delete document.documentElement.dataset.holdMeasurements;
          for (const callback of measurements.splice(0)) frame(callback);
        });
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          if (this.src.startsWith("data:image/svg+xml"))
            document.documentElement.dataset.exportSvg = decodeURIComponent(this.src.slice(this.src.indexOf(",") + 1));
          return decode.call(this);
        };
      });
      try {
        await seed(page, {
          annotations: [
            { id: "cloud", kind: "shape", shape: "tri", text: "Cloud", x: 0, y: 0, width: 200, height: 120 },
            { id: "target", kind: "shape", shape: "rect", text: "Target", x: 500, y: 0, width: 200, height: 120 },
          ],
          edges: [{ id: "connection", from: "cloud", to: "target", fromSide: "right", toSide: "left" }],
        });
        await gotoCanvas(page, slug);
        await expect.poll(() => requested).toBe(true);
        const outline = page.getByTestId("annotation-cloud").getByTestId("shape-outline");
        expect(await outline.evaluate((el) => el.firstElementChild?.tagName)).toBe("rect");
        let downloads = 0;
        page.on("download", () => downloads++);
        const evaluated = imageEvaluation(page);
        await page.getByTestId("file-button").click();
        if (kind === "png") await page.getByTestId("export-png").click();
        else {
          await page.getByTestId("file-more-formats").click();
          await page.getByTestId("export-image").click();
          await page.getByTestId("image-options-toggle").click();
          await page.getByTestId("image-format-svg").click();
          await page.getByTestId("image-export").click();
        }
        await expect(page.getByTestId("image-export-cancel")).toBeVisible();
        await evaluated();
        await expect(page.getByTestId("export-header")).toBeAttached();
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        expect(downloads).toBe(0);
        const downloaded = outcome === "ready" ? page.waitForEvent("download") : undefined;
        await page.evaluate(() => {
          document.documentElement.dataset.holdMeasurements = "1";
        });
        held.resolve(undefined);
        if (outcome === "failed") {
          await expect(page.getByTestId("toast").filter({ hasText: "export" })).toHaveAttribute("data-kind", "error");
          await expect(page.getByTestId("image-export-cancel")).toHaveCount(0);
          expect(downloads).toBe(0);
          return;
        }
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.measurementPending)).toBe("1");
        await expect.poll(() => outline.evaluate((el) => el.firstElementChild?.tagName)).toBe("polygon");
        // Geometry is rendered, but its forced React Flow measurement is still held.
        expect(downloads).toBe(0);
        await page.evaluate(() => window.dispatchEvent(new Event("release-measurements")));
        if (!downloaded) throw new Error("Missing expected download");
        const download = await downloaded;
        expect(await download.failure()).toBeNull();
        const path = await download.path();
        if (!path) throw new Error("Image download failed");
        const svg =
          kind === "svg"
            ? readFileSync(path, "utf8")
            : await page.evaluate(() => document.documentElement.dataset.exportSvg);
        if (!svg) throw new Error("Missing exported SVG");
        const exported = await context.newPage();
        try {
          await exported.setContent(svg);
          const captured = exported.getByTestId("annotation-cloud").getByTestId("shape-outline");
          expect(await captured.evaluate((el) => el.firstElementChild?.tagName)).toBe("polygon");
          expect(await captured.evaluate((el) => el.firstElementChild?.getAttribute("points"))).toBe(
            await outline.evaluate((el) => el.firstElementChild?.getAttribute("points")),
          );
          const edge = exported.getByTestId("edge-connection");
          for (const [id, end] of [
            ["cloud", false],
            ["target", true],
          ] as const) {
            const point = await edgePoint(edge, end);
            const distance = await exported
              .getByTestId(`annotation-${id}`)
              .getByTestId("shape-outline")
              .evaluate((svg, point) => {
                const stroke = svg.firstElementChild;
                if (!(stroke instanceof SVGGeometryElement)) throw new Error("Missing outline");
                const matrix = stroke.getScreenCTM();
                if (!matrix) throw new Error("Missing outline transform");
                const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
                const length = stroke.getTotalLength();
                let distance = Infinity;
                for (let i = 0; i <= 2048; i++) {
                  const sample = stroke.getPointAtLength((length * i) / 2048);
                  distance = Math.min(distance, Math.hypot(local.x - sample.x, local.y - sample.y));
                }
                return distance;
              }, point);
            expect(distance).toBeLessThan(1);
          }
        } finally {
          await exported.close();
        }
      } finally {
        held.resolve(undefined);
        await page.evaluate(() => window.dispatchEvent(new Event("release-measurements")));
      }
    });

async function edgePoint(edge: Locator, end = false) {
  return edge.evaluate((root, end) => {
    const path = root.firstElementChild;
    if (!(path instanceof SVGPathElement)) throw new Error("Missing connection path");
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Missing connection transform");
    const point = path.getPointAtLength(end ? path.getTotalLength() : 0).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, end);
}

test("cancelling a stalled geometry download releases the canvas and permits retry", async ({ page }) => {
  test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
  const held = Promise.withResolvers<undefined>();
  let requested = false;
  await page.route(/\/assets\/extendedGeometry-[^/]+\.js$/, async (route) => {
    requested = true;
    await held.promise;
    await route.continue();
  });
  try {
    await seed(page, {
      annotations: [
        { id: "triangle", kind: "shape", shape: "tri", text: "Triangle", x: 0, y: 0, width: 200, height: 120 },
      ],
    });
    await gotoCanvas(page, slug);
    await expect.poll(() => requested).toBe(true);
    let downloads = 0;
    page.on("download", () => downloads++);
    const evaluated = imageEvaluation(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await expect(page.getByTestId("image-export-cancel")).toBeVisible();
    await evaluated();
    await expect(page.getByTestId("export-header")).toBeAttached();
    await page.getByTestId("image-export-cancel").click();
    await expect(page.getByTestId("image-export-cancel")).toHaveCount(0);
    // Input is usable before the chunk arrives, including editing the waiting shape.
    await page.getByTestId("annotation-triangle").dblclick();
    const editor = page.getByTestId("annotation-editor");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Still editable");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("annotation-triangle")).toContainText("Still editable");
    await expect.poll(async () => (await savedDiagram(page)).annotations?.[0].text).toBe("Still editable");
    const response = page.waitForResponse((response) => /\/assets\/extendedGeometry-[^/]+\.js$/.test(response.url()));
    held.resolve(undefined);
    await (await response).finished();
    await expect
      .poll(() =>
        page
          .getByTestId("annotation-triangle")
          .getByTestId("shape-outline")
          .evaluate((el) => el.firstElementChild?.tagName),
      )
      .toBe("polygon");
    expect(downloads).toBe(0);
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (this.src.startsWith("data:image/svg+xml"))
          document.documentElement.dataset.retrySvg = decodeURIComponent(this.src.slice(this.src.indexOf(",") + 1));
        return decode.call(this);
      };
    });
    await page.getByTestId("file-button").click();
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("export-png").click();
    expect(await (await downloaded).failure()).toBeNull();
    expect(downloads).toBe(1);
    expect(await page.evaluate(() => document.documentElement.dataset.retrySvg)).toContain("Still editable");
  } finally {
    held.resolve(undefined);
  }
});
