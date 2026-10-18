import type { Download, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  expectNoErrors,
  gotoCanvas,
  gotoLab,
  pageLoadTimeout,
  publicExamples,
  waitForSelectionSettled,
  waitForStableViewport,
  fitDiagram,
} from "./fixtures";
import { callTool, installFakeModelContext, toolNames } from "./ai-helpers";

/** Keep the slow-rendering CI case exercised even on a fast workstation. */
async function slowExports(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

/** Observe downloads before starting; wait on the app's completion signal, within the test's hang backstop. */
function imageDownloads(page: Page) {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  return {
    count: () => downloads.length,
    finished: async (kind: "png" | "svg" = "png") => {
      await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "success", { timeout: test.info().timeout });
      await expect.poll(() => downloads.length).toBe(1);
      const download = downloads[0];
      expect(download.suggestedFilename()).toMatch(kind === "png" ? /\.png$/ : /\.svg$/);
      expect(await download.failure()).toBeNull();
      return download;
    },
  };
}

// Image export clones the canvas in time slices (src/interop/imageClone.ts, a port of html-to-image's clone): the
// tab keeps painting, the toast shows how far it has got, and Cancel stops it. The port must draw what the library
// draws, byte for byte; the browser parity tier pins the exported images too (docs/PARITY.md).

