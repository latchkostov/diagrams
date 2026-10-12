import { describe, expect, it } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { contentHeight, HEIGHT } from "./hostHeight";

type State = ReactFlowState<FlowNode, DiagramFlowEdge>;

/** A React Flow store with nodes at `boxes` (x, y, width, height) in a pane of `width` x `height`. */
function store(boxes: [number, number, number, number][], width = 1000, height = 400): State {
  const nodeLookup = new Map(
    boxes.map(([x, y, w, h], i) => [
      `n${i}`,
      { id: `n${i}`, measured: { width: w, height: h }, internals: { positionAbsolute: { x, y } } },
    ]),
  );
  return { nodeLookup, width, height } as unknown as State;
}

describe("host embed: auto-height", () => {
  it("is the diagram's height at the zoom that fits the frame's width, plus margins", () => {
    // 920 wide at 1000 px: zoom (1000 - 80) / 920 = 1, so 300 tall + 80 of margin.
    expect(contentHeight(store([[0, 0, 920, 300]]), null)).toBe(380);
    // Half the width: half the zoom, half the diagram's height.
    expect(contentHeight(store([[0, 0, 920, 300]], 540), null)).toBe(230);
  });

  it("depends on the width, never on the frame's current height (no feedback loop)", () => {
    const a = contentHeight(store([[0, 0, 920, 600]], 1000, 150), null);
    const b = contentHeight(store([[0, 0, 920, 600]], 1000, 900), null);
    expect(a).toBe(b);
  });

  it("never zooms in past 125%, and stays within its bounds", () => {
    // A tiny diagram: zoom capped at 1.25, then the minimum.
    expect(contentHeight(store([[0, 0, 100, 40]]), null)).toBe(HEIGHT.min);
    expect(contentHeight(store([[0, 0, 100, 400]]), null)).toBe(Math.round(400 * 1.25 + 80));
    // A very tall one: the maximum.
    expect(contentHeight(store([[0, 0, 300, 5000]]), null)).toBe(HEIGHT.max);
    // Live keeps room for the narration.
    expect(contentHeight(store([[0, 0, 920, 100]]), null, true)).toBe(HEIGHT.minLive);
  });

  it("waits for measured nodes", () => {
    expect(contentHeight(store([]), null)).toBeNull();
    expect(contentHeight(store([[0, 0, 0, 0]]), null)).toBeNull();
    expect(contentHeight(store([[0, 0, 920, 300]], 0, 0), null)).toBeNull();
  });
});
