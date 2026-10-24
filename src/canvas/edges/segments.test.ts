import { describe, expect, it } from "vitest";
import { dragSegment, freezeRoute, normalizeWaypoints, portStub, routeSegments, snapSegment } from "./segments";
import { hasSingleEdgeSelection } from "./singleEdgeSelection";
import { shapedRoute } from "../geometry/shaped";
import { routedPort } from "../geometry/ports";
import type { DiagramFlowEdge, FlowNode } from "../types";
const points = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 200 },
  { x: 300, y: 200 },
];
describe("segment shaping", () => {
  it("identifies orientation and end segments, skipping zero length", () => {
    expect(routeSegments(points).map(({ k, axis, end }) => ({ k, axis, end }))).toEqual([
      { k: 0, axis: "h", end: true },
      { k: 1, axis: "v", end: false },
      { k: 2, axis: "h", end: true },
    ]);
    expect(routeSegments([points[0], points[0]])).toEqual([]);
  });
  it("never treats a diagonal or curve sample as an orthogonal segment", () => {
    expect(
      routeSegments([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual([]);
  });
  it("freezes exactly the drawn nudged corners without aliasing", () => {
    const frozen = freezeRoute(points);
    expect(frozen).toEqual(points.slice(1, -1));
    frozen[0].x = 42;
    expect(points[1].x).toBe(100);
  });
  it("moves an inner segment across itself while its neighbours stretch", () => {
    expect(dragSegment(points, 1, 160)).toEqual([points[0], { x: 160, y: 0 }, { x: 160, y: 200 }, points[3]]);
    expect(points[1].x).toBe(100);
  });
  it("adds two bends to an end and keeps the 24 px port stub", () => {
    expect(dragSegment(points, 0, 60)).toEqual([
      points[0],
      { x: 24, y: 0 },
      { x: 24, y: 60 },
      { x: 100, y: 60 },
      points[2],
      points[3],
    ]);
    const reversed = [...points].reverse();
    expect(dragSegment(reversed, 2, 60)).toEqual(dragSegment(points, 0, 60).reverse());
  });
  it("jogs a straight line with both port stubs intact, even on a short line", () => {
    expect(
      dragSegment(
        [
          { x: 0, y: 0 },
          { x: 90, y: 0 },
        ],
        0,
        30,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 30 },
      { x: 66, y: 30 },
      { x: 66, y: 0 },
      { x: 90, y: 0 },
    ]);
    expect(
      dragSegment(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        0,
        30,
      )[1],
    ).toEqual({ x: 24, y: 0 });
  });
  it.each(["horizontal", "vertical", "reversed"])("keeps a 40 px jog beyond both port escapes: %s", (direction) => {
    const sourceRect = { x: -220, y: -36, width: 220, height: 72 };
    const targetRect = { x: 40, y: -36, width: 220, height: 72 };
    const source = routedPort(sourceRect, "right");
    const target = routedPort(targetRect, "left");
    const transform = ({ x, y }: { x: number; y: number }) =>
      direction === "vertical" ? { x: y, y: x } : direction === "reversed" ? { x: -x, y } : { x, y };
    const original = [source.attachment, target.attachment].map(transform);
    const preview = dragSegment(original, 0, 60);
    expect(preview[1]).toEqual(transform({ x: 24, y: 0 }));
    expect(preview.at(-2)).toEqual(transform({ x: 16, y: 0 }));
    // Compare the actual saved renderer too: dropping must not introduce a detour.
    if (direction === "horizontal")
      expect(shapedRoute(source, "right", target, "left", preview.slice(1, -1), sourceRect, targetRect)).toEqual(
        preview,
      );
  });
  it("merges a jog lined up with its neighbours back to automatic", () => {
    const jog = dragSegment(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
      0,
      60,
    );
    expect(normalizeWaypoints(dragSegment(jog, 2, 0))).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
    expect(normalizeWaypoints(dragSegment(jog, 2, 3))).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
  });
  it("keeps short end legs and inset shape ports outside their escapes", () => {
    const original = [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 100 },
      { x: 32, y: 100 },
    ];
    expect(dragSegment(original, 0, 60)[1]).toEqual({ x: 24, y: 0 });
    expect(dragSegment([...original].reverse(), 0, 60).at(1)).toEqual({ x: 8, y: 100 });
    const rect = { x: -100, y: -36, width: 140, height: 72 };
    const stub = portStub(original[0], "right", rect);
    expect(stub).toBe(56);
    expect(dragSegment(original, 0, 60, [stub, 24])[1]).toEqual({ x: 56, y: 0 });
  });
  it("shares the selection scan across edges and invalidates it on node/edge changes", () => {
    let reads = 0;
    const edges = Array.from({ length: 500 }, () => ({
      get selected() {
        reads++;
        return false;
      },
    })) as DiagramFlowEdge[];
    const nodes: FlowNode[] = [];
    for (let i = 0; i < edges.length; i++) expect(hasSingleEdgeSelection({ nodes, edges })).toBe(false);
    expect(reads).toBe(edges.length);
    const selected = [...edges, { selected: true } as DiagramFlowEdge];
    expect(hasSingleEdgeSelection({ nodes, edges: selected })).toBe(true);
    expect(hasSingleEdgeSelection({ nodes: [{ selected: true } as FlowNode], edges: selected })).toBe(false);
    expect(hasSingleEdgeSelection({ nodes, edges: [...selected, { selected: true } as DiagramFlowEdge] })).toBe(false);
  });
  it("short-leg merging remains orthogonal", () => {
    expect(
      normalizeWaypoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 3 },
        { x: 200, y: 3 },
        { x: 200, y: 100 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });
  it("preserves deliberate bends and collapses duplicate corners", () => {
    expect(normalizeWaypoints(points)).toEqual(points);
    expect(normalizeWaypoints([points[0], ...points])).toEqual(points);
  });
  it("snaps in priority order, uses screen-space thresholds, and guides only alignments", () => {
    const c = { ports: [104], segments: [102], nodes: [101], from: 0, to: 300 };
    expect(snapSegment(100, "v", c, 6)).toEqual({ value: 104, guide: { axis: "x", at: 104, from: 0, to: 300 } });
    expect(snapSegment(100, "v", c, 3).value).toBe(102);
    expect(snapSegment(100, "h", { ...c, ports: [], segments: [] }, 3).guide?.axis).toBe("y");
    expect(snapSegment(118, "h", c, 3)).toEqual({ value: 120 });
    expect(snapSegment(115, "h", c, 3)).toEqual({ value: 115 });
  });
});
