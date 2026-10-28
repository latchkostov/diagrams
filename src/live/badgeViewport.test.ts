// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { watchBadgeViewport } from "./badgeViewport";
import { suspendFrameCapture } from "../canvas/camera/frameCapture";
import * as semantics from "./badgeSemantics";
import type { LiveController } from "./controller";

it("refreshes every readout synchronously for nested captures, then resumes viewport filtering", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  const changed = vi.fn();
  const dispose = watchBadgeViewport(root, changed);
  const query = changed.mock.calls[0][0] as unknown;
  expect(query).toBeTypeOf("function");
  const viewport = root.firstElementChild!;
  const restore = suspendFrameCapture(viewport);
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(changed).toHaveBeenCalledTimes(2);
  const nested = suspendFrameCapture(viewport);
  nested();
  expect(changed).toHaveBeenCalledTimes(2);
  restore();
  expect(changed).toHaveBeenLastCalledWith(query);
  dispose();
  suspendFrameCapture(viewport)();
  expect(changed).toHaveBeenCalledTimes(3);
});

it("does not publish a resume to an unmounted readout during capture cleanup", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  const changed = vi.fn();
  const dispose = watchBadgeViewport(root, changed);
  const restore = suspendFrameCapture(root.firstElementChild!);
  expect(changed).toHaveBeenCalledTimes(2);
  dispose();
  restore();
  expect(changed).toHaveBeenCalledTimes(2);
});

it("does no semantic DOM work for pans with unchanged membership, but refreshes entrants and publications", () => {
  const refresh = vi.spyOn(semantics, "refresh").mockImplementation(() => {});
  let geometryChanged = () => {};
  let published = () => {};
  const nodes = [0, 10000].map((x, i) => ({
    id: String(i),
    measured: { width: 220, height: 72 },
    internals: { positionAbsolute: { x, y: 0 } },
  }));
  let state = {
    nodes,
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 1],
    width: 1000,
    height: 800,
  } as unknown as ReturnType<NonNullable<Parameters<typeof watchBadgeViewport>[3]>["getState"]>;
  const controller = {
    getState: () => ({}),
    currentDiagram: {},
    subscribe: (run: () => void) => {
      published = run;
      return () => {};
    },
  } as unknown as Pick<LiveController, "subscribe" | "getState" | "currentDiagram">;
  const dispose = watchBadgeViewport(null, () => {}, controller, {
    getState: () => state,
    subscribe: (run) => {
      geometryChanged = run;
      return () => {};
    },
  });
  try {
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const x of [10, 20, 30]) {
      state = { ...state, transform: [x, 0, 1] };
      geometryChanged();
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    published();
    expect(refresh).toHaveBeenCalledTimes(2);
    state = { ...state, transform: [-10000, 0, 1] };
    geometryChanged();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(refresh.mock.calls.at(-1)![2]).toEqual(new Set(["1"]));
  } finally {
    dispose();
    refresh.mockRestore();
  }
});
