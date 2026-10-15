import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toFlow } from "./convert";
import { captionContrastKey, CAPTION_WORK_LIMIT } from "./useCaptionContrast";
let measureCaptionContrast: typeof import("./useCaptionContrast").measureCaptionContrast;
let colors: typeof import("../model/colors");
beforeEach(async () => {
  vi.resetModules();
  ({ measureCaptionContrast } = await import("./useCaptionContrast"));
  colors = await import("../model/colors");
});

afterEach(() => vi.unstubAllGlobals());

it("shares background conversion across captions and refreshes contrast when regions move", () => {
  const readback = vi.fn(() => ({ data: [47, 128, 237, 13] }));
  const createElement = vi.fn(() => ({
    getContext: () => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", getImageData: readback }),
  }));
  vi.stubGlobal("document", { createElement });
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("getComputedStyle", () => ({ backgroundColor: "azure-fill" }));
  const rect = (x: number) => ({ left: x, right: x + 200, top: 0, bottom: 100 }) as DOMRect;
  let regionX = 1000;
  const inks = new Map<string, string>();
  const canvas = {
    querySelectorAll: () =>
      ["group-g", ...Array.from({ length: 100 }, (_, i) => `annotation-c${i}`)].map((selector) => ({
        dataset: { testid: selector },
        getBoundingClientRect: () => rect(selector.includes("group-") ? regionX : 0),
        style: { setProperty: (_key: string, value: string) => inks.set(selector, value) },
      })),
  } as unknown as HTMLElement;
  const nodes = toFlow({
    format: "diagrams/v1",
    title: "Captions",
    nodes: [],
    edges: [],
    groups: [{ id: "g", label: "Region", x: 1000, y: 0, width: 200, height: 100 }],
    annotations: Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      kind: "text",
      text: "Caption",
      color: "#707070",
      x: 0,
      y: 0,
      width: 200,
      height: 30,
    })),
  }).nodes;
  const background = { r: 250, g: 250, b: 250, a: 1 };
  measureCaptionContrast(canvas, nodes, background);
  expect(inks.size).toBe(100);
  expect([...inks.values()].every((ink) => ink === "#707070")).toBe(true);
  regionX = 0;
  inks.clear();
  measureCaptionContrast(canvas, nodes, background);
  expect(inks.size).toBe(100);
  expect([...inks.values()].every((ink) => ink === "var(--text)")).toBe(true);
  expect(createElement).toHaveBeenCalledTimes(1);
  expect(readback).toHaveBeenCalledTimes(1);
});

function fixture(count = 1) {
  return toFlow({
    format: "diagrams/v1",
    title: "Contrast",
    nodes: [{ id: "service", label: "Service", stencil: "service.dotnet", x: 0, y: 0 }],
    edges: [],
    groups: [],
    annotations: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      kind: "text" as const,
      text: "Caption",
      color: "#696969",
      x: 0,
      y: 0,
      width: 200,
      height: 30,
    })),
  }).nodes;
}
const background = { r: 250, g: 250, b: 250, a: 1 };
function surface(entries: { id: string; x: number; width: number; fill?: string; descendant?: boolean }[]) {
  const writes = new Map<string, string>();
  const reads = vi.fn();
  const canvas = {
    querySelectorAll: (selector: string) =>
      entries
        .filter((e) => selector !== "[data-caption-root]" || !e.descendant)
        .map((e) => ({
          dataset: { testid: e.id },
          getBoundingClientRect: () => {
            reads();
            return { left: e.x, right: e.x + e.width, top: 0, bottom: 30 };
          },
          fill: e.fill,
          style: {
            setProperty: (_: string, ink: string) => writes.set(e.descendant ? `descendant:${e.id}` : e.id, ink),
          },
        })),
  } as unknown as HTMLElement;
  vi.stubGlobal("getComputedStyle", (el: { fill: string }) => ({ backgroundColor: el.fill }));
  vi.stubGlobal("document", {
    createElement: () => {
      let fill = "";
      return {
        getContext: () => ({
          clearRect() {},
          fillRect() {},
          set fillStyle(value: string) {
            fill = value;
          },
          getImageData: () => ({ data: fill === "white-five-percent" ? [255, 255, 255, 13] : [0, 0, 0, 13] }),
        }),
      };
    },
  });
  return { canvas, writes, reads };
}

