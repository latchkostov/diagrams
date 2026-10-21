import { describe, expect, it, vi } from "vitest";
import { shapeGeometry } from "./geometry";
import { shapeAttachment, shapeHandle, shapeHandles } from "./attachment";
import { SHAPES_CATALOG } from "./catalog";
import { sidePoint } from "../geometry/ports";
import { Router } from "../geometry/router";

describe("shared shape attachment geometry", () => {
  it("reuses handle geometry without rescanning unchanged outlines", () => {
    const handles = shapeHandles("rounded", 173, 97);
    const scans = vi.spyOn(Math, "hypot");
    try {
      for (let i = 0; i < 1000; i++) {
        expect(shapeHandles("rounded", 173, 97)).toBe(handles);
        for (const side of ["left", "right", "top", "bottom"] as const)
          expect(shapeHandle("rounded", 173, 97, side)).toBe(handles[side]);
      }
      expect(scans).not.toHaveBeenCalled();
      expect(shapeHandles("rounded", 300, 97)).not.toBe(handles);
      expect(shapeHandles("rounded", 173, 120)).not.toBe(handles);
      expect(shapeHandles("tri", 173, 97)).not.toBe(handles);
    } finally {
      scans.mockRestore();
    }
  });
  it.each(["tri", "flip-tri"] as const)("attaches %s to the visible sloped sides", (shape) => {
    expect(shapeAttachment(shape, 160, 90, "left")).toEqual({ x: 40.375, y: 45 });
    expect(shapeAttachment(shape, 160, 90, "right")).toEqual({ x: 119.625, y: 45 });
  });
  it("keeps the narrow Delay arc inside the outline bounds", () => {
    const geometry = shapeGeometry("delay", 40, 100)[0];
    expect(geometry.d).toContain("A15.4,49.25");
    expect(shapeAttachment("delay", 40, 100, "right").x).toBeCloseTo(39.25);
  });
  for (const { id: shape } of SHAPES_CATALOG)
    it(`${shape}: routes and handles share geometry at varied sizes and offsets`, () => {
      for (const [width, height] of [
        [160, 90],
        [40, 100],
        [400, 90],
      ]) {
        for (const side of ["left", "right", "top", "bottom"] as const)
          for (const offset of [-7, 0, 7]) {
            const p = shapeAttachment(shape, width, height, side, offset);
            expect(p.x).toBeGreaterThanOrEqual(-0.01);
            expect(p.x).toBeLessThanOrEqual(width + 0.01);
            expect(p.y).toBeGreaterThanOrEqual(-0.01);
            expect(p.y).toBeLessThanOrEqual(height + 0.01);
            expect(sidePoint({ x: 10, y: 20, width, height, shape }, side, offset)).toEqual({
              x: p.x + 10,
              y: p.y + 20,
            });
          }
      }
    });
  it("invalidates cached routes when only the outline changes", () => {
    const router = new Router();
    const input = {
      nodes: [
        { id: "a", rect: { x: 0, y: 0, width: 160, height: 90, shape: "rect" as const } },
        { id: "b", rect: { x: 400, y: 0, width: 160, height: 90 } },
      ],
      edges: [{ id: "e", source: "a", target: "b" }],
    };
    const before = router.route(input).get("e")!;
    const after = router
      .route({
        ...input,
        nodes: [{ ...input.nodes[0], rect: { ...input.nodes[0].rect, shape: "tri" } }, input.nodes[1]],
      })
      .get("e")!;
    expect(before.points[0].x).toBe(159.25);
    expect(after.points[0].x).toBe(119.625);
    expect(after.path).not.toBe(before.path);
  });
});

it.each(["hourglass", "comment", "brace-r"] as const)("keeps opposite %s handles independently hittable", (shape) => {
  const left = shapeHandle(shape, 160, 90, "left"),
    right = shapeHandle(shape, 160, 90, "right");
  expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(14);
});
