import { afterEach, expect, it, vi } from "vitest";
import type { InternalNode } from "@xyflow/react";
import type { FlowNode } from "../types";
import { connectionTargetAt } from "./connectTarget";

afterEach(() => vi.unstubAllGlobals());

const node = {
  id: "target",
  type: "diagram",
  measured: { width: 100, height: 100 },
  internals: {
    positionAbsolute: { x: 0, y: 0 },
    handleBounds: { source: [{ id: "top", x: -4.5, y: -4.5, width: 9, height: 9 }] },
  },
} as InternalNode<FlowNode>;

it("tests the unsnapped pointer at the radius boundary, independent of grid snapping", () => {
  vi.stubGlobal("document", {
    elementFromPoint: () => ({ closest: (selector: string) => (selector === ".react-flow" ? {} : null) }),
  });
  const screenToFlowPosition = vi.fn((p: { x: number; y: number }, options?: { snapToGrid?: boolean }) =>
    options?.snapToGrid === false ? p : { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 },
  );
  const hit = connectionTargetAt(
    { x: 27.6, y: 0 },
    "source",
    { getZoom: () => 1, screenToFlowPosition },
    [node],
    () => undefined,
  );
  expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 27.6, y: 0 }, { snapToGrid: false });
  expect(hit).toEqual({ target: { kind: "node", id: "target", side: "top" }, at: { x: 0, y: 0 } });
});

it.each(["top", "grow"])("matches React Flow's direct %s handle priority beyond the distance radius", (id) => {
  vi.stubGlobal("document", {
    elementFromPoint: () => ({
      closest: (selector: string) => (selector === ".react-flow" ? {} : null),
      classList: { contains: () => true },
      getAttribute: (key: string) => (key === "data-nodeid" ? "target" : id),
    }),
  });
  const at = { x: 150, y: 0 };
  const hit = connectionTargetAt(
    at,
    "source",
    { getZoom: () => 1, screenToFlowPosition: (p) => p },
    [node],
    () => undefined,
  );
  expect(hit).toEqual({
    target: { kind: "node", id: "target", side: id === "top" ? "top" : undefined },
    at: id === "top" ? { x: 0, y: 0 } : at,
  });
});

it("a direct source dot stays rejected when another dot is inside its snap radius at zoom 0.4", () => {
  vi.stubGlobal("document", {
    elementFromPoint: () => ({
      closest: (selector: string) => (selector === ".react-flow" ? {} : null),
      classList: { contains: () => true },
      getAttribute: (key: string) => (key === "data-nodeid" ? "source" : "top"),
    }),
  });
  const neighbour = { ...node, internals: { ...node.internals, positionAbsolute: { x: 40, y: 0 } } };
  const hit = connectionTargetAt(
    { x: 0, y: 0 },
    "source",
    {
      getZoom: () => 0.4,
      screenToFlowPosition: (p) => p,
    },
    [{ ...node, id: "source" }, neighbour],
    () => undefined,
  );
  expect(hit).toEqual({ target: { kind: "source" }, at: { x: 0, y: 0 } });
});

it("nearest grow handle is excluded from the shared side-dot resolution", () => {
  vi.stubGlobal("document", {
    elementFromPoint: () => ({ closest: (selector: string) => (selector === ".react-flow" ? {} : null) }),
  });
  const target = {
    ...node,
    measured: { width: 220, height: 72 },
    internals: {
      ...node.internals,
      handleBounds: {
        source: [
          { id: "right", x: 215.5, y: 31.5, width: 9, height: 9 },
          { id: "grow", x: 241.5, y: 31.5, width: 9, height: 9 },
        ],
      },
    },
  } as InternalNode<FlowNode>;
  const hit = connectionTargetAt(
    { x: 240, y: 55 },
    "source",
    { getZoom: () => 1, screenToFlowPosition: (p) => p },
    [target],
    () => undefined,
  );
  expect(hit).toEqual({ target: { kind: "node", id: "target", side: "right" }, at: { x: 220, y: 36 } });
});
