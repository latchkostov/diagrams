import { afterEach, describe, expect, it, vi } from "vitest";

// The one capability check and the canvases' placement over the pane.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Stubs what the worker path needs; `module` says whether Worker reads the `type` option. */
function stubBrowser(module: boolean) {
  // Like the real constructor: options are read, then the unparsable URL throws.
  vi.stubGlobal("Worker", function Worker(_url: string, options?: { type?: string }) {
    if (module) void options?.type;
    throw new SyntaxError("bad URL");
  });
  vi.stubGlobal("OffscreenCanvas", function OffscreenCanvas() {});
  vi.stubGlobal("OffscreenCanvasRenderingContext2D", function OffscreenCanvasRenderingContext2D() {});
  vi.stubGlobal(
    "HTMLCanvasElement",
    class {
      transferControlToOffscreen() {}
    },
  );
}

describe("pickRenderer", () => {
  it("uses the worker where OffscreenCanvas and module workers are available", async () => {
    stubBrowser(true);
    const { pickRenderer } = await import("./liveRenderer");
    expect(pickRenderer("")).toBe("worker");
  });

  it("falls back to the main thread without module workers", async () => {
    stubBrowser(false);
    const { pickRenderer } = await import("./liveRenderer");
    expect(pickRenderer("")).toBe("main");
  });

  it("falls back without OffscreenCanvas (or in Node)", async () => {
    const { pickRenderer } = await import("./liveRenderer");
    expect(pickRenderer("")).toBe("main");
  });

  it("?renderer=main forces the fallback", async () => {
    stubBrowser(true);
    const { pickRenderer } = await import("./liveRenderer");
    expect(pickRenderer("?view=canvas&renderer=main")).toBe("main");
    expect(pickRenderer("?view=canvas&renderer=worker")).toBe("worker");
  });
});

describe("CanvasPlacement", () => {
  it("covers the pane: CSS size, and the inverse of the viewport transform, written only on change", async () => {
    const { CanvasPlacement } = await import("./liveRenderer");
    const writes: string[] = [];
    const el = () => {
      const style = new Proxy({} as Record<string, string>, {
        set(t, key: string, value) {
          writes.push(`${key}=${value}`);
          t[key] = value;
          return true;
        },
      });
      return { style } as unknown as HTMLCanvasElement;
    };
    const a = el();
    const b = el();
    const place = new CanvasPlacement([a, null, b]);
    place.place({ x: 40, y: -20, zoom: 2, width: 800, height: 600, dpr: 1 });
    expect(a.style.width).toBe("800px");
    expect(b.style.height).toBe("600px");
    expect(a.style.transform).toBe("translate(-20px, 10px) scale(0.5)");
    expect(b.style.transform).toBe(a.style.transform);
    const n = writes.length;
    place.place({ x: 40, y: -20, zoom: 2, width: 800, height: 600, dpr: 2 });
    expect(writes.length).toBe(n);
    place.place({ x: 0, y: 0, zoom: 1, width: 800, height: 600, dpr: 2 });
    expect(writes.length).toBe(n + 2);
  });
});
