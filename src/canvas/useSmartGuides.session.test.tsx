// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { InternalNode, ReactFlowState, NodeChange } from "@xyflow/react";
import { toFlow } from "./convert";
import type { FlowNode, DiagramFlowEdge } from "./types";
import { useSmartGuides } from "./useSmartGuides";

it("boundary guides exclude moving descendants throughout a drag", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  const nodes = toFlow({
    format: "diagrams/v1",
    title: "Drag session",
    edges: [],
    groups: [
      { id: "root", label: "Root", x: 0, y: 0, width: 400, height: 300 },
      { id: "inner", label: "Inner", group: "root", x: 83, y: 60, width: 300, height: 200 },
    ],
    nodes: [{ id: "member", group: "inner", stencil: "service.node", label: "Member", x: 113, y: 120 }],
    annotations: [{ id: "zone", kind: "zone", text: "Stationary", x: 800, y: 0, width: 400, height: 300 }],
  }).nodes;
  const state = {
    nodes,
    width: 2000,
    height: 2000,
    transform: [0, 0, 1],
    snapToGrid: true,
    nodeLookup: new Map(
      nodes.map((n) => [
        n.id,
        {
          ...n,
          measured: { width: n.width ?? 220, height: n.height ?? 72 },
          internals: { positionAbsolute: n.position, z: 0, userNode: n },
        } as InternalNode<FlowNode>,
      ]),
    ),
  } as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const store = { getState: () => state };
  const applied = vi.fn();
  const layer = { current: document.createElementNS("http://www.w3.org/2000/svg", "svg") };
  let guides!: ReturnType<typeof useSmartGuides>;
  function Harness() {
    guides = useSmartGuides({ store, snap: true, guides: true, layer, apply: applied });
    return null;
  }
  const move = (x: number, dragging = true) =>
    guides.filter([{ id: "group:root", type: "position", position: { x, y: 500 }, dragging }]);
  const check = (changes: NodeChange<FlowNode>[], x: number) => {
    const positions = changes.flatMap((c) => (c.type === "position" ? [[c.id, c.position] as const] : []));
    expect(new Map(positions)).toEqual(
      new Map([
        ["group:root", { x, y: 500 }],
        ["group:inner", { x: x + 83, y: 560 }],
        ["member", { x: x + 113, y: 620 }],
      ]),
    );
  };
  try {
    await act(() => root.render(<Harness />));
    guides.start({}, [nodes.find((n) => n.id === "group:root")!], null);
    check(move(84), 80); // Past the child's old edge at 83: it must not attract its parent.
    check(move(114), 110); // Nor may the member's old edge at 113.
    check(move(804), 800); // The stationary zone is a valid external target.
    check(move(804, false), 800);
    expect(state.snapToGrid).toBe(true);
    expect(layer.current.hasAttribute("data-on")).toBe(false);
  } finally {
    await act(() => root.unmount());
    vi.useRealTimers();
  }
});
