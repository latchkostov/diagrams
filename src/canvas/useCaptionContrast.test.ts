import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toFlow } from "./convert";
import { countingReads } from "../test/complexity";
import { captionContrastKey, createCaptionContrastKey, CAPTION_WORK_LIMIT } from "./useCaptionContrast";
let SpatialGrid: typeof import("./geometry/spatial").SpatialGrid;
let measureCaptionContrast: typeof import("./useCaptionContrast").measureCaptionContrast;
let colors: typeof import("../model/colors");
beforeEach(async () => {
  vi.resetModules();
  ({ measureCaptionContrast } = await import("./useCaptionContrast"));
  colors = await import("../model/colors");
  ({ SpatialGrid } = await import("./geometry/spatial"));
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
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `group-g${i}`,
      x: i < 10 ? 10000 : 0,
      width: i < 10 ? 1000000 : 200,
      fill: "white-five-percent",
    })),
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

it("retries incomplete contrast when removing earlier captions frees the budget", () => {
  const nodes = fixture(11);
  for (const n of nodes) if (n.type === "annotation") n.data.color = "#111111";
  nodes.push(
    ...toFlow({
      format: "diagrams/v1",
      title: "Recovery",
      nodes: [],
      edges: [],
      groups: Array.from({ length: 1000 }, (_, i) => ({
        id: `g${i}`,
        label: "Region",
        x: 0,
        y: 0,
        width: 200,
        height: 30,
      })),
    }).nodes,
  );
  const s = surface([
    ...Array.from({ length: 11 }, (_, i) => ({ id: `annotation-c${i}`, x: 0, width: 200 })),
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `group-g${i}`,
      x: i < 10 ? 10000 : 0,
      width: i < 10 ? 1000000 : 200,
      fill: "white-five-percent",
    })),
  ]);
  measureCaptionContrast(s.canvas, nodes, background);
  expect(s.writes.get("annotation-c10")).toBe("var(--text)");
  measureCaptionContrast(
    s.canvas,
    nodes.filter((n) => n.type !== "annotation" || n.id === "c10"),
    background,
  );
  expect(s.writes.get("annotation-c10")).toBe("#111111");
});

it("composites overlapping translucent fills before choosing ink", () => {
  const nodes = fixture();
  nodes.push(
    ...toFlow({
      format: "diagrams/v1",
      title: "Paint",
      nodes: [],
      edges: [],
      groups: ["a", "b"].map((id) => ({ id, label: id, x: 0, y: 0, width: 100, height: 30 })),
    }).nodes,
  );
  const entries = [
    { id: "annotation-c0", x: 0, width: 200 },
    { id: "group-a", x: 0, width: 100, fill: "black-five-percent" },
    { id: "group-b", x: 0, width: 100, fill: "black-five-percent" },
  ];
  const s = surface(entries);
  for (const omitted of ["a", "b"]) {
    measureCaptionContrast(
      s.canvas,
      nodes.filter((n) => n.type !== "boundary" || n.data.groupId !== omitted),
      background,
    );
    expect(s.writes.get("annotation-c0")).toBe("#696969");
  }
  measureCaptionContrast(s.canvas, nodes, background);
  expect(s.writes.get("annotation-c0")).toBe("var(--text)");
  entries[2].x = 100;
  measureCaptionContrast(s.canvas, nodes, background);
  expect(s.writes.get("annotation-c0")).toBe("#696969");
});

it("retries when exactly one newly available operation completes the evaluation", () => {
  // Full captions cost 32 operations (16 query + 16 contrast); the two prefix
  // variants cost 16 and 17. Total work is 32,769, so the final contrast check
  // exhausts the shared 32,768 budget. Changing the 17-op prefix frees exactly one.
  const nodes = fixture(1025);
  for (const n of nodes) if (n.type === "annotation") n.data.color = n.id === "c1022" ? "#ffffff" : "#111111";
  nodes.push(
    ...toFlow({
      format: "diagrams/v1",
      title: "Exact recovery",
      nodes: [],
      edges: [],
      groups: Array.from({ length: 15 }, (_, i) => ({
        id: `g${i}`,
        label: "Region",
        x: 0,
        y: 0,
        width: 100,
        height: 30,
      })),
    }).nodes,
  );
  const s = surface([
    ...Array.from({ length: 1025 }, (_, i) => ({
      id: `annotation-c${i}`,
      x: i === 1023 ? 110 : 0,
      width: i === 1023 ? 10 : 100,
    })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `group-g${i}`, x: 0, width: 100, fill: "white-five-percent" })),
  ]);
  measureCaptionContrast(s.canvas, nodes, background);
  expect(s.writes.get("annotation-c1024")).toBe("var(--text)");
  const freed = nodes.map((n) =>
    n.type === "annotation" && n.id === "c1023" ? { ...n, data: { ...n.data, color: "#ffffff" } } : n,
  );
  measureCaptionContrast(s.canvas, freed, background);
  expect(s.writes.get("annotation-c1024")).toBe("#111111");
});

