import { describe, expect, it } from "vitest";
import { textDetail, frameView } from "./detail";
import { iconDetail, titleText } from "./identity";
import {
  cullLabel,
  fitRectangle,
  visibleCanvas,
  edgeInFrame,
  frameCrossing,
  innerFrame,
  oneHop,
  placeFrameLabel,
  pinRow,
  routeToPin,
  placeTextFloor,
  frameLanes,
  frameObstacles,
  clipFrameRoute,
  stackPins,
} from "./camera/frameEdges";
import { intersects, segmentHitsRect } from "./geometry/rect";
import { decide, initialPolicy } from "./camera/panePolicy";

describe("Workbench frame detail", () => {
  it("keeps bottom pins below every trunk and above the legend", () => {
    const inner = { x: 28, y: 28, width: 500, height: 400 };
    const { routes, row } = pinRow(inner, 28);
    const pins = stackPins(
      ["flags", "payments", "metrics"].map((id) => ({
        id,
        name: id,
        side: "bottom" as const,
        crossing: { x: 260, y: 428 },
        width: 100,
        spotlit: false,
      })),
      row,
    );
    expect(pins).toHaveLength(3);
    for (const pin of pins) {
      expect(pin.box.y).toBeGreaterThan(routes.y + routes.height);
      expect(pin.box.y + pin.box.height).toBeLessThanOrEqual(inner.y + inner.height);
      const path = routeToPin(
        [
          { x: 250, y: 100 },
          { x: 250, y: 500 },
        ],
        routes,
        pin,
      );
      for (const other of pins)
        for (let i = 1; i < path.length; i++) expect(segmentHitsRect(path[i - 1], path[i], other.box)).toBe(false);
    }
  });
  it("joins a displaced seam pin only with orthogonal route segments", () => {
    const inner = { x: 28, y: 28, width: 500, height: 400 };
    const [pin] = stackPins(
      [{ id: "saga", name: "Checkout saga", side: "right", crossing: { x: 528, y: 150 }, width: 140, spotlit: false }],
      inner,
      28,
      [{ x: 350, y: 0, width: 180, height: 280 }],
    );
    const path = routeToPin(
      [
        { x: 200, y: 150 },
        { x: 800, y: 150 },
      ],
      inner,
      pin,
    );
    expect(path.at(-1)).toEqual({ x: pin.box.x, y: pin.box.y + 14 });
    for (let i = 1; i < path.length; i++) expect(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y).toBe(true);
    expect(pin.box.x + pin.box.width).toBeLessThanOrEqual(inner.x + inner.width);
  });
  it("connects a card port in the reserved seam without falling back to the off-frame route", () => {
    const inner = { x: 28, y: 28, width: 500, height: 400 };
    const { routes, row } = pinRow(inner, 28);
    const [pin] = stackPins(
      [{ id: "flags", name: "Flags", side: "bottom", crossing: { x: 250, y: 428 }, width: 100, spotlit: false }],
      row,
    );
    const path = routeToPin(
      [
        { x: 250, y: 60 },
        { x: 250, y: -200 },
        { x: 500, y: -200 },
        { x: 500, y: 600 },
      ],
      routes,
      pin,
    );
    expect(path[0]).toEqual({ x: 250, y: 60 });
    expect(path.at(-1)).toEqual({ x: pin.box.x + pin.box.width / 2, y: pin.box.y });
    expect(path.every((p) => p.y >= 60 && p.y <= pin.box.y)).toBe(true);
  });
  it("separates a screen-space fan into eight-pixel lanes without moving its ports", () => {
    const paths = new Map(
      [0, 1, 2].map((i) => [
        String(i),
        [
          { x: 0, y: i * 14 },
          { x: 100, y: i * 14 },
          { x: 100, y: 200 + i * 14 },
          { x: 300, y: 200 + i * 14 },
        ],
      ]),
    );
    const lanes = frameLanes(paths, []);
    const tracks = [...lanes.values()].map((p) => p[1].x).sort((a, b) => a - b);
    expect(tracks[1] - tracks[0]).toBe(8);
    expect(tracks[2] - tracks[1]).toBe(8);
    for (const [id, path] of paths) {
      expect(lanes.get(id)![0]).toEqual(path[0]);
      expect(lanes.get(id)!.at(-1)).toEqual(path.at(-1));
    }
  });
  it.each([0, 5])("preserves hand-shaped interior tracks at separation %i", (offset) => {
    const points = (x: number) => [
      { x: 0, y: 0 },
      { x, y: 0 },
      { x, y: 200 },
      { x: 300, y: 200 },
    ];
    const routes = new Map([
      ["custom", points(100)],
      ["automatic", points(100 + offset)],
    ]);
    const before = structuredClone(routes);
    const lanes = frameLanes(routes, [], new Set(["custom"]));
    expect(lanes.get("custom")).toEqual(before.get("custom"));
    expect(Math.abs(lanes.get("automatic")![1].x - 100)).toBeGreaterThanOrEqual(8);
    expect(routes).toEqual(before);
  });
  it("reroutes pins around solid annotations, captions and boundary headers from the main route input", () => {
    const blocks = [
      { x: 180, y: 75, width: 60, height: 100 },
      { x: 280, y: 75, width: 60, height: 100 },
      { x: 380, y: 75, width: 60, height: 100 },
    ];
    const obstacles = frameObstacles(
      {
        nodes: [
          { id: "note", rect: blocks[0] },
          { id: "shape", rect: blocks[1], extra: blocks[2] },
        ],
        groups: [
          {
            id: "boundary",
            rect: { x: 0, y: 0, width: 900, height: 900 },
            header: { x: 100, y: 0, width: 100, height: 24 },
          },
        ],
        edges: [],
      },
      (p) => ({ x: p.x * 0.75 + 20, y: p.y * 0.75 + 10 }),
    );
    expect(obstacles).toHaveLength(4);
    expect(obstacles[0]).toEqual({ x: 155, y: 66.25, width: 45, height: 75 });
    const pin = {
      id: "next",
      name: "Next",
      side: "right" as const,
      crossing: { x: 550, y: 100 },
      width: 80,
      spotlit: false,
      box: { x: 470, y: 86, width: 80, height: 28 },
    };
    const route = routeToPin(
      [
        { x: 100, y: 100 },
        { x: 700, y: 100 },
      ],
      { x: 0, y: 0, width: 550, height: 300 },
      pin,
      obstacles,
    );
    for (let i = 1; i < route.length; i++)
      for (const block of obstacles) expect(segmentHitsRect(route[i - 1], route[i], block)).toBe(false);
  });
  it("offers larger text only in a clear slot, searching past crossing edges", () => {
    const frame = { x: 0, y: 0, width: 500, height: 150 };
    const box = { x: 100, y: 40, width: 100, height: 22 };
    const own = [
      { x: 0, y: 51 },
      { x: 500, y: 51 },
    ];
    const crossing = [
      { x: 150, y: 0 },
      { x: 150, y: 150 },
    ];
    expect(placeTextFloor(box, frame, [])).toEqual(box);
    expect(placeTextFloor(box, frame, [frame], [], own)).toBeNull();
    expect(placeTextFloor(box, frame, [], [crossing])).toBeNull();
    const placed = placeTextFloor(box, frame, [], [crossing], own)!;
    expect(placed).not.toBeNull();
    expect(segmentHitsRect(crossing[0], crossing[1], placed)).toBe(false);
    expect(placeTextFloor({ ...box, width: 600 }, frame, [], [], own)).toBeNull();
  });
  it("stops an unretained neighbour before the pin row", () => {
    const frame = { x: 28, y: 68, width: 500, height: 320 };
    expect(
      clipFrameRoute(
        [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
          { x: 300, y: -400 },
        ],
        frame,
      ),
    ).toEqual([
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 68 },
    ]);
  });
  it("routes a pin around the source card instead of doubling back through it", () => {
    const source = { x: 300, y: 200, width: 180, height: 80 };
    const pin = {
      id: "relay",
      name: "Relay",
      side: "right" as const,
      crossing: { x: 550, y: 240 },
      width: 100,
      spotlit: false,
      box: { x: 450, y: 350, width: 100, height: 28 },
    };
    const path = routeToPin(
      [
        { x: 480, y: 240 },
        { x: 600, y: 240 },
      ],
      { x: 28, y: 68, width: 522, height: 320 },
      pin,
      [source, pin.box],
    );
    expect(path[1].x).toBeGreaterThan(480);
    for (let i = 1; i < path.length; i++)
      for (const block of [source, pin.box]) expect(segmentHitsRect(path[i - 1], path[i], block)).toBe(false);
  });
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
  });
  it("always shows titles at 9.5 screen pixels in every view from 10 to 150 percent", () => {
    for (const view of ["overview", "focus", "follow", "custom"] as const)
      for (const active of [true, false])
        for (let step = 1; step <= 15; step++)
          for (const font of [8, 11, 13.5, 16]) {
            const zoom = step / 10;
            const detail = textDetail(font, zoom, active, view, true);
            expect(detail.show).toBe(true);
            expect(font * zoom * detail.scale).toBeGreaterThanOrEqual(9.5 - 1e-10);
            expect(detail.scale).toBeGreaterThanOrEqual(1);
          }
  });
  it("draws icons at fourteen screen pixels or fills the height of a smaller card", () => {
    for (const height of [40, 72])
      for (const size of [18, 26, 34])
        for (let step = 1; step <= 15; step++) {
          const zoom = step / 10;
          const icon = iconDetail(size, height, zoom);
          expect(icon * zoom).toBeGreaterThanOrEqual(Math.min(14, height * zoom) - 1e-10);
          expect(icon).toBeLessThanOrEqual(height);
        }
  });
  it("fits titles with a measured ellipsis and falls back to word initials", () => {
    const measure = (text: string) => [...text].length * 6;
    expect(titleText("Delivery dispatch", 42, measure)).toBe("Delive…");
    expect(titleText("Delivery dispatch", 6, measure)).toBe("D");
    expect(titleText("Delivery dispatch", 11, measure)).toBe("D");
    expect(titleText("😀 Route", 12, measure)).toBe("😀…");
    for (let width = 6; width <= 180; width++) {
      const label = titleText("Delivery dispatch", width, measure);
      expect([...label].length).toBeGreaterThan(0);
      expect(measure(label)).toBeLessThanOrEqual(width);
    }
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
  it("prefers slots off other labels' own places, placed later or hidden, before hiding a label", () => {
    const label = { x: 135, y: 40, width: 30, height: 20 };
    const path = [
      { x: 0, y: 50 },
      { x: 300, y: 50 },
    ];
    const frame = { x: 0, y: 0, width: 300, height: 100 };
    const pin = { x: 130, y: 0, width: 40, height: 100 };
    // Without other labels, the nearest clear slot is just left of the pin.
    expect(placeFrameLabel(label, path, frame, [pin])!.x).toBe(90);
    const home = { x: 85, y: 40, width: 40, height: 20 };
    const placed = placeFrameLabel(label, path, frame, [pin], undefined, [home])!;
    expect(intersects(placed, home)).toBe(false);
    expect(intersects(placed, pin)).toBe(false);
    expect(placed.y).toBe(40);
    // When every clear slot is someone's home, the nearest still beats hiding the label.
    expect(
      placeFrameLabel(label, path, frame, [pin], undefined, [
        { ...frame, width: 130 },
        { ...frame, x: 170 },
      ])!.x,
    ).toBe(90);
    // A label that need not move keeps its own place, whatever its neighbours' homes.
    const clear = { x: 20, y: 40, width: 30, height: 20 };
    expect(placeFrameLabel(clear, path, frame, [pin], undefined, [{ ...clear, x: 30 }])).toBe(clear);
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

it.each([96, 400, 800])("R-c6a836a8ae crops a full-width phone sheet at height %i from the bottom only", (height) => {
  const root = {
    clientWidth: 390,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 52 }),
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes("inspector")
          ? {
              getBoundingClientRect: () => ({
                left: 0,
                right: 390,
                top: 852 - height,
                bottom: 852,
                width: 390,
                height,
              }),
            }
          : null,
    },
  } as unknown as HTMLElement;
  expect(visibleCanvas(root)).toEqual({ x: 0, y: 0, width: 390, height: 800 - height });
});

it.each([false, true])("crops the phone note only while it is an expanded overlay (expanded: %s)", (expanded) => {
  // Measured at 390 × 844: expanding the note grows the pane to 644 px and moves the legend under the sheet.
  const root = {
    clientWidth: 390,
    clientHeight: expanded ? 644 : 556,
    getBoundingClientRect: () => ({ left: 0, top: 52 }),
    ownerDocument: {
      querySelector: (selector: string) => {
        const rect =
          selector === '[data-testid="live-note"][data-expanded="1"]'
            ? expanded
              ? { left: 0, right: 390, top: 464, bottom: 696, width: 390, height: 232 }
              : null
            : selector.includes("live-route-legend")
              ? { top: expanded ? 656 : 568 }
              : null;
        return rect ? { getBoundingClientRect: () => rect } : null;
      },
    },
  } as unknown as HTMLElement;
  expect(visibleCanvas(root)).toEqual({ x: 0, y: 0, width: 390, height: expanded ? 412 : 516 });
});

it.each(["left", "right"])("R-c6a836a8ae crops an overlapping %s dock by its edge, not its aspect ratio", (side) => {
  const left = side === "left" ? -100 : 900;
  const root = {
    clientWidth: 1000,
    clientHeight: 300,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes("inspector")
          ? { getBoundingClientRect: () => ({ left, right: left + 400, top: 0, bottom: 300, width: 400, height: 300 }) }
          : null,
    },
  } as unknown as HTMLElement;
  expect(visibleCanvas(root)).toEqual({
    x: side === "left" ? 300 : 0,
    y: 0,
    width: side === "left" ? 700 : 900,
    height: 300,
  });
});
