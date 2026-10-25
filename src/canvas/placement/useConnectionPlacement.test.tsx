import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { createInteractionController } from "../interaction/controller";
import type { CanvasSurface } from "../menus/useCanvasMenus";
import { useConnectionPlacement } from "./useConnectionPlacement";

const flow = vi.hoisted(() => ({
  state: { connection: { fromHandle: {} }, cancelConnection: vi.fn() },
  setState: vi.fn(),
  subscribe: () => () => {},
}));
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({}),
  useStoreApi: () => ({ getState: () => flow.state, setState: flow.setState, subscribe: flow.subscribe }),
}));
vi.mock("../interaction/connectDots", () => ({
  requestDots: vi.fn(),
  onDots: () => () => {},
  connectionMarks: () => ({ show: vi.fn(), clear: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function connectionHarness() {
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
  return { document, released, menus, onConnectStart };
}

it("cancels a connection without a TouchEvent constructor and still releases XYHandle", () => {
  const { menus, onConnectStart, released } = connectionHarness();
  onConnectStart(new MouseEvent("mousedown"), { nodeId: "source", handleId: "right", handleType: "source" });
  expect(menus.gesture?.kind).toBe("connect");
  expect(() => menus.endGesture(menus.gesture!.seq, "cancel")).not.toThrow();
  expect(menus.gesture).toBeNull();
  expect(flow.state.cancelConnection).toHaveBeenCalledOnce();
  expect(flow.setState).toHaveBeenLastCalledWith({ connectionClickStartHandle: null });
  expect(released).toHaveBeenCalledOnce();
});

it("only the owning touch cancels a live connection and a fresh gesture can start", () => {
  const { document, menus, onConnectStart, released } = connectionHarness();
  const start = () =>
    onConnectStart(
      Object.assign(new Event("touchstart"), {
        touches: [{ identifier: 7, clientX: 10, clientY: 20 }],
      }) as unknown as TouchEvent,
      { nodeId: "source", handleId: "right", handleType: "source" },
    );
  start();
  const seq = menus.gesture!.seq;
  expect(menus.gesture?.via).toBe("touch");
  const cancel = (identifier: number) =>
    document.dispatchEvent(
      Object.assign(new Event("touchcancel"), {
        changedTouches: [{ identifier }],
      }),
    );
  cancel(8);
  expect(menus.gesture?.seq).toBe(seq);
  cancel(7);
  expect(menus.gesture).toBeNull();
  expect(flow.state.cancelConnection).toHaveBeenCalledOnce();
  expect(released).toHaveBeenCalledOnce();
  start();
  expect(menus.gesture!.seq).toBeGreaterThan(seq);
  cancel(7);
  expect(menus.gesture).toBeNull();
  expect(released).toHaveBeenCalledTimes(2);
});