/** The library's toSvg and toPng against the sliced port, on the canvas as it is, with the same options. */
async function bothWays(page: Page, sliceMs: number, kind: "all" | "svg" | "png" = "all") {
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-fit-pending", "false");
  await waitForStableViewport(page);
  return page.evaluate(
    async ({ sliceMs, kind }) => {
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
      const svg =
        kind === "png" ? [] : [await lib.toSvg(viewport, options), await port.toSvg(viewport, options, svgSlicer)];
      const png =
        kind === "svg" ? [] : [await lib.toPng(viewport, options), await port.toPng(viewport, options, slicer())];
      // The file the app saves: the SVG text itself, which decoding the data URL gives back.
      const text = kind === "all" ? await port.toSvgText(viewport, options, slicer()) : "";
      const fromUrl = kind === "all" ? decodeURIComponent(svg[1].slice(svg[1].indexOf(",") + 1)) : "";
      return { svg, png, text, fromUrl, yields: svgSlicer.yields, elements: viewport.getElementsByTagName("*").length };
    },
    { sliceMs, kind },
  );
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
  test.beforeEach(async ({ page }) => {
    // Compare the same stationary drawing across sequential clones. Viewport animation
    // is tested elsewhere; a still-running initial fit changes the cloned matrix.
    await page.emulateMedia({ reducedMotion: "reduce" });
  });
  for (const edit of ["rename", "move", "reconnect", "remove", "add", "undo", "replace"] as const)
    test(`a ${edit} between export slices invalidates the captured document version`, async ({ page }) => {
      test.slow();
      await openLanes(page);
      const outcome = await page.evaluate(async (edit) => {
        const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
        const { paletteHost } = (await import(
          "/src/palette/host.ts" as string
        )) as typeof import("../../src/palette/host");
        const editor = paletteHost.get().canvas?.editor;
        if (!editor) throw new Error("no editor");
        if (edit === "undo") editor.updateNode("p0n0", { label: "Before undo" });
        const version = editor.getDocumentVersion();
        let moved = false;
        return image
          .renderDiagramImage("svg", {
            check: () => {
              if (editor.getDocumentVersion() !== version) throw new Error("changed");
            },
            onProgress: () => {
              if (moved) return;
              moved = true;
              if (edit === "rename") editor.updateNode("p0n0", { label: "New name" });
              if (edit === "move") editor.updateNode("p0n0", { x: 9999 });
              if (edit === "reconnect") editor.reconnectEdge("e-p0n1", "target", "p1n0");
              if (edit === "remove") editor.deleteElements({ nodeIds: ["p0n0"] });
              if (edit === "add") editor.addNode("service.go");
              if (edit === "undo") editor.undo();
              if (edit === "replace") editor.applyDiagram({ ...editor.getDiagram(), title: "Replacement" });
            },
          })
          .then(
            () => "exported",
            (err: unknown) => (err instanceof Error ? err.message : String(err)),
          );
      }, edit);
      expect(outcome).toBe("changed");
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
            resolve();
            return Promise.resolve();
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
      const progress: number[] = [];
      const png = port.toPng(
        viewport,
        options,
        new port.Slicer(1, { signal: cancel.signal, sliceMs: 0, onProgress: (done) => progress.push(done) }),
      );
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
        return {
          result,
          draws,
          unfinishedProgress: progress.every((done) => done < 1),
          monotonic: progress.every((done, i) => !i || done >= progress[i - 1]),
        };
      } finally {
        HTMLImageElement.prototype.decode = decode;
        CanvasRenderingContext2D.prototype.drawImage = drawImage;
      }
    });
    expect(outcome).toEqual({ result: "AbortError", draws: 0, unfinishedProgress: true, monotonic: true });
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

  for (const kind of ["svg", "png"] as const)
    test(`draws what html-to-image draws, byte for byte: 300 nodes (${kind})`, async ({ page, consoleErrors }) => {
      test.slow();
      await openLanes(page);
      // Keep both full-size comparisons, without five serial clones in one case.
      // SVG text/data-URL equivalence is already checked on every small example above.
      const r = await bothWays(page, 0, kind);
      if (kind === "svg") {
        const [lib, port] = r.svg.map(canonicalNames);
        expect(port === lib, "the same SVG").toBe(true);
      } else expect(r.png[1] === r.png[0], "the same PNG").toBe(true);
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

async function openLanes(page: Page, count = 20) {
  await gotoCanvas(page, publicExamples[0].slug);
  await page.getByTestId("import-input").setInputFiles({
    name: "lanes.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(lanes(count))),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Lanes", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId(`node-p${count - 1}n14`)).toBeAttached();
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

/** Keep a real clone slice pending while exercising cancellation, regardless of host speed. */
async function holdExportSlice(page: Page) {
  await page.evaluate(() => {
    const NativeChannel = window.MessageChannel;
    const w = window as unknown as { __sliceHeld: boolean; __releaseSlice: () => void };
    w.__sliceHeld = false;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super();
        const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = (message: unknown) => {
          requestAnimationFrame(() => {
            const progress = Number(
              document.querySelector('[data-testid="toast-progress"]')?.getAttribute("aria-valuenow"),
            );
            if (!(progress > 0 && progress < 70)) return post(message);
            window.MessageChannel = NativeChannel;
            w.__sliceHeld = true;
            w.__releaseSlice = () => post(message);
          });
        };
      }
    };
  });
  return {
    held: () =>
      page.waitForFunction(() => (window as unknown as { __sliceHeld: boolean }).__sliceHeld, undefined, {
        timeout: test.info().timeout,
      }),
    release: () => page.evaluate(() => (window as unknown as { __releaseSlice: () => void }).__releaseSlice()),
  };
}

test("large export paints between progressing clone slices", async ({ page, consoleErrors }) => {
  test.slow();
  await openLanes(page);
  await countFrames(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: number;
      __cloneProgress: { progress: number; frame: number }[];
    };
    w.__cloneProgress = [];
    const observer = new MutationObserver(() => {
      const progress = Number(document.querySelector('[data-testid="toast-progress"]')?.getAttribute("aria-valuenow"));
      if (progress > 0 && progress < 70 && progress !== w.__cloneProgress.at(-1)?.progress)
        w.__cloneProgress.push({ progress, frame: w.__frames });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  });
  // Use the production slice budget, channel and clock: no held continuation or injected frame.
  const downloads = imageDownloads(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await downloads.finished();
  const samples = await page.evaluate(
    () => (window as unknown as { __cloneProgress: { progress: number; frame: number }[] }).__cloneProgress,
  );
  expect(samples.length).toBeGreaterThanOrEqual(3);
  let paintedIntervals = 0;
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i].progress).toBeGreaterThan(samples[i - 1].progress);
    if (samples[i].frame > samples[i - 1].frame) paintedIntervals++;
  }
  expect(paintedIntervals).toBeGreaterThanOrEqual(2);
  expectNoErrors(consoleErrors);
});

