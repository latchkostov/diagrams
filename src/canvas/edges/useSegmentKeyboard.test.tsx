// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DiagramContext } from "../DiagramContext";
import { routedPort } from "../geometry/ports";
import { shapedRoute } from "../geometry/shaped";
import type { EdgeRoute } from "../geometry/router";
import { routeSegments } from "./segments";
import { useSegmentKeyboard } from "./useSegmentKeyboard";

const keyboard = vi.hoisted(() => {
  let selected: { edge: string; k: number } | undefined;
  const listeners = new Set<() => void>();
  let observed: { signature: string; expected?: string } | undefined;
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => ({ keyboardSegment: selected }),
    stepSegment: (edge: string, k: number) => {
      selected = { edge, k };
      for (const listener of listeners) listener();
      return k;
    },
    observeSegmentRoute: (edge: string, signature: string) => {
      const before = observed;
      if (before?.signature === signature) return false;
      observed = { signature };
      if (!before || before.expected === signature || selected?.k === -1) return false;
      selected = { edge, k: -1 };
      for (const listener of listeners) listener();
      return true;
    },
    expectSegmentRoute: (_edge: string, signature: string) => {
      if (observed) observed.expected = signature;
    },
    resetSegment: (edge: string) => {
      selected = { edge, k: -1 };
      for (const listener of listeners) listener();
    },
    reset: () => {
      selected = undefined;
      observed = undefined;
    },
  };
});
vi.mock("../interaction/useInteraction", () => ({ useInteraction: () => keyboard }));
afterEach(() => {
  keyboard.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function harness() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const edge = document.createElement("div");
  const marker = document.createElement("div");
  marker.dataset.testid = "edge-test";
  edge.append(marker);
  document.body.append(host, edge);
  const root = createRoot(host);
  const reshape = vi.fn();
  const announce = vi.fn();
  function Shape({ route }: { route: EdgeRoute }) {
    const k = useSegmentKeyboard(
      "test",
      route,
      routeSegments(route.points),
      true,
      () => [24, 24],
      () => true,
    );
    return <output data-testid="active">{k}</output>;
  }
  return {
    edge,
    reshape,
    announce,
    render: (route: EdgeRoute) =>
      act(() =>
        root.render(
          <DiagramContext.Provider
            value={{ direction: "LR", editing: null, setEditing() {}, openEdgeMenu() {}, reshape, announce }}
          >
            <Shape route={route} />
          </DiagramContext.Provider>,
        ),
      ),
    active: () => host.querySelector('[data-testid="active"]')?.textContent,
    press: (key: string) =>
      act(() => {
        edge.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }),
    close: async () => {
      await act(() => root.unmount());
      host.remove();
      edge.remove();
    },
  };
}
function route(sourceX: number, x: number): EdgeRoute {
  const source = { x: sourceX, y: 0, width: 220, height: 72 };
  const target = { x: 600, y: 300, width: 220, height: 72 };
  return {
    points: shapedRoute(
      routedPort(source, "right"),
      "right",
      routedPort(target, "left"),
      "left",
      [
        { x, y: 36 },
        { x, y: 336 },
      ],
      source,
      target,
    ),
    path: "",
    label: null,
    ok: true,
    custom: true,
    sourceSide: "right",
    targetSide: "left",
  };
}
it.each(["pointer shaping", "node moves, reconnects, undo/redo or remote reroutes"])(
  "resets selection after %s and cycles from either end",
  async (cause) => {
    const h = await harness();
    try {
      await h.render(route(-100, 300));
      await h.press("]");
      await h.press("[");
      const changed = cause === "pointer shaping" ? route(-100, 350) : route(0, 230);
      await h.render(changed);
      expect(h.active()).toBe("");
      expect(keyboard.getSnapshot().keyboardSegment).toEqual({ edge: "test", k: -1 });
      expect(h.announce).toHaveBeenLastCalledWith("Segment selection reset");
      await h.press("]");
      expect(h.active()).toBe("0");
      await h.render(route(-100, 400));
      expect(h.active()).toBe("");
      await h.press("[");
      expect(h.active()).toBe("2");
    } finally {
      await h.close();
    }
  },
);
it("keeps a simple keyboard nudge active and reads its geometry from the current route", async () => {
  const h = await harness();
  try {
    await h.render(route(-100, 300));
    await h.press("ArrowRight");
    await h.render(route(-100, 310));
    expect(h.active()).toBe("1");
    expect(keyboard.getSnapshot().keyboardSegment).toEqual({ edge: "test", k: 1 });
    await h.press("ArrowRight");
    expect(h.reshape.mock.lastCall?.[1]).toEqual({
      waypoints: [
        { x: 320, y: 36 },
        { x: 320, y: 336 },
      ],
    });
    await h.render(route(-100, 320));
    expect(h.active()).toBe("1");
    await h.render(route(-100, 360));
    expect(h.active()).toBe("");
  } finally {
    await h.close();
  }
});
it("resets a keyboard nudge that renumbers segments", async () => {
  const h = await harness();
  try {
    await h.render(route(0, 240));
    await h.press("ArrowLeft");
    await h.render(route(0, 230));
    expect(h.active()).toBe("");
    expect(h.announce).toHaveBeenLastCalledWith("Segment selection reset");
    await h.press("]");
    expect(h.active()).toBe("0");
  } finally {
    await h.close();
  }
});
it("keeps its keyboard listener installed across pointer preview renders with fresh inputs", async () => {
  const h = await harness();
  try {
    await h.render(route(0, 240));
    const add = vi.spyOn(h.edge, "addEventListener");
    const remove = vi.spyOn(h.edge, "removeEventListener");
    for (let i = 0; i < 5; i++) await h.render(route(0, 240));
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await h.press("ArrowRight");
    expect(h.reshape.mock.lastCall?.[1]).toEqual({
      waypoints: [
        { x: 250, y: 36 },
        { x: 250, y: 336 },
      ],
    });
  } finally {
    await h.close();
  }
});
