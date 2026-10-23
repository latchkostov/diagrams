import { expect, it, vi } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { selectRoutes } from "../edges/useEdgeRoute";
import { liveFitViewport } from "./geometry";
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
    expect(label.y).toBeGreaterThanOrEqual(110);
    expect(label.x).toBeLessThanOrEqual(1280 - (room.panel ? 440 : 48));
    if (room.card) {
      // The label may sit below or beside the trace card, but never under its footprint.
      expect(label.x <= 896 || label.y >= 326).toBe(true);
    }
    expect(0 * view.zoom + view.y).toBeLessThanOrEqual(800 - 48 - 72);
  });
