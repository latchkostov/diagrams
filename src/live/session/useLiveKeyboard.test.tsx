import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveKeyboard } from "./useLiveKeyboard";
import type { InteractionController } from "../../canvas/interaction";
import { liveKeys } from "../../canvas/interaction/liveKeys";

const { recording } = vi.hoisted(() => ({ recording: vi.fn(() => false) }));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("../../editor/shortcuts", () => ({ isEditableTarget: () => false }));
vi.mock("../../editor/useCanvasShortcuts", () => ({ inCanvas: () => true }));
vi.mock("../record/framing", () => ({ isRecordingActive: recording }));
afterEach(() => {
  vi.unstubAllGlobals();
  recording.mockReturnValue(false);
});

it("leaves Enter's default activation to a control nested inside a node", () => {
  let listener!: (event: KeyboardEvent) => void;
  class Target {
    dataset = { id: "service" };
    classList = { contains: () => false };
    constructor(readonly control = false) {}
    closest(selector: string) {
      if (selector.startsWith(".react-flow")) return node;
      return this.control ? this : null;
    }
  }
  const node = new Target(),
    button = new Target(true);
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {
    addEventListener: (_key: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const pinReadout = vi.fn();
  const interaction = {
    liveKey: liveKeys,
    getSnapshot: () => ({ readout: null }),
    pinReadout,
  } as unknown as InteractionController;
  function Harness() {
    useLiveKeyboard({
      interaction,
      session: { controller: { getState: () => ({}) }, traceRef: {} },
      spotlight: { slowRef: {} },
    } as unknown as Parameters<typeof useLiveKeyboard>[0]);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const preventDefault = vi.fn(),
    stopImmediatePropagation = vi.fn();
  listener({ key: "Enter", target: button, preventDefault, stopImmediatePropagation } as unknown as KeyboardEvent);
  expect(pinReadout).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(stopImmediatePropagation).not.toHaveBeenCalled();
});

it("lets the recorder own Escape while a readout is pinned", () => {
  recording.mockReturnValue(true);
  let listener!: (event: KeyboardEvent) => void;
  vi.stubGlobal("Element", Object);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {
    addEventListener: (_key: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const closeReadout = vi.fn();
  function Harness() {
    useLiveKeyboard({
      interaction: {
        liveKey: liveKeys,
        getSnapshot: () => ({ readout: { kind: "node", id: "a", pinned: true } }),
        closeReadout,
      },
      session: { controller: { getState: () => ({}) }, traceRef: {} },
      spotlight: { slowRef: {} },
    } as unknown as Parameters<typeof useLiveKeyboard>[0]);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const preventDefault = vi.fn(),
    stopImmediatePropagation = vi.fn();
  listener({ key: "Escape", target: null, preventDefault, stopImmediatePropagation } as unknown as KeyboardEvent);
  expect(closeReadout).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(stopImmediatePropagation).not.toHaveBeenCalled();
});

it.each([
  { mode: "editing", presenting: false, waiting: false, editable: true, pins: false },
  { mode: "presentation", presenting: true, waiting: false, editable: true, pins: true },
  { mode: "read-only", presenting: false, waiting: false, editable: false, pins: true },
  { mode: "waiting narration", presenting: false, waiting: true, editable: true, pins: true },
])("selected Enter respects naming capability in $mode", ({ presenting, waiting, editable, pins }) => {
  let listener!: (event: KeyboardEvent) => void;
  class Target {
    dataset = { id: "service" };
    classList = { contains: (name: string) => name === "selected" };
    closest(selector: string) {
      return selector.startsWith(".react-flow") ? this : null;
    }
  }
  const node = new Target();
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {
    addEventListener: (_key: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const pinReadout = vi.fn();
  function Harness() {
    useLiveKeyboard({
      presenting,
      editor: editable ? {} : undefined,
      interaction: { liveKey: liveKeys, getSnapshot: () => ({ readout: null }), pinReadout },
      session: { controller: { getState: () => ({ run: { waiting } }) }, traceRef: {} },
      spotlight: { slowRef: {} },
    } as unknown as Parameters<typeof useLiveKeyboard>[0]);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  listener({
    key: "Enter",
    target: node,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent);
  expect(pinReadout).toHaveBeenCalledTimes(pins ? 1 : 0);
});
