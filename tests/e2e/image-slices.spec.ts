import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { test, expect, expectNoErrors, gotoCanvas, pageLoadTimeout, publicExamples } from "./fixtures";

// Image export clones the canvas in time slices (src/interop/imageClone.ts, a port of html-to-image's clone): the
// tab keeps painting, the toast shows how far it has got, and Cancel stops it. The port must draw what the library
// draws, byte for byte; the browser parity tier pins the exported images too (docs/PARITY.md).

/** The library's toSvg and toPng against the sliced port, on the canvas as it is, with the same options. */
async function bothWays(page: Page, sliceMs: number) {
  return page.evaluate(async (sliceMs) => {
    const port = (await import(
      "/src/interop/imageClone.ts" as string
    )) as typeof import("../../src/interop/imageClone");
    const lib = (await import("/node_modules/html-to-image/es/index.js" as string)) as typeof import("html-to-image");
    const viewport = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"] .react-flow__viewport');
    if (!viewport) throw new Error("no canvas");
    const fontEmbedCSS = await lib.getFontEmbedCSS(viewport);
    const options = { fontEmbedCSS, width: 1600, height: 1200, pixelRatio: 1, cacheBust: false };
    const slicer = () => new port.Slicer(viewport.getElementsByTagName("*").length, { sliceMs });
    const svgSlicer = slicer();
    const svg = [await lib.toSvg(viewport, options), await port.toSvg(viewport, options, svgSlicer)];
    const png = [await lib.toPng(viewport, options), await port.toPng(viewport, options, slicer())];
    // The file the app saves: the SVG text itself, which decoding the data URL gives back.
    const text = await port.toSvgText(viewport, options, slicer());
    const fromUrl = decodeURIComponent(svg[1].slice(svg[1].indexOf(",") + 1));
    return { svg, png, text, fromUrl, yields: svgSlicer.yields, elements: viewport.getElementsByTagName("*").length };
  }, sliceMs);
}

/** html-to-image's pseudo-element class names (u, four random characters, a counter), numbered by first appearance. */
function canonicalNames(svgUrl: string) {
  return canonicalText(decodeURIComponent(svgUrl));
}

function canonicalText(svg: string) {
  const names = new Map<string, string>();
  return svg.replace(/\bu[0-9a-z]{4}\d+\b/g, (name) => {
    if (!names.has(name)) names.set(name, `pseudo${names.size}`);
    return names.get(name) ?? name;
  });
}

