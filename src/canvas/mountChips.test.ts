// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { useStoreApi } from "@xyflow/react";
import { mountChips } from "./mountChips";
import type { ChipState } from "./lowZoom";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { suspendFrameCapture } from "./camera/frameCapture";

vi.mock("./edges/useEdgeRoute", () => ({ selectRoutes: () => new Map() }));

it("publishes only settled layouts, reuses pan, and restores natural cards for capture", async () => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (s: string) => ({ width: s.length * 6 }),
  } as CanvasRenderingContext2D);
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    const pending = [...frames.values()];
    frames.clear();
    for (const run of pending) run(0);
  };
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  let state = {
    transform: [0, 0, 0.65],
    nodes: [],
    edges: [],
    nodeLookup: new Map([
      [
        "worker",
        {
          id: "worker",
          type: "diagram",
          data: { label: "Feature server" },
          measured: { width: 220, height: 72 },
          internals: { positionAbsolute: { x: 0, y: 0 } },
        },
      ],
    ]),
  } as unknown as ChipState;
  const listeners = new Set<(s: ChipState, old: ChipState) => void>();
  const store = {
    getState: () => state,
    setState: (patch: Partial<ChipState>) => {
      const old = state;
      state = { ...state, ...patch };
      for (const run of listeners) run(state, old);
    },
    subscribe: (run: (s: ChipState, old: ChipState) => void) => {
      listeners.add(run);
      return () => listeners.delete(run);
    },
  };
  const dispose = mountChips(
    root,
    store as unknown as ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>,
    null,
    { style: "smoothstep", direction: "LR" },
    null,
  );
  try {
    await flush();
    expect(state.ldChips).toBeUndefined();
    root.setAttribute("data-viewport-moving", "");
    store.setState({ transform: [0, 0, 0.4] });
    await flush();
    expect(state.ldChips).toBeUndefined();
    root.removeAttribute("data-viewport-moving");
    await flush();
    const fitted = state.ldChips;
    expect(fitted?.nodes.get("worker")?.lines).toContain("Feature");
    expect(
      renderToStaticMarkup(createElement("svg", null, fitted?.edge("changed-route", false, false, "M0,0 L320,0"))),
    ).toContain('d="M0,0 L320,0"');
    store.setState({ transform: [120, 50, 0.4] });
    await flush();
    expect(state.ldChips).toBe(fitted);
    const resume = suspendFrameCapture(root.firstElementChild!);
    expect(state.ldChips).toBeNull();
    expect(root.hasAttribute("data-low-zoom")).toBe(false);
    resume();
    await flush();
    expect(state.ldChips?.nodes.get("worker")?.lines).toBe(fitted?.nodes.get("worker")?.lines);
    store.setState({ transform: [0, 0, 0.6] });
    await flush();
    expect(state.ldChips).toBeNull();
  } finally {
    dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
