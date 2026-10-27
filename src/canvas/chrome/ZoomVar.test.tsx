// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import { ZoomVar } from "./CanvasControls";
import { identityZoom, mountIdentityZoom } from "../identityZoom";
import { machinePaths } from "../../lib/machine";

vi.mock("../camera/useCameraCore", () => ({ useCameraController: () => null }));

it("holds identity layout within a zoom step, then restores exact scale at gesture end", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++next, run);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const frame = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const run of pending) run(0);
  };
  let store: ReturnType<typeof useStoreApi> | undefined;
  const host = document.createElement("div");
  const mount = document.createElement("div");
  const root = createRoot(mount);
  const ref = { current: host };
  function Probe() {
    const api = useStoreApi();
    useLayoutEffect(() => {
      store = api;
      return mountIdentityZoom(host, api, null);
    }, [api]);
    return <ZoomVar host={ref} />;
  }
  try {
    await act(() =>
      root.render(
        <ReactFlowProvider>
          <Probe />
        </ReactFlowProvider>,
      ),
    );
    const api = store!;
    await act(() => api.setState({ transform: [0, 0, 0.25] }));
    const writes = vi.spyOn(host.style, "setProperty");
    api.getState().onViewportChangeStart?.({ x: 0, y: 0, zoom: 0.25 });
    expect(host).toHaveProperty("dataset.viewportMoving", "");
    for (const zoom of [0.26, 0.27, 0.28, 0.29]) {
      await act(() => api.setState({ transform: [0, 0, zoom] }));
      const identity = Number(host.style.getPropertyValue("--rf-zoom-exact"));
      expect(identity).toBe(0.25);
      expect((9.5 * zoom) / identity).toBeGreaterThanOrEqual(9.5);
    }
    expect(writes.mock.calls.filter(([key]) => key === "--rf-zoom-exact")).toHaveLength(0);
    api.getState().onViewportChangeEnd?.({ x: 0, y: 0, zoom: 0.29 });
    frame();
    frame();
    frame();
    expect(host.style.getPropertyValue("--rf-zoom-exact")).toBe("0.25");
    frame();
    expect(host.style.getPropertyValue("--rf-zoom-exact")).toBe("0.29");
    expect(host.hasAttribute("data-viewport-moving")).toBe(false);
    expect(writes.mock.calls.filter(([key]) => key === "--rf-zoom-exact")).toHaveLength(1);
    writes.mockRestore();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps repeated starts and late ends well-defined", () => {
  for (const path of machinePaths(identityZoom, { maxDepth: 4 }))
    expect(path.state.value).toBe(path.events.at(-1)?.type === "start" ? "moving" : "settled");
});