test.describe("image export in slices", { tag: "@dev" }, () => {
  test("a node added or taken away mid-export stops it, rather than drawing two diagrams", async ({ page }) => {
    test.slow();
    await openLanes(page);
    const outcome = await page.evaluate(async () => {
      const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
      const nodes = document.querySelector('[data-testid="canvas-wrap"] .react-flow__nodes');
      const node = nodes?.lastElementChild;
      if (!nodes || !node) throw new Error("no nodes");
      let moved = false;
      return image
        .renderDiagramImage("svg", {
          // As soon as the export reports progress, a node leaves and comes back (an agent's edit would be one).
          onProgress: () => {
            if (moved) return;
            moved = true;
            nodes.append(node);
          },
        })
        .then(
          () => "exported",
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        );
    });
    expect(outcome).toBe("The diagram changed while it was being exported. Export it again.");
  });

  test("a cancel while the picture decodes stops the PNG: nothing drawn, nothing returned", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await expect(page.locator('[data-testid^="rf__node-"]').first()).toBeVisible({ timeout: pageLoadTimeout() });
    const outcome = await page.evaluate(async () => {
      const port = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const viewport = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"] .react-flow__viewport');
      if (!viewport) throw new Error("no canvas");
      // Decoding waits for the test: the export is cancelled while it does.
      let started!: () => void;
      const decoding = new Promise<void>((resolve) => (started = resolve));
      let release = (): Promise<void> => Promise.resolve();
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        started();
        return new Promise<void>((resolve) => {
          release = () => {
            const done = decode.call(this);
            resolve(done);
            return done;
          };
        });
      };
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      let draws = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (...args: Parameters<typeof drawImage>) {
        draws++;
        return drawImage.apply(this, args);
      };
      const cancel = new AbortController();
      const options = { width: 800, height: 600, pixelRatio: 1, cacheBust: false };
      const png = port.toPng(viewport, options, new port.Slicer(1, { signal: cancel.signal }));
      try {
        await decoding;
        cancel.abort();
        const result = await png.then(
          () => "returned a picture",
          (err: unknown) => (err instanceof DOMException ? err.name : String(err)),
        );
        // The decoding finishes, and createImage's frame after it: anything that would draw has had its chance.
        await release();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { result, draws };
      } finally {
        HTMLImageElement.prototype.decode = decode;
        CanvasRenderingContext2D.prototype.drawImage = drawImage;
      }
    });
    expect(outcome).toEqual({ result: "AbortError", draws: 0 });
  });

  for (const example of publicExamples.slice(0, 3))
    test(`draws what html-to-image draws, byte for byte: ${example.slug}`, async ({ page, consoleErrors }) => {
      test.slow();
      await gotoCanvas(page, example.slug);
      await expect(page.locator('[data-testid^="rf__node-"]').first()).toBeVisible({ timeout: pageLoadTimeout() });
      // A slice of no time at all: the port hands the thread back after every node, and splits the serialising
      // wherever it can, so every seam it has is crossed.
      const r = await bothWays(page, 0);
      expect(r.yields).toBeGreaterThan(r.elements / 2);
      // Pseudo-elements get class names from a running counter and a random part, so two exports never match on
      // those alone: name them by order of appearance, the same in both.
      const [lib, port] = r.svg.map(canonicalNames);
      expect(port.length).toBe(lib.length);
      expect(port === lib, "the same SVG").toBe(true);
      expect(r.png[1] === r.png[0], "the same PNG").toBe(true);
      expect(canonicalText(r.text) === canonicalText(r.fromUrl), "the saved SVG is the data URL's text").toBe(true);
      expectNoErrors(consoleErrors);
    });

  test("draws what html-to-image draws, byte for byte: 300 nodes", async ({ page, consoleErrors }) => {
    test.slow();
    await openLanes(page);
    const r = await bothWays(page, 0);
    const [lib, port] = r.svg.map(canonicalNames);
    expect(port === lib, "the same SVG").toBe(true);
    expect(r.png[1] === r.png[0], "the same PNG").toBe(true);
    expectNoErrors(consoleErrors);
  });
});

/** A diagram big enough that its export takes many slices: 20 lanes of 15 services, chained. */
function lanes(count = 20) {
  const nodes: object[] = [];
  const edges: object[] = [];
  for (let p = 0; p < count; p++)
    for (let i = 0; i < 15; i++) {
      const id = `p${p}n${i}`;
      nodes.push({ id, stencil: i % 3 ? "service.go" : "aws.sqs", label: `Node ${p}.${i}`, x: i * 260, y: p * 120 });
      if (i) edges.push({ id: `e-${id}`, from: `p${p}n${i - 1}`, to: id, kind: "async" });
    }
  return { format: "diagrams/v1", title: "Lanes", nodes, edges };
}

