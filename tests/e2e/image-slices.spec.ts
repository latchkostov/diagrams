import type { Page } from "@playwright/test";
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
  // Cancel: the toast goes, nothing downloads, and the canvas is as it was.
  await page.getByTestId("image-export-cancel").click();
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
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
