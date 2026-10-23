import { describe, expect, it } from "vitest";
import {
  CONNECT_RADIUS,
  connectionRadius,
  connectTarget,
  edgesBetween,
  pickInBox,
  portAt,
  portSide,
  type BoxItem,
} from "./gestures";
import { shapeHandles } from "./shapes/attachmentGeometry";
import { pickSides } from "./edges/routing";

describe("attaching to measured dots", () => {
  it("finds the nearest card dot within the radius", () => {
    const handles = [
      { id: "left", x: 0, y: 36 },
      { id: "top", x: 110, y: 0 },
      { id: "right", x: 220, y: 36 },
      { id: "bottom", x: 110, y: 72 },
    ];
    expect(portAt({ x: 112, y: 75 }, handles, CONNECT_RADIUS)).toBe("bottom");
    expect(portAt({ x: 110, y: 36 }, handles, CONNECT_RADIUS)).toBeUndefined();
    expect(portAt({ x: -29, y: 36 }, handles, CONNECT_RADIUS)).toBeUndefined();
  });
  it.each(["tri", "ellipse"] as const)("uses the measured %s outline positions", (shape) => {
    const handles = Object.entries(shapeHandles(shape, 160, 90)).map(([id, p]) => ({ id, x: 300 + p.x, y: 200 + p.y }));
    for (const handle of handles) expect(portAt(handle, handles, 1)).toBe(handle.id);
  });
  it("grow and unknown handles never pin a side or mask a nearby dot", () => {
    expect(portSide("grow")).toBeUndefined();
    expect(portAt({ x: 0, y: 0 }, [{ id: "grow", x: 0, y: 0 }], 28)).toBeUndefined();
    expect(
      portAt(
        { x: 0, y: 0 },
        [
          { id: "grow", x: 0, y: 0 },
          { id: "left", x: 4, y: 0 },
        ],
        28,
      ),
    ).toBe("left");
    expect(portSide("north")).toBeUndefined();
  });
  it("keeps 20 screen pixels at low zoom and changes only at zoom steps", () => {
    for (const zoom of [0.1, 0.21, 0.49, 0.71, 1, 2]) {
      expect(connectionRadius(zoom)).toBeGreaterThanOrEqual(CONNECT_RADIUS);
      expect(connectionRadius(zoom) * zoom).toBeGreaterThanOrEqual(20);
    }
    expect(connectionRadius(0.51)).toBe(connectionRadius(0.54));
  });
});

describe("connectTarget: what a connection drop does", () => {
  it("connects to a card dropped anywhere on it", () => {
    expect(connectTarget({ canvas: true, node: { id: "b", type: "diagram" } }, "a")).toEqual({ kind: "node", id: "b" });
  });

  it("connects to a shape, the one annotation that takes edges", () => {
    const hit = { canvas: true, node: { id: "s", type: "annotation", annotation: "shape" as const } };
    expect(connectTarget(hit, "a")).toEqual({ kind: "node", id: "s" });
  });

  it("refuses texts and notes (not-allowed), and treats a zone as canvas", () => {
    for (const kind of ["text", "note"] as const)
      expect(connectTarget({ canvas: true, node: { id: "t", type: "annotation", annotation: kind } }, "a").kind).toBe(
        "invalid",
      );
    expect(connectTarget({ canvas: true, node: { id: "z", type: "annotation", annotation: "zone" } }, "a").kind).toBe(
      "canvas",
    );
  });

  it("does nothing back over the source, and nothing over chrome or outside the canvas", () => {
    expect(connectTarget({ canvas: true, node: { id: "a", type: "diagram" } }, "a").kind).toBe("source");
    expect(connectTarget({ canvas: true, chrome: true }, "a").kind).toBe("outside");
    expect(connectTarget({ canvas: false }, "a").kind).toBe("outside");
  });

  it("opens quick-add over empty canvas, inside a boundary too", () => {
    expect(connectTarget({ canvas: true }, "a").kind).toBe("canvas");
    expect(connectTarget({ canvas: true, node: { id: "group:g", type: "boundary" } }, "a").kind).toBe("canvas");
  });
});

describe("a drop on a node's body meets the side facing the source", () => {
  const card = (x: number, y: number) => ({ x, y, width: 180, height: 64 });
  it("left side for a target to the right, top for one below, right for one to the left", () => {
    expect(pickSides(card(0, 0), card(400, -100)).targetSide).toBe("left");
    expect(pickSides(card(0, 0), card(0, 300)).targetSide).toBe("top");
    expect(pickSides(card(600, 0), card(0, 20)).targetSide).toBe("right");
  });
});

describe("pickInBox: the selection box", () => {
  const items: BoxItem[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 200, y: 0, width: 100, height: 50 },
    { id: "boundary", x: -20, y: -20, width: 400, height: 100, backdrop: true },
  ];

  it("picks what it touches", () => {
    expect(pickInBox(items, { x: 80, y: 10, width: 150, height: 10 })).toEqual(["a", "b"]);
  });

  it("with Ctrl/Cmd, picks only what's wholly inside", () => {
    expect(pickInBox(items, { x: 80, y: -5, width: 230, height: 60 }, true)).toEqual(["b"]);
  });

  it("never picks a boundary it only touches (a box among its nodes)", () => {
    expect(pickInBox(items, { x: 10, y: 10, width: 20, height: 20 })).toEqual(["a"]);
    expect(pickInBox(items, { x: -30, y: -30, width: 420, height: 120 })).toEqual(["a", "b", "boundary"]);
  });
});

describe("edgesBetween", () => {
  it("takes only the edges whose both ends were picked", () => {
    const edges = [
      { id: "ab", source: "a", target: "b" },
      { id: "ac", source: "a", target: "c" },
    ];
    expect([...edgesBetween(edges, new Set(["a", "b"]))]).toEqual(["ab"]);
  });
});
