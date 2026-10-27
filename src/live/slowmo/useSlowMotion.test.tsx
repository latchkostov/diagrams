import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { CameraController } from "../../canvas/camera";
import { LiveController } from "../controller";
import { useSlowMotion, type SlowMotionView } from "./useSlowMotion";
import { loadSlowScript } from "./scriptChunk";

// Mount the hook's effects after rendering, with a small EventTarget instead of a canvas DOM.
const lifecycle = vi.hoisted(() => ({ effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => lifecycle.effects.push(effect),
  useLayoutEffect: (effect: EffectCallback) => lifecycle.effects.push(effect),
}));

afterEach(() => {
  lifecycle.effects = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([0, 2000])("Escape restores the entry viewport after a pending Inputs rebuild at %s", async (at) => {
  // Slow motion downloads its script code on the first start; here it has arrived.
  await loadSlowScript();
  vi.useFakeTimers();
  const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
  const controller = new LiveController(diagram, { replayDelayMs: 250 });
  controller.selectSimulation(diagram.simulations!.find((s) => s.id === "black-friday")!);
  controller.seek(at);
  vi.runAllTimers();
  controller.setPlaying(false);
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("Element", class extends EventTarget {});
  vi.stubGlobal("HTMLInputElement", class extends EventTarget {});
  const dispatch = vi.fn();
  const camera = { dispatch, slowmo: () => () => {} } as unknown as CameraController;
  const state = {
    transform: [137, -82, 0.75],
    width: 1280,
    height: 800,
    nodeLookup: new Map(),
    domNode: null,
    unselectNodesAndEdges: vi.fn(),
  };
  const store = { getState: () => state } as unknown as Parameters<typeof useSlowMotion>[0]["store"];
  let view!: SlowMotionView;
  function Harness() {
    view = useSlowMotion({
      controller,
      camera,
      store,
      presenting: false,
      reducedMotion: true,
      panelOpen: false,
      capturing: false,
    });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  const cleanup = lifecycle.effects.map((effect) => effect());
  try {
    controller.setInputs({ ...controller.getState().inputs, traffic: 14, scale: 10 });
    expect(controller.busy).toBe(true);
    view.start({ kind: "next", node: "shopper" });
    vi.runAllTimers();
    expect(view.session.getState().status).toBe("on");
    state.transform = [-500, -300, 1.25];
    const escape = new Event("keydown", { cancelable: true });
    Object.defineProperty(escape, "key", { value: "Escape" });
    events.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(view.session.getState().status).toBe("off");
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "slowmo",
      on: false,
      restore: { x: 137, y: -82, zoom: 0.75 },
    });
  } finally {
    for (const stop of cleanup.reverse()) stop?.();
    controller.dispose();
  }
});
