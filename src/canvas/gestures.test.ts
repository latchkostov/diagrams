import { describe, expect, it } from "vitest";
import { connectTarget, edgesBetween, pickInBox, type BoxItem } from "./gestures";
import { pickSides } from "./edges/routing";

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
