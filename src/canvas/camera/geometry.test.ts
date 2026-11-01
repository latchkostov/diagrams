import { expect, it, vi } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { intersects } from "../geometry/rect";
import { TRACE_CARD_TOP, TRACE_CARD_FOOTPRINT } from "../../live/traceCardLayout";
import { FRAME_CARD_SPACE, innerFrame } from "./frameBounds";
import { selectRoutes } from "../edges/useEdgeRoute";
import {
  fitNodesViewport,
  liveFitViewport,
  focusSelectionViewport,
  followViewport,
  overlayFitViewport,
  goToViewport,
  hasVisibleContent,
  revealPan,
} from "./geometry";
vi.mock("../edges/useEdgeRoute", () => ({ selectRoutes: vi.fn() }));

for (const dock of ["bottom", "left", "bottom with Focus clipping"] as const)
  it(`reveals a selected card inside the exposed canvas with a ${dock} dock`, () => {
    const bounds = { left: 0, top: 0, right: 800, bottom: 700, width: 800, height: 700 };
    const sheet =
      dock === "left" ? { left: 0, top: 0, right: 300, bottom: 700 } : { left: 0, top: 350, right: 800, bottom: 700 };
    const root = {
      clientWidth: 800,
      clientHeight: 700,
      getBoundingClientRect: () => bounds,
      querySelectorAll: () => [],
      dataset: { detailView: dock === "bottom with Focus clipping" ? "focus" : "custom" },
      ownerDocument: {
        querySelector: (selector: string) =>
          selector.includes('"inspector"') ? { getBoundingClientRect: () => sheet } : null,
      },
    } as unknown as HTMLElement;
    const card = { x: 100, y: dock === "bottom with Focus clipping" ? 250 : 450, width: 220, height: 72 };
    const view = revealPan(root, { x: 0, y: 0, zoom: 1 }, card);
    expect(view).not.toBeNull();
    expect(view!.zoom).toBe(1);
    const painted = { x: card.x + view!.x, y: card.y + view!.y, width: card.width, height: card.height };
    expect(
      intersects(painted, {
        x: sheet.left,
        y: sheet.top,
        width: sheet.right - sheet.left,
        height: sheet.bottom - sheet.top,
      }),
    ).toBe(false);
    expect(painted.x).toBeGreaterThanOrEqual(0);
    expect(painted.y).toBeGreaterThanOrEqual(0);
    expect(painted.x + painted.width).toBeLessThanOrEqual(bounds.width);
    expect(painted.y + painted.height).toBeLessThanOrEqual(bounds.height);
    if (dock === "bottom with Focus clipping") {
      const frame = innerFrame(bounds.width, sheet.top, "focus", false);
      expect(painted.y + painted.height + FRAME_CARD_SPACE.bottom).toBeLessThanOrEqual(frame.y + frame.height);
    }
    expect(revealPan(root, view!, card)).toBeNull();
  });

it("keeps the established centre fallback for an oversized selection", () => {
  const root = {
    clientWidth: 800,
    clientHeight: 700,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 700, width: 800, height: 700 }),
    querySelectorAll: () => [],
    dataset: { detailView: "focus" },
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes('"inspector"')
          ? { getBoundingClientRect: () => ({ left: 0, top: 350, right: 800, bottom: 700 }) }
          : null,
    },
  } as unknown as HTMLElement;
  const selected = { x: 100, y: 450, width: 220, height: 800 };
  // The selection cannot fit above the sheet. Centre it in the existing reveal
  // area (72 px above, 56 px below), without changing the chosen zoom.
  expect(revealPan(root, { x: 0, y: 0, zoom: 1 }, selected)).toEqual({ x: 0, y: -667, zoom: 1 });
});

