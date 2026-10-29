import { test, expect, gotoCanvas, gotoLive, publicExamples, pageLoadTimeout } from "./fixtures";
import { readFileSync } from "node:fs";

test(
  "PNG embeds fonts, backgrounds and both mask spellings before style sharing",
  { tag: "@dev" },
  async ({ page }) => {
    const font = readFileSync("node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2");
    await page.route("**/png-capture-font.woff2", (route) => route.fulfill({ body: font, contentType: "font/woff2" }));
    await page.route("**/png-capture-*.svg", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="red" d="M0 0h8v8H0z"/></svg>',
      }),
    );
    await gotoCanvas(page, publicExamples[0].slug);
    const result = await page.evaluate(async () => {
      const { toPng, Slicer } = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const style = document.createElement("style");
      style.textContent =
        '@font-face { font-family: "PNG capture"; src: url("/png-capture-font.woff2") format("woff2"); }';
      document.head.append(style);
      const source = document.createElement("div");
      source.textContent = "Embedded resources";
      source.style.cssText =
        'font-family: "PNG capture"; width: 160px; height: 80px; background-image: url("/png-capture-background.svg"); mask-image: url("/png-capture-mask.svg");';
      document.body.append(source);
      const fetch = window.fetch;
      const requests: string[] = [];
      window.fetch = async (url, init) => {
        if (String(url).includes("png-capture-")) requests.push(String(url));
        return fetch(url, init);
      };
      const decode = HTMLImageElement.prototype.decode;
      let svg = "";
      HTMLImageElement.prototype.decode = function () {
        if (this.src.startsWith("data:image/svg+xml;charset=utf-8,"))
          svg = decodeURIComponent(this.src.split(",").slice(1).join(","));
        return decode.call(this);
      };
      const slicer = new Slicer(1);
      try {
        const png = await toPng(
          source,
          {
            width: 160,
            height: 80,
            pixelRatio: 1,
            includeStyleProperties: [
              "font-family",
              "font-size",
              "background-image",
              "mask-image",
              "-webkit-mask-image",
              "width",
              "height",
            ],
          },
          slicer,
        );
        return { png: png.startsWith("data:image/png;base64,"), svg, requests };
      } finally {
        slicer.dispose();
        HTMLImageElement.prototype.decode = decode;
        window.fetch = fetch;
        source.remove();
        style.remove();
      }
    });
    expect(result.png).toBe(true);
    expect(result.requests.some((url) => url.endsWith("png-capture-font.woff2"))).toBe(true);
    for (const name of ["background", "mask"])
      expect(result.requests.some((url) => url.endsWith(`png-capture-${name}.svg`))).toBe(true);
    expect(result.svg).toContain("@font-face");
    expect(result.svg).toMatch(/src:\s*url\(["']?data:application\/font-woff;base64,/);
    for (const property of ["background-image", "mask-image", "-webkit-mask-image"])
      expect(result.svg).toContain(`${property}:url("data:image/svg+xml;base64,`);
    expect(result.svg).not.toContain("png-capture-");
  },
);

test.describe("image resource cancellation", { tag: "@dev" }, () => {
  test("SVG preparation reports visible progress before cloning starts", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const result = await page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`).evaluate(async () => {
      const port = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
      const step = port.Slicer.prototype.step;
      let clones = 0;
      port.Slicer.prototype.step = function () {
        clones++;
        return step.call(this);
      };
      const cancel = new AbortController();
      const progress: number[] = [];
      try {
        const outcome = await image
          .renderDiagramImage("svg", {
            signal: cancel.signal,
            onProgress: (value) => {
              progress.push(value);
              if (value >= 0.1 && value < 0.15) cancel.abort();
            },
          })
          .then(
            () => "exported",
            (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
          );
        return { clones, outcome, progress: progress.at(-1) };
      } finally {
        port.Slicer.prototype.step = step;
      }
    });
    expect(result).toMatchObject({ clones: 0, outcome: "AbortError" });
    expect(result.progress).toBeGreaterThanOrEqual(0.1);
  });

  test("cancelling resource conversion aborts its reader and permits retry", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const node = page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`);
    await expect(node).toBeVisible({ timeout: pageLoadTimeout() });
    const result = await node.evaluate(async (node) => {
      const port = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const NativeReader = window.FileReader,
        fetch = window.fetch;
      const entered = Promise.withResolvers<undefined>();
      const readers: { reader: FileReader; aborted: boolean }[] = [];
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="red" d="M0 0h8v8H0z"/></svg>';
      let fetched = 0;
      window.fetch = async () => {
        fetched++;
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
      };
      window.FileReader = class extends NativeReader {
        override readAsDataURL() {
          readers.push({ reader: this, aborted: false });
          entered.resolve(undefined);
        }
        override abort() {
          const entry = readers.find((entry) => entry.reader === this);
          if (entry) entry.aborted = true;
          super.abort();
        }
      };
      const cancel = new AbortController(),
        slicer = new port.Slicer(1, { signal: cancel.signal });
      const retry = new port.Slicer(1);
      const options = { fontEmbedCSS: "", width: 400, height: 200 };
      const pending = port.toSvgText(node as HTMLElement, options, slicer).then(
        () => "exported",
        (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
      );
      try {
        await entered.promise;
        cancel.abort();
        const outcome = await pending;
        const before = fetched;
        const aborted = readers.every(({ aborted }) => aborted);
        const handlersCleared = readers.every(({ reader }) => reader.onloadend === null && reader.onerror === null);
        window.FileReader = NativeReader;
        const retried = await port.toSvgText(node as HTMLElement, options, retry);
        return {
          outcome,
          readerCount: readers.length,
          aborted,
          handlersCleared,
          fetchedAgain: fetched > before,
          embedded: retried.includes(btoa(svg)),
        };
      } finally {
        window.FileReader = NativeReader;
        window.fetch = fetch;
        slicer.dispose();
        retry.dispose();
      }
    });
    expect(result).toMatchObject({
      outcome: "AbortError",
      aborted: true,
      handlersCleared: true,
      fetchedAgain: true,
      embedded: true,
    });
    expect(result.readerCount).toBeGreaterThan(0);
  });

  test("cancelling a canvas clone releases its stalled decode and cleans image handlers", async ({ page }) => {
    await gotoLive(page, `/?view=canvas&example=${publicExamples[0].slug}&live=1`);
    const result = await page.getByTestId("live-canvas").evaluate(async (canvas) => {
      const port = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const hold = (await import("/src/lib/inputHold.ts" as string)) as typeof import("../../src/lib/inputHold");
      const decode = HTMLImageElement.prototype.decode;
      const started = Promise.withResolvers<HTMLImageElement>();
      const resume = Promise.withResolvers<undefined>();
      HTMLImageElement.prototype.decode = function () {
        started.resolve(this);
        return resume.promise;
      };
      const cancel = new AbortController();
      const slicer = new port.Slicer(1, { signal: cancel.signal });
      const release = hold.holdInput();
      let settled = false;
      const clone = port
        .cloneNode(canvas as HTMLElement, {}, slicer)
        .then(
          () => "cloned",
          (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
        )
        .finally(() => {
          settled = true;
          release();
        });
      try {
        const img = await started.promise;
        cancel.abort();
        // All promise continuations can run, but decode is still held by this test.
        await new Promise((r) => requestAnimationFrame(r));
        const beforeResume = {
          settled,
          held: hold.inputHeld(),
          handlers: img.onload !== null || img.onerror !== null,
          src: img.getAttribute("src"),
        };
        resume.resolve(undefined);
        return { beforeResume, outcome: await clone };
      } finally {
        resume.resolve(undefined);
        release();
        slicer.dispose();
        HTMLImageElement.prototype.decode = decode;
      }
    });
    expect(result).toEqual({
      beforeResume: { settled: true, held: false, handlers: false, src: null },
      outcome: "AbortError",
    });
  });

  test("cancelling icon embedding aborts the fetch and a retry fetches the resource again", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const node = page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`);
    await expect(node).toBeVisible({ timeout: pageLoadTimeout() });
    const result = await node.evaluate(async (node) => {
      const port = (await import(
        "/src/interop/imageClone.ts" as string
      )) as typeof import("../../src/interop/imageClone");
      const fetch = window.fetch;
      const cloneNode = Node.prototype.cloneNode;
      const images: HTMLImageElement[] = [];
      Node.prototype.cloneNode = function (deep) {
        const clone = cloneNode.call(this, deep);
        if (clone instanceof HTMLImageElement) images.push(clone);
        return clone;
      };
      const started = Promise.withResolvers<undefined>();
      const requests: { url: string; signal?: AbortSignal | null }[] = [];
      let blocked = true;
      window.fetch = async (url, init) => {
        requests.push({ url: String(url), signal: init?.signal });
        if (blocked) {
          started.resolve(undefined);
          await new Promise((_, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
          );
        }
        return fetch(url, init);
      };
      const cancel = new AbortController();
      const slicer = new port.Slicer(1, { signal: cancel.signal });
      const options = {
        fontEmbedCSS: "",
        width: 400,
        height: 200,
        includeStyleProperties: ["width", "height", "background-image", "mask-image"],
      };
      const pending = port.toSvgText(node as HTMLElement, options, slicer).then(
        () => "exported",
        (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
      );
      try {
        await started.promise;
        cancel.abort();
        const outcome = await pending;
        const first = [...requests];
        const sourcesCleared = images.length > 0 && images.every((image) => image.getAttribute("src") === null);
        blocked = false;
        const svg = await port.toSvgText(node as HTMLElement, options, new port.Slicer(1));
        return {
          outcome,
          aborted: first.every((r) => r.signal?.aborted),
          retried: first.every((r) => requests.filter((next) => next.url === r.url).length >= 2),
          embedded: svg.includes("data:image/svg+xml;base64,"),
          sourcesCleared,
        };
      } finally {
        window.fetch = fetch;
        Node.prototype.cloneNode = cloneNode;
        slicer.dispose();
      }
    });
    expect(result).toEqual({
      outcome: "AbortError",
      aborted: true,
      retried: true,
      embedded: true,
      sourcesCleared: true,
    });
  });
});

test("cancelling an embedded image load clears its handlers and restored decode", { tag: "@dev" }, async ({ page }) => {
  await gotoCanvas(page, publicExamples[0].slug);
  const node = page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`);
  await expect(node).toBeVisible({ timeout: pageLoadTimeout() });
  const result = await node.evaluate(async (node) => {
    const port = (await import(
      "/src/interop/imageClone.ts" as string
    )) as typeof import("../../src/interop/imageClone");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (!descriptor?.set) throw new Error("no image source setter");
    const setSrc = descriptor.set;
    const originalDecode = HTMLImageElement.prototype.decode;
    const started = Promise.withResolvers<HTMLImageElement>();
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...descriptor,
      set(this: HTMLImageElement, url: string) {
        if (url.startsWith("data:") && !this.isConnected) started.resolve(this);
        else setSrc.call(this, url);
      },
    });
    const cancel = new AbortController();
    const slicer = new port.Slicer(1, { signal: cancel.signal });
    const pending = port.toSvgText(node as HTMLElement, { fontEmbedCSS: "", width: 400, height: 200 }, slicer).then(
      () => "exported",
      (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
    );
    try {
      const image = await started.promise;
      cancel.abort();
      const outcome = await pending;
      // The export and each pending load's cleanup finish in the same microtask turn.
      await new Promise((r) => requestAnimationFrame(r));
      return {
        outcome,
        handlers: image.onload !== null || image.onerror !== null,
        decodeRestored: image.decode === originalDecode,
      };
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", descriptor);
      slicer.dispose();
    }
  });
  expect(result).toEqual({ outcome: "AbortError", handlers: false, decodeRestored: true });
});

test("live counters and export-owned paint keep the document version stable", { tag: "@dev" }, async ({ page }) => {
  await gotoLive(page, `/?view=canvas&example=${publicExamples[0].slug}&live=1`);
  const result = await page.evaluate(async () => {
    const { paletteHost } = (await import("/src/palette/host.ts" as string)) as typeof import("../../src/palette/host");
    const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
    const editor = paletteHost.get().canvas?.editor;
    if (!editor) throw new Error("no editor");
    const version = editor.getDocumentVersion();
    const progress: number[] = [];
    const svg = await image.renderDiagramImage("svg", {
      header: { title: "Live export" },
      check: () => {
        if (editor.getDocumentVersion() !== version) throw new Error("changed");
      },
      onProgress: (done) => progress.push(done),
    });
    return { unchanged: editor.getDocumentVersion() === version, size: svg.size, completed: progress.at(-1) };
  });
  expect(result.unchanged).toBe(true);
  expect(result.size).toBeGreaterThan(0);
  expect(result.completed).toBe(1);
  await expect(page.getByTestId("export-header")).toHaveCount(0);
});
