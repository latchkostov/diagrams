import { expect, it, vi } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { intersects } from "../geometry/rect";
import { TRACE_CARD_TOP, TRACE_CARD_FOOTPRINT } from "../../live/traceCardLayout";
import { selectRoutes } from "../edges/useEdgeRoute";
import { fitNodesViewport, liveFitViewport } from "./geometry";
vi.mock("../edges/useEdgeRoute", () => ({ selectRoutes: vi.fn() }));

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
