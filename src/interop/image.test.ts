import { expect, it, vi } from "vitest";
import { renderDiagramImage } from "./image";
import { whenShapeGeometryReady } from "../canvas/shapes/readiness";
import { whenEdgeGeometryReady } from "../canvas/edges/imageReadiness";
vi.mock("../canvas/edges/imageReadiness", () => ({ whenEdgeGeometryReady: vi.fn() }));
vi.mock("../canvas/shapes/readiness", () => ({ whenShapeGeometryReady: vi.fn() }));
vi.mock("../lib/inputHold", () => ({ holdInput: () => () => {} }));

it("does not measure export bounds until pending saved-route geometry is ready", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(whenEdgeGeometryReady).mockReturnValue(held);
  const measure = vi.fn(() => []);
  vi.stubGlobal("document", { querySelector: () => ({ querySelectorAll: measure }) });
  try {
    const rendering = renderDiagramImage("svg").catch((error: unknown) => error);
    await Promise.resolve();
    expect(measure).not.toHaveBeenCalled();
    release();
    expect(await rendering).toEqual(new Error("This diagram is empty, so there's nothing to export."));
    expect(measure).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("inserts an ordinary export header before yielding", async () => {
  vi.mocked(whenEdgeGeometryReady).mockReturnValue(undefined);
  const stop = new Error("stop capture after header setup");
  vi.mocked(whenShapeGeometryReady).mockRejectedValue(stop);
  const append = vi.fn();
  const viewport = {
    append,
    querySelectorAll: (selector: string) =>
      selector === ".react-flow__node"
        ? [{ style: { transform: "translate(0px,0px)" }, offsetWidth: 220, offsetHeight: 72 }]
        : [],
  };
  vi.stubGlobal("document", {
    querySelector: () => viewport,
    createElement: () => ({ dataset: {}, style: {}, append: vi.fn(), remove: vi.fn() }),
  });
  try {
    const rendering = renderDiagramImage("svg", { header: { title: "Example" } }).catch((error: unknown) => error);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await rendering).toBe(stop);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("filters segment handles and the dashed shaping preview from images", async () => {
  const { imageNodeFilter } = await import("./image");
  class Element {
    classList: { contains(value: string): boolean };
    constructor(cls: string) {
      this.classList = { contains: (value) => value === cls };
    }
  }
  class Svg extends Element {}
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("SVGElement", Svg);
  try {
    expect(imageNodeFilter(new Element("edge-seg") as unknown as Node)).toBe(false);
    expect(imageNodeFilter(new Svg("edge-route-preview") as unknown as Node)).toBe(false);
    expect(imageNodeFilter(new Svg("fe-path") as unknown as Node)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
