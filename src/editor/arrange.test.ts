import { describe, expect, it } from "vitest";
import { align, boundaryAround, boundingBox, distribute, type Box } from "./arrange";

const boxes: Box[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 40 },
  { id: "b", x: 200, y: 50, width: 50, height: 20 },
  { id: "c", x: 120, y: 200, width: 80, height: 60 },
];

describe("arrange", () => {
  it("bounding box", () => {
    expect(boundingBox(boxes)).toEqual({ x: 0, y: 0, width: 250, height: 260 });
  });

  it("aligns edges and centres", () => {
    expect(align(boxes, "left").get("b")).toEqual({ x: 0, y: 50 });
    expect(align(boxes, "right").get("a")).toEqual({ x: 150, y: 0 });
    expect(align(boxes, "center").get("b")).toEqual({ x: 100, y: 50 });
    expect(align(boxes, "top").get("c")).toEqual({ x: 120, y: 0 });
    expect(align(boxes, "bottom").get("a")).toEqual({ x: 0, y: 220 });
    expect(align(boxes, "middle").get("b")).toEqual({ x: 200, y: 120 });
  });

  it("distributes with equal gaps, keeping the outer boxes", () => {
    const row: Box[] = [
      { id: "a", x: 0, y: 0, width: 100, height: 10 },
      { id: "b", x: 130, y: 0, width: 50, height: 10 },
      { id: "c", x: 400, y: 0, width: 100, height: 10 },
    ];
    const p = distribute(row, "h");
    expect(p.get("a")).toEqual({ x: 0, y: 0 });
    expect(p.get("c")).toEqual({ x: 400, y: 0 });
    // span 500, sizes 250, gap 125: b starts at 100 + 125.
    expect(p.get("b")).toEqual({ x: 225, y: 0 });
    const v = distribute(boxes, "v");
    expect(v.get("a")!.y).toBe(0);
    expect(v.get("c")!.y).toBe(200);
  });

  it("distribute needs three boxes", () => {
    const p = distribute(boxes.slice(0, 2), "h");
    expect(p.get("b")).toEqual({ x: 200, y: 50 });
  });

  it("boundary leaves padding and room for the label", () => {
    expect(boundaryAround([{ id: "a", x: 100, y: 100, width: 200, height: 80 }])).toEqual({
      x: 60,
      y: 36,
      width: 280,
      height: 184,
    });
  });
});