it("only reserves transport space when the bar overlaps the canvas", () => {
  let transportTop = 600;
  const root = {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes("live-controls") ? { getBoundingClientRect: () => ({ top: transportTop }) } : null,
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  const state = {
    width: 800,
    height: 600,
    minZoom: 0.01,
    transform: [0, 0, 1],
    domNode: root,
    edges: [],
    nodeLookup: new Map([
      ["a", { measured: { width: 220, height: 600 }, internals: { positionAbsolute: { x: 0, y: 0 } } }],
    ]),
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const outside = liveFitViewport(state, { panel: false, card: false })!;
  transportTop = 528;
  const inside = liveFitViewport(state, { panel: false, card: false })!;
  expect(outside.zoom).toBeGreaterThan(inside.zoom);
  expect(outside.y + 600 * outside.zoom).toBeLessThanOrEqual(576);
  expect(inside.y + 600 * inside.zoom).toBeLessThanOrEqual(504);
});

it("search centres a boundary member at its absolute position", () => {
  const root = { clientWidth: 1000, clientHeight: 700 } as HTMLElement;
  const node = {
    position: { x: 30, y: 40 },
    measured: { width: 220, height: 72 },
    internals: { positionAbsolute: { x: 2030, y: 1040 } },
  };
  const state = { nodeLookup: new Map([["member", node]]) } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const view = goToViewport(root, state, { x: 0, y: 0, zoom: 0.5 }, "member")!;
  expect(view.x + 2140 * view.zoom).toBe(500);
  expect(view.y + 1076 * view.zoom).toBe(350);
});

for (const room of [
  { panel: false, card: false },
  { panel: true, card: false },
  { panel: false, card: true },
])
  it(`keeps saved bends and labels in Live refits ${JSON.stringify(room)}`, () => {
    const state = {
      width: 1280,
      height: 800,
      minZoom: 0.01,
      domNode: null,
      nodeLookup: new Map([
        ["a", { measured: { width: 220, height: 72 }, internals: { positionAbsolute: { x: 0, y: 0 } } }],
      ]),
      edges: [{ id: "saved", data: { waypoints: [{ x: 1800, y: -900 }] } }],
    } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
    vi.mocked(selectRoutes).mockReturnValue(
      new Map([
        [
          "saved",
          {
            points: [
              { x: 0, y: 0 },
              { x: 1800, y: -900 },
            ],
            label: { x: 1800, y: -950, width: 100, height: 24 },
          },
        ],
      ]) as never,
    );
    const view = liveFitViewport(state, room)!;
    expect(view).not.toBeNull();
    const label = { x: 1850 * view.zoom + view.x, y: -962 * view.zoom + view.y };
    expect(label.y).toBeGreaterThanOrEqual(32);
    expect(label.x).toBeLessThanOrEqual(1280 - (room.panel ? 440 : 32));
    if (room.card) {
      // The label may sit below or beside the trace card, but never under its footprint.
      expect(
        intersects(
          { x: 1750 * view.zoom + view.x, y: label.y, width: 100 * view.zoom, height: 24 * view.zoom },
          { x: 912, y: TRACE_CARD_TOP, width: 352, height: TRACE_CARD_FOOTPRINT },
        ),
      ).toBe(false);
    }
    expect(0 * view.zoom + view.y).toBeLessThanOrEqual(800 - 24 - 72);
  });

it("counts rendered edge labels in a measured fit at the current transform", () => {
  const label = {
    dataset: { testid: "edge-label-ab" },
    getBoundingClientRect: () => ({ left: 1010, top: 420, width: 200, height: 40 }),
  };
  const state = {
    width: 800,
    height: 600,
    minZoom: 0.01,
    transform: [10, 20, 2],
    domNode: { getBoundingClientRect: () => ({ left: 0, top: 0 }), querySelectorAll: () => [label] },
    nodeLookup: new Map([
      ["a", { id: "a", measured: { width: 100, height: 50 }, internals: { positionAbsolute: { x: 0, y: 0 } } }],
    ]),
    edges: [],
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const view = fitNodesViewport(state, null, { top: 32, right: 32, bottom: 32, left: 32 }, 1.25)!;
  expect(600 * view.zoom + view.x).toBeLessThanOrEqual(800 - 32);
  expect(220 * view.zoom + view.y).toBeLessThanOrEqual(600 - 32);
  expect(view.zoom).toBeLessThan(1.25);
});
it("keeps unrelated edge labels out of a focused node fit", () => {
  const state = {
    width: 800,
    height: 600,
    minZoom: 0.01,
    transform: [0, 0, 1],
    domNode: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      querySelectorAll: () => [
        {
          dataset: { testid: "edge-label-other" },
          getBoundingClientRect: () => ({ left: 5000, top: 5000, width: 200, height: 40 }),
        },
      ],
    },
    nodeLookup: new Map([
      ["a", { id: "a", measured: { width: 100, height: 50 }, internals: { positionAbsolute: { x: 0, y: 0 } } }],
    ]),
    edges: [],
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  expect(fitNodesViewport(state, new Set(["a"]), { top: 32, right: 32, bottom: 32, left: 32 }, 1.25)?.zoom).toBe(1.25);
});

for (const bottom of [80, 220])
  it(`fits below a floating status callout ending at ${bottom}`, () => {
    const state = {
      width: 800,
      height: 600,
      minZoom: 0.01,
      transform: [0, 0, 1],
      domNode: {
        getBoundingClientRect: () => ({ top: 0, left: 0 }),
        querySelector: () => ({ getBoundingClientRect: () => ({ height: bottom - 16, bottom }) }),
        querySelectorAll: () => [],
      },
      nodeLookup: new Map([
        ["a", { id: "a", measured: { width: 1000, height: 1000 }, internals: { positionAbsolute: { x: 0, y: 0 } } }],
      ]),
      edges: [],
    } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
    expect(liveFitViewport(state, { panel: false, card: false })!.y).toBeGreaterThanOrEqual(bottom + 16);
  });

function workbenchState(spread = 300) {
  const nodes = ["a", "b"].map((id, i) => ({
    id,
    type: "diagram",
    selected: i === 0,
    measured: { width: 180, height: 80 },
    internals: { positionAbsolute: { x: i * spread, y: 0 } },
  }));
  return {
    width: 1200,
    height: 800,
    minZoom: 0.01,
    transform: [0, 0, 1],
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    edges: [{ id: "ab", source: "a", target: "b" }],
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
}
const workbenchRoot = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
  clientWidth: 1200,
  clientHeight: 800,
  closest: () => null,
  querySelectorAll: () => [],
} as unknown as HTMLElement;
it("fits an editable grow chip without changing a viewer's frame", () => {
  vi.mocked(selectRoutes).mockReturnValue(new Map());
  const s = workbenchState(6000);
  const viewer = overlayFitViewport(workbenchRoot, s, { style: "straight", direction: "LR" }, {})!;
  const editor = overlayFitViewport(
    { ...workbenchRoot, querySelector: () => ({}) } as unknown as HTMLElement,
    s,
    { style: "straight", direction: "LR" },
    {},
  )!;
  expect(viewer.x).toBe(32);
  expect(editor.x).toBe(40);
  expect(viewer.zoom).toBeGreaterThan(editor.zoom);
});
it("Overview is a true fit of distant nodes and edge labels down to minZoom", () => {
  const s = workbenchState(6000);
  vi.mocked(selectRoutes).mockReturnValue(
    new Map([["ab", { points: [], label: { x: 8000, y: 0, width: 200, height: 30 } }]]) as never,
  );
  const view = overlayFitViewport(workbenchRoot, s, { style: "straight", direction: "LR" }, { margin: 32 })!;
  expect(view.zoom).toBeLessThan(0.15);
  expect(view.x).toBeGreaterThanOrEqual(32);
  expect(8100 * view.zoom + view.x).toBeLessThanOrEqual(1168);
});
it("Focus includes neighbours' labels, or centres the selection at its floor", () => {
  vi.mocked(selectRoutes).mockReturnValue(
    new Map([["ab", { points: [], label: { x: 550, y: 0, width: 100, height: 30 } }]]) as never,
  );
  const view = focusSelectionViewport(workbenchRoot, workbenchState(), { style: "straight", direction: "LR" })!;
  expect(view.zoom).toBeGreaterThanOrEqual(0.9);
  expect(view.zoom).toBeLessThanOrEqual(1.25);
  expect(600 * view.zoom + view.x).toBeLessThanOrEqual(1144);
  const spread = focusSelectionViewport(workbenchRoot, workbenchState(6000), { style: "straight", direction: "LR" })!;
  expect(spread.zoom).toBe(0.9);
  expect(spread.x + 90 * spread.zoom).toBe(588);
});
it.each([0.35, 1, 1.5])("Follow pans to an off-screen subject without changing zoom %s", (zoom) => {
  const state = workbenchState(6000);
  state.transform = [40, 60, zoom];
  const view = followViewport(workbenchRoot, state, ["a", "b"], "b")!;
  expect(view.zoom).toBe(zoom);
  expect(view.x + 6090 * zoom).toBe(600);
  expect(view.y + 40 * zoom).toBe(400);
  state.transform = [view.x, view.y, view.zoom];
  expect(followViewport(workbenchRoot, state, ["a", "b"], "b")).toBeNull();
});
it("Follow leaves an on-screen subject and a missing narration alone", () => {
  const state = workbenchState();
  state.transform = [100, 100, 1];
  expect(followViewport(workbenchRoot, state, ["a"], "a")).toBeNull();
  expect(followViewport(workbenchRoot, state, [], "b")).toBeNull();
  expect(followViewport(workbenchRoot, state, [], undefined)).toBeNull();
});
it("Follow leaves a fully visible subject at the pane edge in place", () => {
  const state = workbenchState();
  state.transform = [2, 2, 1];
  expect(followViewport(workbenchRoot, state, ["a"], "a")).toBeNull();
});
it("a visible edge or label keeps the camera even with both endpoints off-screen", () => {
  const state = workbenchState();
  for (const node of state.nodeLookup.values()) node.internals.positionAbsolute.y = 3000;
  const crossing = {
    points: [
      { x: -100, y: 400 },
      { x: 1300, y: 400 },
    ],
  };
  vi.mocked(selectRoutes).mockReturnValue(new Map([["ab", crossing]]) as never);
  expect(hasVisibleContent(workbenchRoot, state)).toBe(true);
  const outside = {
    points: [
      { x: -100, y: 4000 },
      { x: 1300, y: 4000 },
    ],
  };
  vi.mocked(selectRoutes).mockReturnValue(new Map([["ab", outside]]) as never);
  expect(hasVisibleContent(workbenchRoot, state)).toBe(false);
  vi.mocked(selectRoutes).mockReturnValue(
    new Map([["ab", { ...outside, label: { x: 600, y: 400, width: 100, height: 20 } }]]) as never,
  );
  expect(hasVisibleContent(workbenchRoot, state)).toBe(true);
});
it("Follow reveals its subject clear of an overlapping left dock and top bezel", () => {
  const root = {
    ...workbenchRoot,
    ownerDocument: {
      querySelector: (selector: string) => {
        const rect = selector.includes("inspector")
          ? { left: 0, right: 400, top: 0, bottom: 800, width: 400, height: 800 }
          : selector.includes("canvas-bezel")
            ? { left: 0, right: 1200, top: 0, bottom: 60 }
            : null;
        return rect ? { getBoundingClientRect: () => rect } : null;
      },
    },
  } as unknown as HTMLElement;
  const view = followViewport(root, workbenchState(6000), ["a", "b"], "b")!;
  expect(view.zoom).toBe(1);
  expect(view.x + 6000).toBeGreaterThanOrEqual(428);
  expect(view.x + 6180).toBeLessThanOrEqual(1172);
  expect(view.y).toBeGreaterThanOrEqual(100);
  expect(view.y + 80).toBeLessThanOrEqual(728);
});
it.each([0.35, 0.92, 1, 1.5])("phone Follow preserves zoom %s above its readable floor", (current) => {
  const root = { ...workbenchRoot, clientWidth: 390, clientHeight: 548 } as HTMLElement;
  const state = workbenchState(6000);
  state.transform = [0, 0, current];
  const view = followViewport(root, state, ["a", "b"], "b")!;
  expect(view.zoom).toBe(Math.max(0.92, current));
  expect(view.x + 6090 * view.zoom).toBe(current === 1.5 ? 247 : 257);
  expect(view.x + 6180 * view.zoom).toBeLessThanOrEqual(382);
  expect(view.y + 40 * view.zoom).toBeCloseTo(548 * 0.4);
});
it.each([
  { room: { panel: true }, peer: "right", width: 180, left: 8 },
  { room: { panel: true }, peer: "left", width: 180, left: 32 },
  { room: { card: true }, peer: "right", width: 180, left: 8 },
  { room: { card: true }, peer: "left", width: 180, left: 32 },
  { room: { panel: true }, peer: "right", width: 220, left: 0 },
  { room: { card: true }, peer: "left", width: 220, left: 0 },
  { room: { panel: true }, peer: "right", width: 300, left: -40 },
  { room: { card: true }, peer: "left", width: 300, left: -40 },
])(
  "R-05d3d31dd8 phone Follow keeps a $width px subject in the width beside a $room reservation (peer $peer)",
  ({ room, peer, width, left }) => {
    const root = { ...workbenchRoot, clientWidth: 390, clientHeight: 548 } as HTMLElement;
    const state = workbenchState(6000);
    state.transform = [-9000, 0, 1];
    // With the subject on the left, its narrated peer sits to its right, and vice versa.
    const id = peer === "right" ? "a" : "b";
    const node = state.nodeLookup.get(id)!;
    node.measured = { width, height: 80 };
    const x = node.internals.positionAbsolute.x;
    const view = followViewport(root, state, ["a", "b"], id, room)!;
    // 390 px frame minus the 170 px reservation leaves [0, 220].
    expect(view.zoom).toBe(1);
    expect(view.x + x).toBe(left);
    if (width <= 220) {
      expect(view.x + x).toBeGreaterThanOrEqual(0);
      expect(view.x + x + width).toBeLessThanOrEqual(220);
    }
  },
);
it.each([96, 400, 800])("R-c6a836a8ae Focus and Follow use the phone sheet's exposed frame at height %i", (height) => {
  const root = {
    ...workbenchRoot,
    clientWidth: 390,
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes("inspector")
          ? {
              getBoundingClientRect: () => ({
                left: 0,
                right: 390,
                top: 800 - height,
                bottom: 800,
                width: 390,
                height,
              }),
            }
          : null,
    },
  } as unknown as HTMLElement;
  vi.mocked(selectRoutes).mockReturnValue(new Map());
  const state = workbenchState(6000);
  const focus = focusSelectionViewport(root, state, { style: "straight", direction: "LR" })!;
  if (height === 800) expect(focus).toBeNull();
  else {
    expect(focus.x + 90 * focus.zoom).toBe(183);
    expect(focus.y + 40 * focus.zoom).toBe((800 - height + 32 - 72) / 2);
  }
  state.transform = [-7000, -7000, 1];
  const follow = followViewport(root, state, ["a", "b"], "a")!;
  expect(follow.zoom).toBe(1);
  expect(follow.x + 90 * follow.zoom).toBe(133);
  expect(follow.y + 40 * follow.zoom).toBe((800 - height) * 0.4);
});

it("Overview excludes the reserved legend from its fitted canvas", () => {
  const root = {
    ...workbenchRoot,
    ownerDocument: {
      querySelector: (selector: string) =>
        selector.includes("live-route-legend") ? { getBoundingClientRect: () => ({ top: 720 }) } : null,
    },
  } as unknown as HTMLElement;
  const s = workbenchState();
  s.nodeLookup.get("b")!.internals.positionAbsolute.y = 600;
  vi.mocked(selectRoutes).mockReturnValue(new Map());
  const view = overlayFitViewport(root, s, { style: "straight", direction: "LR" }, { margin: 32, maxZoom: 10 })!;
  expect(view.y + 680 * view.zoom).toBeLessThanOrEqual(720 - 32);
  expect(view.y).toBeGreaterThanOrEqual(32);
});
