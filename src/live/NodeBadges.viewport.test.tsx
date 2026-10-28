// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import { NodeBadges } from "./NodeBadges";
import type { LiveState } from "./controller";
import { waitingFixture } from "../lab/waitingFixture";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({
  useLive: () => {
    rendered();
    return { controller };
  },
}));
vi.mock("../canvas/DiagramContext", () => ({ useDiagram: () => ({ editing: null }) }));
vi.mock("../canvas/interaction", () => ({ useInteraction: () => null }));
const state = {
  inputs: {},
  configuration: {},
  snapshot: { nodes: {}, edges: {} },
} as unknown as LiveState;
const controller = {
  currentDiagram: waitingFixture(),
  getState: () => state,
  subscribe: () => () => {},
};

it("renders badges for viewport membership changes, without rendering for every pan step", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let store: ReturnType<typeof useStoreApi>;
  function Probe() {
    const api = useStoreApi();
    useLayoutEffect(() => {
      store = api;
      const nodes = [0, 10000].map((x, i) => {
        const node = { id: String(i), position: { x, y: 0 }, data: {}, measured: { width: 220, height: 72 } };
        return { ...node, internals: { positionAbsolute: node.position, z: 0, userNode: node } };
      });
      api.setState({
        domNode: host,
        width: 1000,
        height: 800,
        nodeLookup: new Map(nodes.map((n) => [n.id, n])),
      });
    }, [api]);
    return <NodeBadges state={state} presenting={false} />;
  }
  try {
    await act(() =>
      root.render(
        <ReactFlowProvider>
          <Probe />
        </ReactFlowProvider>,
      ),
    );
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    rendered.mockClear();
    for (const x of [10, 20, 30]) await act(() => store.setState({ transform: [x, 0, 1] }));
    expect(rendered).not.toHaveBeenCalled();
    await act(() => store.setState({ transform: [-10000, 0, 1] }));
    expect(rendered).toHaveBeenCalled();
    rendered.mockClear();
    await act(() => store.setState({ transform: [-10010, 0, 1] }));
    expect(rendered).not.toHaveBeenCalled();
    await act(() => store.setState({ transform: [-10010, 0, 0.5] }));
    expect(rendered).toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