test("a long image export keeps the page painting, shows its progress and can be cancelled", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await openLanes(page);
  // Something selected: the export takes its marks off for the picture and must put them back.
  await page.getByTestId("node-p0n0").click();
  await waitForSelectionSettled(page);
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
  const downloads = imageDownloads(page);

  // The export reports progress while the clone runs; the page paints between its slices.
  const frames = await countFrames(page);
  const firstSlice = await holdExportSlice(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await firstSlice.held();
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
  await page.keyboard.press("ControlOrMeta+a");
  // Cancel: the toast goes, nothing downloads, and the canvas is as it was.
  await page.getByTestId("image-export-cancel").click();
  await firstSlice.release();
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
  await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(0);
  await expect(page.getByTestId("rf__node-p1n0")).not.toHaveClass(/selected/);
  // Input is the page's again: a click selects.
  await fitDiagram(page);
  await page.getByTestId("node-p1n0").click();
  await expect(page.getByTestId("rf__node-p1n0")).toHaveClass(/selected/);
  expect(downloads.count()).toBe(0);

  // Escape cancels too.
  const secondSlice = await holdExportSlice(page);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await secondSlice.held();
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  await page.keyboard.press("Escape");
  await secondSlice.release();
  await expect(page.getByTestId("toast")).toHaveCount(0);
  expect(downloads.count()).toBe(0);

  // Let one finish: it downloads, after the same progress.
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await downloads.finished();
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
    const pngDownloads = imageDownloads(page);
    await page.getByTestId("export-png").click();
    const png = await pngDownloads.finished();
    const pngPath = await png.path();
    if (!pngPath) throw new Error("PNG download failed");
    expect((await readFile(pngPath)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const svgDownloads = imageDownloads(page);
    await page.getByTestId("image-export").click();
    const svg = await svgDownloads.finished("svg");
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
    // Exercise the failure/recovery boundary with the Lab's two-node contract fixture;
    // cold, full-example cloning belongs to the separate export/parity workloads.
    await gotoLab(page, "export-contract");
    await page.getByTestId("lab-open-editor").click();
    const id = "worker";
    const card = page.getByTestId(`node-${id}`);
    const node = page.getByTestId(`rf__node-${id}`);
    await expect(node).toBeVisible({ timeout: pageLoadTimeout() });
    await card.click();
    await expect(node).toHaveClass(/selected/);
    // Fail once, at the browser boundary. The next export uses the original implementation.
    const reached = Promise.withResolvers<undefined>();
    await page.exposeFunction("__imageFaultReached", () => reached.resolve(undefined));
    await page.evaluate((phase) => {
      const reached = () => void (window as unknown as { __imageFaultReached(): Promise<void> }).__imageFaultReached();
      if (phase === "decode") {
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          HTMLImageElement.prototype.decode = decode;
          reached();
          return Promise.reject(new Error("Image decode failed"));
        };
      } else {
        const encode = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function () {
          HTMLCanvasElement.prototype.toDataURL = encode;
          reached();
          throw new Error("Image encode failed");
        };
      }
    }, phase);
    const downloads = imageDownloads(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    // Cold module/font work is not the fault-reporting latency being asserted.
    await reached.promise;
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText(`Image ${phase} failed`);
    await expect(node).toHaveClass(/selected/);
    await expect(page.getByTestId("export-header")).toHaveCount(0);
    expect(downloads.count()).toBe(0);
    // The input hold and temporary paint must both be restored, including after the final drawing fails.
    await node.focus();
    await page.keyboard.press("Escape");
    await expect(node).not.toHaveClass(/selected/);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await downloads.finished();
    expectNoErrors(consoleErrors);
  });

/** Hold the PNG's real decode boundary, including small, already-cached exports. */
async function holdPngDecode(page: Page) {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const w = window as unknown as { __pngHeld: boolean; __releasePng: () => Promise<void> };
    w.__pngHeld = false;
    HTMLImageElement.prototype.decode = function () {
      HTMLImageElement.prototype.decode = decode;
      w.__pngHeld = true;
      return new Promise<void>((resolve, reject) => {
        w.__releasePng = () => decode.call(this).then(resolve, reject);
      });
    };
  });
  return {
    held: () => page.waitForFunction(() => (window as unknown as { __pngHeld: boolean }).__pngHeld),
    release: () => page.evaluate(() => (window as unknown as { __releasePng?: () => Promise<void> }).__releasePng?.()),
  };
}