it("targets renderer roots even when descendant test IDs collide", () => {
  const nodes = fixture();
  const caption = nodes.find((n) => n.id === "c0")!;
  caption.id = "text-caption";
  const s = surface([
    { id: "annotation-text-caption", x: 0, width: 200 },
    { id: "annotation-text-caption", x: 0, width: 200, descendant: true },
  ]);
  measureCaptionContrast(s.canvas, nodes, background);
  expect(s.writes).toEqual(new Map([["annotation-text-caption", "#696969"]]));
});

it.each([false, true])("checks adjacent fills independently of their order (%s)", (reverse) => {
  const nodes = fixture();
  const regions = [
    { id: "white", label: "White", x: 0, y: 0, width: 100, height: 30, tone: "#ffffff" },
    { id: "black", label: "Black", x: 100, y: 0, width: 100, height: 30, tone: "#000000" },
  ];
  nodes.push(
    ...toFlow({
      format: "diagrams/v1",
      title: "Regions",
      nodes: [],
      edges: [],
      groups: reverse ? regions.reverse() : regions,
    }).nodes,
  );
  const s = surface([
    { id: "annotation-c0", x: 0, width: 200 },
    { id: "group-white", x: 0, width: 100, fill: "white-five-percent" },
    { id: "group-black", x: 100, width: 100, fill: "black-five-percent" },
  ]);
  measureCaptionContrast(s.canvas, nodes, { r: 244.5, g: 244.5, b: 244.5, a: 1 });
  expect(s.writes.get("annotation-c0")).toBe("var(--text)");
});

it("selection and service updates leave the measurement key unchanged", () => {
  const nodes = fixture();
  const before = captionContrastKey(nodes);
  const edited = nodes.map((n) =>
    n.type === "diagram"
      ? { ...n, selected: true, position: { x: 100, y: 200 }, data: { ...n.data, label: "Edited" } }
      : { ...n, selected: true },
  );
  expect(captionContrastKey(edited)).toBe(before);
  const moved = nodes.map((n) => (n.type === "annotation" ? { ...n, position: { x: 100, y: 200 } } : n));
  expect(captionContrastKey(moved)).not.toBe(before);
});

it("caches unaffected captions and bounds dense overlap calculations", () => {
  const nodes = fixture(2000);
  for (const n of nodes) if (n.type === "annotation") n.data.color = "#111111";
  nodes.push(
    ...toFlow({
      format: "diagrams/v1",
      title: "Dense",
      nodes: [],
      edges: [],
      groups: Array.from({ length: 1000 }, (_, i) => ({
        id: `g${i}`,
        label: "Region",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      })),
    }).nodes,
  );
  const s = surface([
    ...Array.from({ length: 2000 }, (_, i) => ({ id: `annotation-c${i}`, x: 0, width: 200 })),
    ...Array.from({ length: 1000 }, (_, i) => ({ id: `group-g${i}`, x: 0, width: 200, fill: "white-five-percent" })),
  ]);
  const accessible = vi.spyOn(colors, "accessibleColor");
  try {
    measureCaptionContrast(s.canvas, nodes, background);
    expect(s.writes.size).toBe(2000);
    expect(s.writes.get("annotation-c0")).toBe("#111111");
    expect(s.writes.get("annotation-c1999")).toBe("var(--text)");
    expect(accessible.mock.calls.length).toBeLessThanOrEqual(CAPTION_WORK_LIMIT);
    const count = accessible.mock.calls.length;
    measureCaptionContrast(s.canvas, nodes, background);
    expect(accessible.mock.calls.length).toBe(count);
  } finally {
    accessible.mockRestore();
  }
});
