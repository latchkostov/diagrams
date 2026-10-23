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
    readouts: { get: () => null, pin: pinReadout },
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
        readouts: { get: () => ({ kind: "node", id: "a", pinned: true }), close: closeReadout },
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
      interaction: { liveKey: liveKeys, readouts: { get: () => null, pin: pinReadout } },
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

it.each([
  { key: "Enter", pinned: "false", pins: true },
  { key: "Enter", pinned: "true", pins: false },
  { key: " ", pinned: "false", pins: false },
])("$key on a focused summary card pins it only while unpinned (pinned: $pinned)", ({ key, pinned, pins }) => {
  let listener!: (event: KeyboardEvent) => void;
  class Target {
    dataset = { liveReadout: "edge", item: "call", pinned };
    closest(selector: string) {
      return selector === "[data-live-readout]" || selector.includes("[data-canvas-reading-region]") ? this : null;
    }
  }
  const card = new Target();
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {
    addEventListener: (_key: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const pinReadout = vi.fn(),
    togglePlaying = vi.fn();
  function Harness() {
    useLiveKeyboard({
      interaction: {
        liveKey: liveKeys,
        readouts: { get: () => ({ kind: "edge", id: "call", pinned: pinned === "true" }), pin: pinReadout },
      },
      session: { controller: { getState: () => ({}), togglePlaying }, traceRef: {} },
      spotlight: { slowRef: {} },
    } as unknown as Parameters<typeof useLiveKeyboard>[0]);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  listener({
    key,
    target: card,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent);
  expect(pinReadout.mock.calls).toEqual(pins ? [[{ kind: "edge", id: "call" }]] : []);
  // The card's own Space scrolls it: playback never toggles from inside a readout.
  expect(togglePlaying).not.toHaveBeenCalled();
});
