import { describe, expect, it } from "vitest";
import { drawTile, textDetail, frameView } from "./detail";
import {
  cullLabel,
  fitRectangle,
  visibleCanvas,
  edgeInFrame,
  frameCrossing,
  innerFrame,
  oneHop,
  placeFrameLabel,
  stackPins,
} from "./camera/frameEdges";
import { intersects } from "./geometry/rect";
import { decide, initialPolicy } from "./camera/panePolicy";

describe("Workbench frame detail", () => {
  it("never paints text below the floor; only active text scales in Focus", () => {
    for (const view of ["overview", "focus", "follow", "custom"] as const)
      for (const active of [true, false])
        for (const zoom of [0.2, 0.59, 0.6, 0.75, 0.9, 1, 1.25])
          for (const font of [8, 10, 11, 12, 14]) {
            const detail = textDetail(font, zoom, active, view);
            if (detail.show) expect(font * zoom * detail.scale).toBeGreaterThanOrEqual(10.5);
          }
    expect(textDetail(11, 0.75, true, "focus").show).toBe(true);
    expect(textDetail(11, 0.75, false, "focus").show).toBe(false);
    expect(textDetail(11, 0.25, true, "overview").show).toBe(false);
    expect(drawTile(40, 0.25, false)).toBe(false);
    expect(drawTile(40, 0.25, true)).toBe(true);
  });
  it("classifies every endpoint pair, including two off-frame near endpoints", () => {
    for (const a of ["in", "pinned", "out"] as const)
      for (const b of ["in", "pinned", "out"] as const)
        for (const near of [false, true]) {
          const edge = edgeInFrame(a, b, near);
          expect(edge.pill).toBe((a === "in" || b === "in") && a !== "out" && b !== "out");
          expect(edge.arrow).toBe(a === "in" && b === "in");
          expect(edge.draw).toBe(a === "in" || b === "in");
          expect(edge.particles).toBe(edge.draw);
        }
  });
  it("culls only beyond half the fade or outside the frame", () => {
    const frame = { x: 0, y: 0, width: 200, height: 200 };
    const inner = { x: 20, y: 20, width: 160, height: 160 };
    expect(cullLabel({ x: 10, y: 80, width: 20, height: 20 }, frame, inner)).toBe(false);
    expect(cullLabel({ x: 9, y: 80, width: 20, height: 20 }, frame, inner)).toBe(true);
    expect(cullLabel({ x: -1, y: 80, width: 20, height: 20 }, frame, inner)).toBe(true);
    expect(innerFrame(400, 300, "focus", true, true)).toEqual({ x: 28, y: 28, width: 344, height: 244 });
  });
  it("pins at the edge crossing and stacks inward in 34 px steps", () => {
    const inner = { x: 28, y: 28, width: 500, height: 400 };
    const crossing = frameCrossing(
      [
        { x: 200, y: 380 },
        { x: 800, y: 380 },
      ],
      inner,
    )!;
    expect(crossing).toEqual({ point: { x: 528, y: 380 }, side: "right" });
    const pins = stackPins(
      ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        side: crossing.side,
        crossing: crossing.point,
        width: 100,
        spotlit: true,
      })),
      inner,
    );
    expect(pins.map((p) => p.box.y)).toEqual([366, 332, 298]);
  });
  it.each(["left", "right", "top", "bottom"] as const)("moves %s pins clear of cards and their titles", (side) => {
    const inner = { x: 0, y: 0, width: 500, height: 400 };
    const pin = { id: "saga", name: "Checkout saga", side, crossing: { x: 490, y: 150 }, width: 140, spotlit: false };
    const original = stackPins([pin], inner)[0].box;
    const card = { ...original, height: 80 };
    const pins = stackPins([pin, { ...pin, id: "next" }], inner, 28, [card]);
    expect(pins).toHaveLength(2);
    for (const placed of pins) expect(intersects(placed.box, card)).toBe(false);
    expect(intersects(pins[0].box, pins[1].box)).toBe(false);
    expect(stackPins([pin], inner, 28, [inner])).toEqual([]);
  });
  it("searches past several cards even with only one pin", () => {
    const inner = { x: 0, y: 0, width: 500, height: 400 };
    const card = { x: 350, y: 0, width: 150, height: 280 };
    const [pin] = stackPins(
      [{ id: "saga", name: "Checkout saga", side: "right", crossing: { x: 500, y: 70 }, width: 140, spotlit: false }],
      inner,
      28,
      [card],
    );
    expect(pin.box.y).toBe(286);
    expect(intersects(pin.box, card)).toBe(false);
  });
  it("slides a colliding label along its own edge and hides when no space remains", () => {
    const label = { x: 90, y: 40, width: 30, height: 20 };
    const path = [
      { x: 0, y: 50 },
      { x: 300, y: 50 },
    ];
    const frame = { x: 0, y: 0, width: 300, height: 100 };
    const placed = placeFrameLabel(label, path, frame, [label])!;
    expect(placed.y).toBe(40);
    expect(placed.x).not.toBe(label.x);
    expect(placeFrameLabel(label, path, frame, [frame])).toBeNull();
  });
  it("only includes one hop, not a transitive component", () => {
    expect([
      ...oneHop(
        [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
        new Set(["a"]),
      ),
    ]).toEqual(["a", "b"]);
  });
  it("manual movement drops Follow until explicitly picked again", () => {
    const follow = decide(initialPolicy("live"), { type: "view.requested", view: "follow" });
    expect(follow.commands[0].type).toBe("follow");
    const manual = decide(follow.state, { type: "user.moved" });
    expect(manual.state.view).toBe("custom");
    const note = decide(manual.state, { type: "narration", focus: ["a"] });
    expect(note.state.view).toBe("custom");
    expect(note.commands).toEqual([]);
    expect(note.state.pending).toBeNull();
    expect(decide(note.state, { type: "view.requested", view: "follow" }).commands[0]).toMatchObject({
      type: "follow",
      focus: ["a"],
    });
  });
  it("automatically focuses only below 50% and defers the move until the gesture ends", () => {
    expect(decide(initialPolicy(), { type: "selection.changed", cause: "selection", zoom: 0.51 }).commands).toEqual([]);
    const low = decide(initialPolicy(), { type: "selection.changed", cause: "selection", zoom: 0.49 });
    expect(low.commands).toEqual([]);
    expect(low.state.pending).toEqual({ cause: "selection", autoFocus: true });
    const held = decide(
      { ...low.state, gesture: true },
      { type: "pane.settled", selection: true, covered: false, coveredWithEdges: false, centreOff: false },
    );
    expect(held.commands).toEqual([]);
    const settled = decide(
      { ...held.state, gesture: false },
      { type: "pane.settled", selection: true, covered: false, coveredWithEdges: false, centreOff: false },
    );
    expect(settled.commands).toEqual([{ type: "focusSelection", automatic: true }]);
  });
});