it("does not serialize unrelated text or unchanged caption projections during service moves", () => {
  const nodes = fixture();
  const note = toFlow({
    format: "diagrams/v1",
    title: "Notes",
    nodes: [],
    edges: [],
    annotations: [{ id: "note", kind: "note", text: "", x: 0, y: 0, width: 200, height: 100 }],
  }).nodes[0];
  Object.defineProperty(note.data, "text", {
    get() {
      throw new Error("Unrelated note text was read");
    },
  });
  const keyOf = createCaptionContrastKey();
  expect(keyOf([note])).toBe("");
  const before = keyOf([...nodes, note]);
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    for (let move = 0; move < 60; move++) {
      expect(
        keyOf([...nodes.map((n) => (n.type === "diagram" ? { ...n, position: { x: move, y: 0 } } : n)), note]),
      ).toBe(before);
    }
    expect(stringify).not.toHaveBeenCalled();
  } finally {
    stringify.mockRestore();
  }
});

it("bounds actual spatial visits across cached and exhausted passes", () => {
  const nodes = fixture(2000);
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
        height: 30,
      })),
    }).nodes,
  );
  const s = surface([
    ...Array.from({ length: 2000 }, (_, i) => ({ id: `annotation-c${i}`, x: 0, width: 200 })),
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `group-g${i}`,
      x: i < 10 ? 10000 : 0,
      width: i < 10 ? 1000000 : 200,
      fill: "white-five-percent",
    })),
  ]);
  const query = SpatialGrid.prototype.query;
  let cells = 0;
  let abortedVisits = 0;
  let aborted = 0;
  let returned = 0;
  const counters: (() => number)[] = [];
  const instrumented = new WeakSet<object>();
  const reads = () => counters.reduce((total, count) => total + count(), 0);
  const spy = vi.spyOn(SpatialGrid.prototype, "query").mockImplementation(function (
    this: import("./geometry/spatial").SpatialGrid<unknown>,
    box,
    budget,
  ) {
    // Observe the underlying data, independently of query's budget and deduplicated output.
    // Every yielded array entry counts, including repeats and entries from an aborted scan.
    const grid = this as unknown as {
      cells: Map<number, Map<number, unknown[]>>;
      entries: unknown[];
      overflow: unknown[];
    };
    if (!instrumented.has(grid)) {
      instrumented.add(grid);
      const wrap = (items: unknown[]) => {
        const counted = countingReads(items);
        counters.push(counted.reads);
        return counted.items;
      };
      grid.entries = wrap(grid.entries);
      grid.overflow = wrap(grid.overflow);
      for (const column of grid.cells.values()) {
        for (const [key, entries] of column) column.set(key, wrap(entries));
        const get = column.get.bind(column);
        column.get = (key) => {
          cells++;
          return get(key);
        };
      }
      const get = grid.cells.get.bind(grid.cells);
      grid.cells.get = (key) => {
        cells++;
        return get(key);
      };
    }
    const before = reads() + cells;
    const hits = query.call(this, box, budget!);
    if (hits === null) {
      aborted++;
      abortedVisits += reads() + cells - before;
    }
    returned += hits?.length ?? 0;
    return hits;
  });
  try {
    for (let pass = 0; pass < 2; pass++) {
      const before = reads() + cells;
      abortedVisits = aborted = returned = 0;
      measureCaptionContrast(s.canvas, nodes, background);
      const visits = reads() + cells - before;
      expect(cells).toBeGreaterThan(0);
      expect(visits).toBeGreaterThan(returned);
      // A scan can yield one entry just before discovering the exhausted budget.
      expect(visits).toBeLessThanOrEqual(CAPTION_WORK_LIMIT + 1);
      expect(aborted).toBeGreaterThan(0);
      expect(abortedVisits).toBeGreaterThan(0);
    }
  } finally {
    spy.mockRestore();
  }
});
