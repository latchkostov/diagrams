import { describe, expect, it } from "vitest";
import { dragSegment, freezeRoute, normalizeWaypoints, routeSegments, snapSegment } from "./segments";
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
    ).toEqual({ x: 10, y: 0 });
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