it("pins a culled title even when the connection's endpoint is still inside the frame", () => {
  const frame = { x: 28, y: 28, width: 448, height: 500 };
  const points = [
    { x: 300, y: 180 },
    { x: 405, y: 180 },
  ];
  expect(frameCrossing(points, frame)).toBeNull();
  expect(frameCrossing(points, frame, true)).toEqual({ point: { x: 476, y: 180 }, side: "right" });
});

it("fits the visible rectangle between rail, bezel, dock and bottom row", () => {
  const pane = { x: 0, y: 0, width: 1440, height: 900 };
  expect(fitRectangle(pane, { left: 72, top: 94, right: 1068, bottom: 735 })).toEqual({
    x: 72,
    y: 94,
    width: 996,
    height: 641,
  });
  expect(
    fitRectangle({ x: 72, y: 94, width: 996, height: 641 }, { left: 60, top: 50, right: 1440, bottom: 850 }),
  ).toEqual({ x: 72, y: 94, width: 996, height: 641 });
  expect(fitRectangle(pane, { left: 1440, right: 72, top: 900, bottom: 50 })).toEqual({
    x: 1440,
    y: 900,
    width: 0,
    height: 0,
  });
});

it("labels a single selected subset as Focus and preserves whole-selection Overview", () => {
  expect(frameView("overview", 1, true)).toBe("focus");
  expect(frameView("overview", 1, false)).toBe("overview");
  expect(frameView("overview", 12, true)).toBe("overview");
  expect(frameView("custom", 1, true)).toBe("custom");
});

it("a mirrored rail and dock outside the pane leave the visible canvas intact", () => {
  const root = {
    clientWidth: 1068,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 300, top: 52 }),
    ownerDocument: {
      querySelector: (selector: string) => {
        const rect = selector.includes("tool-rail")
          ? { left: 1368, right: 1440, top: 52, bottom: 900, width: 72, height: 848 }
          : selector.includes("inspector")
            ? { left: 0, right: 300, top: 52, bottom: 900, width: 300, height: 848 }
            : null;
        return rect ? { getBoundingClientRect: () => rect } : null;
      },
    },
  } as unknown as HTMLElement;
  expect(visibleCanvas(root)).toEqual({ x: 0, y: 0, width: 1068, height: 800 });
});