async function openLanes(page: Page) {
  await gotoCanvas(page, publicExamples[0].slug);
  await page.getByTestId("import-input").setInputFiles({
    name: "lanes.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(lanes())),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Lanes", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("node-p19n14")).toBeAttached();
}

/** Counts animation frames from now on (the page painting), read with `frames()`. */
async function countFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const tick = () => {
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
}

test("a long image export keeps the page painting, shows its progress and can be cancelled", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openLanes(page);
  // Something selected: the export takes its marks off for the picture and must put them back.
  await page.getByTestId("node-p0n0").click();
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
  let downloads = 0;
  page.on("download", () => downloads++);

  // The export reports progress while the clone runs; the page paints between its slices.
  const frames = await countFrames(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  const atProgress = await frames();
  await expect.poll(frames).toBeGreaterThan(atProgress + 2);
  // The keyboard reaches Cancel at once, and stays there: Tab doesn't wander back into the canvas.
  await expect(page.getByTestId("image-export-cancel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("image-export-cancel")).toBeFocused();
  // The canvas's own shortcuts wait too, the window's first listeners included: T would add text, Ctrl+A select all.
  // (From the page itself, not the toast: the editor ignores keys from overlays.)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(400, 400);
  await page.keyboard.press("t");
  await page.keyboard.press("Control+a");
  // Cancel: the toast goes, nothing downloads, and the canvas is as it was.
  await page.getByTestId("image-export-cancel").click();
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
  await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(0);
  await expect(page.getByTestId("rf__node-p1n0")).not.toHaveClass(/selected/);
  // Input is the page's again: a click selects.
  await page.getByTestId("node-p1n0").click();
  await expect(page.getByTestId("rf__node-p1n0")).toHaveClass(/selected/);
  expect(downloads).toBe(0);

  // Escape cancels too.
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toast")).toHaveCount(0);
  expect(downloads).toBe(0);

  // Let one finish: it downloads, after the same progress.
  await page.getByTestId("file-button").click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByTestId("export-png").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByTestId("rf__node-p1n0")).toHaveClass(/selected/);
  expectNoErrors(consoleErrors);
});

/** Starts an export through File ▸ More formats ▸ Image… (the dialog closes as the export starts). */
async function exportThroughDialog(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-export").click();
}

for (const unavailable of [["Worker"], ["OffscreenCanvas"], ["Worker", "OffscreenCanvas"]])
  test(`PNG and SVG export work without ${unavailable.join(" or ")}`, async ({ page, consoleErrors }) => {
    await page.addInitScript((names) => {
      for (const name of names) Object.defineProperty(window, name, { configurable: true, value: undefined });
    }, unavailable);
    await gotoCanvas(page, publicExamples[0].slug);
    await expect(page.locator('[data-testid^="rf__node-"]').first()).toBeVisible({ timeout: pageLoadTimeout() });
    await page.getByTestId("file-button").click();
    const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
    const pngPath = await png.path();
    if (!pngPath) throw new Error("PNG download failed");
    expect((await readFile(pngPath)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const [svg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("image-export").click()]);
    const svgPath = await svg.path();
    if (!svgPath) throw new Error("SVG download failed");
    expect(await readFile(svgPath, "utf8")).toMatch(/^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expectNoErrors(consoleErrors);
  });

for (const phase of ["decode", "encode"] as const)
  test(`a PNG ${phase} error releases the canvas, reports the error and allows another export`, async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const id = publicExamples[0].nodeIds[0];
    const card = page.getByTestId(`node-${id}`);
    const node = page.getByTestId(`rf__node-${id}`);
    await expect(node).toBeVisible({ timeout: pageLoadTimeout() });
    await card.click();
    await expect(node).toHaveClass(/selected/);
    // Fail once, at the browser boundary. The next export uses the original implementation.
    await page.evaluate((phase) => {
      if (phase === "decode") {
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          HTMLImageElement.prototype.decode = decode;
          return Promise.reject(new Error("Image decode failed"));
        };
      } else {
        const encode = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function () {
          HTMLCanvasElement.prototype.toDataURL = encode;
          throw new Error("Image encode failed");
        };
      }
    }, phase);
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText(`Image ${phase} failed`);
    await expect(node).toHaveClass(/selected/);
    await expect(page.getByTestId("export-header")).toHaveCount(0);
    expect(downloads).toBe(0);
    // The input hold and temporary paint must both be restored, including after the final drawing fails.
    await node.focus();
    await page.keyboard.press("Escape");
    await expect(node).not.toHaveClass(/selected/);
    await page.getByTestId("file-button").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    expectNoErrors(consoleErrors);
  });

test("an export started from the Image dialog hands the keyboard to its Cancel", async ({ page }) => {
  test.slow();
  await openLanes(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await exportThroughDialog(page);
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  // The dialog gives its opener the focus back as it closes; Cancel takes it after that, and Enter presses it.
  await expect(page.getByTestId("image-export-cancel")).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toHaveCount(0);
  expect(downloads).toBe(0);
});

for (const [stalled, pattern, kind] of [
  ["its code", /imageClone/, undefined],
  ["its fonts", /\.woff2?(\?|$)/, "fetch"],
] as const)
  test(`a cancel while ${stalled} won't download releases the page`, async ({ page }) => {
    test.slow();
    await openLanes(page);
    // The request hangs: the export waits on it, and only a cancel ends the wait.
    let stalls = 0;
    await page.route(pattern, async (route) => {
      if (kind && route.request().resourceType() !== kind) return route.continue();
      stalls++;
      await new Promise(() => {});
    });
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await expect(page.getByTestId("image-export-cancel")).toBeFocused();
    await expect.poll(() => stalls).toBeGreaterThan(0);
    await page.getByTestId("image-export-cancel").click();
    await expect(page.getByTestId("toast")).toHaveCount(0);
    // The page is the user's again, and nothing the export added stays.
    await page.getByTestId("node-p2n0").click();
    await expect(page.getByTestId("rf__node-p2n0")).toHaveClass(/selected/);
    await expect(page.getByTestId("export-header")).toHaveCount(0);
    expect(downloads).toBe(0);
  });