test("an export started from the Image dialog hands the keyboard to its Cancel", async ({ page }) => {
  test.slow();
  await openLanes(page, 3);
  const decode = await holdPngDecode(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await exportThroughDialog(page);
  await decode.held();
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  // The dialog gives its opener the focus back as it closes; Cancel takes it after that, and Enter presses it.
  await expect(page.getByTestId("image-export-cancel")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await decode.release();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(downloads).toBe(0);
});

for (const [stalled, pattern, kind] of [
  ["the initial export module", /(?:\/image-[^/]+\.js|\/src\/interop\/image\.ts)(?:\?|$)/, undefined],
  ["its code", /imageClone/, undefined],
  ["its fonts", /\.woff2?(\?|$)/, "fetch"],
] as const)
  test(`a cancel while ${stalled} won't download releases the page and stays cancelled after loading resumes`, async ({
    page,
    consoleErrors,
  }) => {
    test.slow();
    // The request hangs: the export waits on it, and only a cancel ends the wait.
    let stalls = 0;
    let resumed = false;
    let finished = 0;
    const modules: string[] = [];
    const release = Promise.withResolvers<undefined>();
    await page.route(pattern, async (route) => {
      if (kind && route.request().resourceType() !== kind) return route.continue();
      if (resumed) return route.continue();
      stalls++;
      if (!kind) modules.push(route.request().url());
      const response = await route.fetch();
      await release.promise;
      await route.fulfill({ response });
      await (await route.request().response())?.finished();
      finished++;
    });
    // The held request guarantees the cancellation boundary, regardless of diagram size. Keep the retry small:
    // 300 nodes at 4× throttling exhaust the whole-test backstop on Linux even when loading resumes correctly.
    await openLanes(page, 3);
    // The held request is the slow boundary here; CPU throttling adds unrelated UI starvation.
    const downloads = imageDownloads(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await expect(page.getByTestId("image-export-cancel")).toBeFocused();
    await expect.poll(() => stalls, { timeout: test.info().timeout }).toBeGreaterThan(0);
    await expect(page.getByTestId("toast-dismiss")).toHaveCount(0);
    if (stalled === "the initial export module") await page.keyboard.press("Escape");
    else await page.getByTestId("image-export-cancel").click();
    await expect(page.getByTestId("toast")).toHaveCount(0);
    // The page is the user's again, and nothing the export added stays.
    await page.getByTestId("node-p2n0").click();
    await expect(page.getByTestId("rf__node-p2n0")).toHaveClass(/selected/);
    await expect(page.getByTestId("export-header")).toHaveCount(0);
    expect(downloads.count()).toBe(0);
    resumed = true;
    release.resolve(undefined);
    await expect.poll(() => finished).toBe(stalls);
    await page.evaluate(async (urls) => {
      await Promise.all(urls.map((url) => import(/* @vite-ignore */ url)));
    }, modules);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(downloads.count()).toBe(0);
    await expect(page.getByTestId("toast")).toHaveCount(0);
    // Module evaluation / the cached font promise can now finish. A subsequent export waits on that same work.
    const decode = await holdPngDecode(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await decode.held();
    await expect(page.getByTestId("toast-progress")).toBeVisible();
    await decode.release();
    await downloads.finished();
    expect(downloads.count()).toBe(1);
    expectNoErrors(consoleErrors);
  });

test("cancelling FileReader conversion releases the page and retries the uncached icon", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await gotoCanvas(page, publicExamples[0].slug);
  const id = publicExamples[0].nodeIds[0];
  await expect(page.getByTestId(`node-${id}`)).toBeVisible({ timeout: pageLoadTimeout() });
  await page.evaluate(() => {
    const NativeReader = window.FileReader;
    const held: { reader: FileReader; blob: Blob; aborted: boolean }[] = [];
    const w = window as unknown as {
      __readers: typeof held;
      __resumeReaders: () => Promise<string[]>;
    };
    w.__readers = held;
    // Hold the browser conversion boundary, after fetch/blob have already completed. Font readers run normally.
    window.FileReader = class extends NativeReader {
      override readAsDataURL(blob: Blob) {
        if (blob.type.includes("image/svg+xml")) held.push({ reader: this, blob, aborted: false });
        else super.readAsDataURL(blob);
      }
      override abort() {
        const entry = held.find((entry) => entry.reader === this);
        if (entry) entry.aborted = true;
        super.abort();
      }
    };
    w.__resumeReaders = async () => {
      window.FileReader = NativeReader;
      return Promise.all(
        held.map(async ({ reader, blob }) => {
          // Even completion after cancellation must neither download nor populate the resource cache.
          await new Promise<void>((resolve, reject) => {
            reader.addEventListener("loadend", () => resolve(), { once: true });
            reader.addEventListener("error", reject, { once: true });
            NativeReader.prototype.readAsDataURL.call(reader, blob);
          });
          return blob.text();
        }),
      );
    };
  });
  const downloads = imageDownloads(page);
  const iconRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch" && /\.svg(?:\?|$)/.test(request.url())) iconRequests.push(request.url());
  });
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await page.waitForFunction(() => (window as unknown as { __readers: unknown[] }).__readers.length > 0, undefined, {
    timeout: 0,
  });
  await page.getByTestId("image-export-cancel").click();
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("export-header")).toHaveCount(0);
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId(`rf__node-${id}`)).toHaveClass(/selected/);
  const abandoned = await page.evaluate(() =>
    (
      window as unknown as {
        __readers: { reader: FileReader; aborted: boolean }[];
      }
    ).__readers.map(({ reader, aborted }) => ({
      aborted,
      loadend: reader.onloadend !== null,
      error: reader.onerror !== null,
    })),
  );
  expect(abandoned.length).toBeGreaterThan(0);
  expect(abandoned.every((reader) => reader.aborted && !reader.loadend && !reader.error)).toBe(true);
  const firstRequests = [...iconRequests];
  expect(firstRequests.length).toBeGreaterThan(0);
  const icons = await page.evaluate(() =>
    (window as unknown as { __resumeReaders: () => Promise<string[]> }).__resumeReaders(),
  );
  expect(downloads.count()).toBe(0);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  await page.getByTestId("image-export").click();
  const download = await downloads.finished("svg");
  const path = await download.path();
  if (!path) throw new Error("SVG download failed");
  const svg = await readFile(path, "utf8");
  for (const icon of icons) expect(svg).toContain(Buffer.from(icon).toString("base64"));
  for (const url of firstRequests) expect(iconRequests.filter((next) => next === url).length).toBeGreaterThan(1);
  expectNoErrors(consoleErrors);
});

