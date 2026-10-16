import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import * as sizing from "../canvas/nodes/size";
import * as refitting from "../editor/boundaryFit";
import { overlaps } from "../canvas/placement";
import { boundaryAround } from "../editor/arrange";
import { layeredLayout } from "../editor/layout";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import { fitGroups, placeNew } from "./place";
import { layoutDiagram } from "./skill/layout";
import { fileToDiagram } from "./ui/apply";

afterEach(() => vi.restoreAllMocks());

const nested = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Nested placement",
  nodes: [{ id: "service", stencil: "generic.service", label: "Service", group: "inner", x: 0, y: 0 }],
  edges: [],
  groups: [
    { id: "outer", label: "Outer", x: -500, y: -500, width: 2000, height: 2000 },
    { id: "inner", label: "Inner", group: "outer", x: -300, y: -300, width: 1000, height: 1000 },
  ],
});

function expectContained(d: DiagramFile) {
  const [outer, inner] = d.groups!;
  const node = d.nodes[0];
  expect(inner).toMatchObject(boundaryAround([{ ...node, ...sizing.estimateCardSize(node.label) }]));
  expect(outer).toMatchObject(boundaryAround([inner]));
  expect(node.group).toBe("inner");
  expect(inner.group).toBe("outer");
}

it.each(["full", "incremental", "none"] as const)("keeps descendants in all ancestors in %s placement", (mode) => {
  const d = nested();
  const placed = placeNew(d, ["service"], mode);
  expectContained(placed);
  if (mode === "full") expect(placed.nodes[0]).toMatchObject(layeredLayout(d).get("service")!);
  // In incremental placement the available space inside the original ancestors is usable.
  if (mode !== "full") {
    expect(placed.nodes[0].x).toBe(40);
    expect(placed.nodes[0].y).toBe(64);
  }
  expect(d).toEqual(nested());
});

it.each([false, true])("keeps nested full skill layouts contained (force=%s)", (force) => {
  const d = nested();
  const input = { ...d, nodes: d.nodes.map(({ x, y, ...n }) => (force ? { ...n, x, y } : n)) };
  const result = layoutDiagram(input, { force });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const placed = result.diagram as unknown as DiagramFile;
    expectContained(placed);
    expect(placed.nodes[0]).toMatchObject(layeredLayout(d).get("service")!);
  }
});

it("refits relocated members and their ancestors together after foreign-boundary collisions", () => {
  const d = nested();
  const preparations = vi.spyOn(refitting, "createBoundaryRefitter");
  const rebuilds = vi.spyOn(refitting, "planBoundaryRefits");
  // An empty, unrelated boundary retains its box over the full layout's initial service position.
  d.groups!.push({ id: "foreign", label: "Foreign", x: 0, y: 0, width: 300, height: 200 });
  const result = placeNew(d, ["service"], "full");
  expect(overlaps({ ...result.nodes[0], ...sizing.estimateCardSize("Service") }, d.groups![2])).toBe(false);
  expect(result.nodes[0]).not.toMatchObject(layeredLayout(d).get("service")!);
  expectContained(result);
  expect(preparations).toHaveBeenCalledTimes(1);
  expect(rebuilds).not.toHaveBeenCalled();
});

it.each(["skill", "paste"] as const)("batches unboxed boundary geometry once in %s at 8x boundaries", (path) => {
  const sizes = vi.spyOn(sizing, "estimateCardSize");
  const plans = vi.spyOn(refitting, "planBoundaryRefits");
  const run = (count: number) => {
    sizes.mockClear();
    plans.mockClear();
    const input = {
      format: "diagrams/v1",
      title: "Many boundaries",
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        stencil: "generic.service",
        label: "Service",
        group: `g${i}`,
        x: i * 400,
        y: 0,
      })),
      edges: [],
      groups: Array.from({ length: count }, (_, i) => ({ id: `g${i}`, label: "Boundary" })),
    };
    const result = path === "skill" ? layoutDiagram(input) : fileToDiagram(input);
    expect(result.ok).toBe(true);
    return sizes.mock.calls.length;
  };
  const small = run(16);
  const large = run(16 * GROWTH_FACTOR);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
  expect(plans).toHaveBeenCalledTimes(1);
});

it("skips geometry entirely when no boundary needs fitting", () => {
  const d = nested();
  const sizes = vi.spyOn(sizing, "estimateCardSize");
  const plans = vi.spyOn(refitting, "planBoundaryRefits");
  expect(fitGroups(d, new Set())).toBe(d);
  expect(plans).not.toHaveBeenCalled();
  expect(sizes).not.toHaveBeenCalled();
});

it.each(["skill", "paste"] as const)("fits unboxed nested boundaries bottom-up once in %s", (path) => {
  const d = nested();
  const input = { ...d, groups: d.groups!.map(({ id, label, group }) => ({ id, label, group })) };
  const result = path === "skill" ? layoutDiagram(input) : fileToDiagram(input);
  expect(result.ok).toBe(true);
  if (result.ok) expectContained(result.diagram as unknown as DiagramFile);
});
