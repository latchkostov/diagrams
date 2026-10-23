import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { createInteractionController } from "../interaction/controller";
import type { CanvasSurface } from "../menus/useCanvasMenus";
import { useConnectionPlacement } from "./useConnectionPlacement";

const flow = vi.hoisted(() => ({
  state: { connection: { fromHandle: {} }, cancelConnection: vi.fn() },
  setState: vi.fn(),
}));
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({}),
  useStoreApi: () => ({ getState: () => flow.state, setState: flow.setState }),
}));
vi.mock("../interaction/connectDots", () => ({
  requestDots: vi.fn(),
  connectionMarks: () => ({ show: vi.fn(), clear: vi.fn() }),
}));
vi.mock("../interaction/usePointerGesture", () => ({ watchConnectionGesture: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("cancels a connection without a TouchEvent constructor and still releases XYHandle", () => {
  const document = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("MouseEvent", Event);
  vi.stubGlobal("TouchEvent", undefined);
  const released = vi.fn();
  document.addEventListener("mouseup", released);
  const menus = createInteractionController<CanvasSurface>(
    {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
    },
    { frame: () => () => {}, microtask: (run) => run() },
  );
  let onConnectStart!: ReturnType<typeof useConnectionPlacement>[1];
  function Harness() {
    [, onConnectStart] = useConnectionPlacement(
      () => undefined,
      () => {},
      { current: null },
      false,
      false,
      {} as EditorApi,
      (point) => point,
      () => {},
      menus,
    );
    return null;
  }
  renderToStaticMarkup(<Harness />);
  onConnectStart(new MouseEvent("mousedown"), { nodeId: "source", handleId: "right", handleType: "source" });
  expect(menus.gesture?.kind).toBe("connect");
  expect(() => menus.endGesture(menus.gesture!.seq, "cancel")).not.toThrow();
  expect(menus.gesture).toBeNull();
  expect(flow.state.cancelConnection).toHaveBeenCalledOnce();
  expect(flow.setState).toHaveBeenLastCalledWith({ connectionClickStartHandle: null });
  expect(released).toHaveBeenCalledOnce();
});