test("a WebMCP rename during export reports a localized retry and downloads no mixed revision", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  await installFakeModelContext(page);
  await openLanes(page);
  await expect.poll(() => toolNames(page)).toContain("edit_diagram");
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-png").click();
  await expect(page.getByTestId("toast-progress")).toBeVisible();
  const result = await callTool(page, "edit_diagram", {
    ops: [{ op: "update", target: "p0n0", label: "Renamed during export" }],
  });
  expect(result.isError).toBe(false);
  await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
  await expect(page.getByTestId("toast")).toContainText("Couldn't export the PNG. Try again");
  expect(downloads).toBe(0);
  await expect(page.getByTestId("export-header")).toHaveCount(0);
  await page.getByTestId("node-p0n0").click();
  await expect(page.getByTestId("rf__node-p0n0")).toHaveClass(/selected/);
  expectNoErrors(consoleErrors);
});

test.describe("touch during export", () => {
  test.use({ hasTouch: true });
  test("a touch drag is held until export is cancelled", async ({ page }) => {
    test.slow();
    await openLanes(page);
    const node = page.getByTestId("rf__node-p0n0");
    const style = await node.getAttribute("style");
    if (style === null) throw new Error("no node style");
    const point = await page.getByTestId("node-p0n0").boundingBox();
    if (!point) throw new Error("no node");
    await page.getByTestId("file-button").click();
    await page.getByTestId("export-png").click();
    await expect(page.getByTestId("toast-progress")).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const x = point.x + point.width / 2,
      y = point.y + point.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 80, y: y + 60 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect(node).toHaveAttribute("style", style);
    await page.getByTestId("image-export-cancel").tap();
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect(node).toHaveAttribute("style", style);
  });
});

test("PNG progress stays unfinished through decoding and finishes with the download", async ({
  page,
  consoleErrors,
}) => {
  test.slow();
  // Decode is held explicitly below; the separate long-export test covers the 300-node workload.
  await gotoCanvas(page, "kafka-order-pipeline");
  await slowExports(page);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const w = window as unknown as { __decoding: boolean; __resumeDecode: () => void };
    w.__decoding = false;
    HTMLImageElement.prototype.decode = function () {
      HTMLImageElement.prototype.decode = decode;
      const decoded = decode.call(this);
      w.__decoding = true;
      return new Promise<void>((resolve) => {
        w.__resumeDecode = () => resolve(decoded);
      });
    };
  });
  await page.getByTestId("file-button").click();
  const downloads = imageDownloads(page);
  await page.getByTestId("export-png").click();
  // Reaching decode includes the entire clone, embedding and serialization.
  await page.waitForFunction(() => (window as unknown as { __decoding: boolean }).__decoding, undefined, {
    timeout: test.info().timeout,
  });
  await expect(page.getByTestId("toast-icon")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toContainText("Exporting PNG…");
  const value = await page.getByTestId("toast-progress").getAttribute("aria-valuenow");
  expect(Number(value)).toBeGreaterThan(0);
  expect(Number(value)).toBeLessThan(100);
  expect(downloads.count()).toBe(0);
  await page.evaluate(() => (window as unknown as { __resumeDecode: () => void }).__resumeDecode());
  await downloads.finished();
  expectNoErrors(consoleErrors);
});
