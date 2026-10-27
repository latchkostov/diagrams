// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import { ZoomVar } from "./CanvasControls";
import { identityZoom, mountIdentityZoom } from "../identityZoom";
import { machinePaths } from "../../lib/machine";

vi.mock("../camera/useCameraCore", () => ({ useCameraController: () => null }));

for (const { name, camera, holds } of [
  { name: "wheel", camera: null, holds: true },
  {
    name: "manual button animation",
    camera: { phase: "animating", state: { owner: "manual", view: "custom" } },
    holds: true,
  },
  { name: "automatic fit", camera: { phase: "animating", state: { owner: "fit", view: "overview" } }, holds: false },
])
  it(`keeps the identity scale correct through ${name} and quiet frames`, async () => {
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
        return mountIdentityZoom(host, api, camera);
      }, [api, camera]);
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
      expect(host.hasAttribute("data-viewport-moving")).toBe(holds);
      for (const zoom of [0.26, 0.27, 0.28, 0.29]) {
        await act(() => api.setState({ transform: [0, 0, zoom] }));
        const identity = Number(host.style.getPropertyValue("--rf-zoom-exact"));
        expect(identity).toBe(holds ? 0.25 : zoom);
        expect((9.5 * zoom) / identity).toBeGreaterThanOrEqual(9.5);
      }
      expect(writes.mock.calls.filter(([key]) => key === "--rf-zoom-exact")).toHaveLength(holds ? 0 : 4);
      frame();
      frame();
      frame();
      expect(host.style.getPropertyValue("--rf-zoom-exact")).toBe(holds ? "0.25" : "0.29");
      frame();
      expect(host.style.getPropertyValue("--rf-zoom-exact")).toBe("0.29");
      expect(host.hasAttribute("data-viewport-moving")).toBe(false);
      expect(writes.mock.calls.filter(([key]) => key === "--rf-zoom-exact")).toHaveLength(holds ? 1 : 4);
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
