import { test, expect, gotoCanvas, gotoLive, publicExamples, pageLoadTimeout } from "./fixtures";

test.describe("image resource cancellation", { tag: "@dev" }, () => {
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
