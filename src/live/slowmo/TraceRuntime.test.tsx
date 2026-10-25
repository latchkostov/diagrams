// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lazySurfacesFixture } from "../../lab/lazySurfacesFixture";
import type { CameraController } from "../../canvas/camera";
import { LiveController } from "../controller";
import { createTraceFacade } from "../session/traceFacade";
import { useReplayTrace } from "../session/useReplayTrace";
import { TraceRuntime, type TraceRuntimeProps } from "./TraceRuntime";
import { loadSlowScript } from "./scriptChunk";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("Strict Mode adapter preserves first replay intent, checkpoint, and playing state", async () => {
  await loadSlowScript();
  const controller = new LiveController(lazySurfacesFixture());
  controller.setTraffic(true);
  controller.setPlaying(true);
  const before = { x: 123, y: 45, zoom: 0.8 };
  const facade = createTraceFacade(
    controller,
    () => before,
    () => false,
  );
  const checkpoint = controller.getState().snapshot;
  facade.slow.start({ kind: "next", node: "caller" });
  const dispatch = vi.fn();
  const camera = { dispatch, slowmo: () => () => {} } as unknown as CameraController;
  const store = {
    getState: () => ({
      transform: [0, 0, 1],
      width: 1280,
      height: 800,
      nodeLookup: new Map(),
      domNode: null,
      unselectNodesAndEdges: () => {},
    }),
  } as unknown as TraceRuntimeProps["store"];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <StrictMode>
          <TraceRuntime
            facade={facade}
            controller={controller}
            camera={camera}
            store={store}
            presenting={false}
            reducedMotion={true}
            panelOpen={false}
            capturing={false}
          />
        </StrictMode>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(facade.slow.state.status).toBe("on"));
    });
    expect(facade.slow.state.trace?.origin).toBe("source");
    expect(controller.getState().snapshot).toEqual(checkpoint);
    await act(() => facade.slow.end());
    expect(controller.isHeld).toBe(false);
    expect(controller.isPlaying).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "slowmo", on: false, restore: before });
  } finally {
    await act(() => root.unmount());
    facade.dispose();
    controller.dispose();
    host.remove();
  }
});

it("replay command stays stable across publications and reads the current trace at invocation", async () => {
  const controller = new LiveController(lazySurfacesFixture());
  const facade = createTraceFacade(
    controller,
    () => ({ x: 0, y: 0, zoom: 1 }),
    () => false,
  );
  const start = vi.spyOn(facade.slow, "start").mockImplementation(() => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  let command!: () => void;
  function Harness() {
    command = useReplayTrace(controller, facade.slow);
    return null;
  }
  try {
    await act(() => root.render(<Harness />));
    const first = command;
    vi.spyOn(controller, "getState").mockReturnValue({ ...controller.getState(), trace: { rootId: 42 } });
    await act(() => root.render(<Harness />));
    expect(command).toBe(first);
    command();
    expect(start).toHaveBeenLastCalledWith({ kind: "root", rootId: controller.getState().trace?.rootId });
  } finally {
    await act(() => root.unmount());
    facade.dispose();
    controller.dispose();
  }
});
