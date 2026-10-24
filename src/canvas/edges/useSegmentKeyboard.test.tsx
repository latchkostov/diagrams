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
import type { KeyboardLeg } from "../interaction/types";

const keyboard = vi.hoisted(() => {
  let selected: { edge: string; k: number; leg?: KeyboardLeg } | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => ({ keyboardSegment: selected }),
    stepSegment: (edge: string, k: number, leg?: KeyboardLeg) => {
      selected = { edge, k, leg };
      for (const listener of listeners) listener();
      return k;
    },
    reset: () => {
      selected = undefined;
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
    render: (route: EdgeRoute) =>
      act(() =>
        root.render(
          <DiagramContext.Provider
            value={{ direction: "LR", editing: null, setEditing() {}, openEdgeMenu() {}, reshape }}
          >
            <Shape route={route} />
          </DiagramContext.Provider>,
        ),
      ),
    active: () => Number(host.querySelector('[data-testid="active"]')?.textContent),
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
it("reconciles selection as endpoint rerouting inserts and removes legs, then keeps nudging", async () => {
  const h = await harness();
  try {
    await h.render(route(0, 240));
    await h.press("ArrowLeft");
    await h.render(route(0, 230));
    expect(h.active()).toBe(3);
    expect(keyboard.getSnapshot().keyboardSegment?.k).toBe(3);
    // Moving/reconnecting the source farther left removes the escape detour.
    await h.render(route(-100, 230));
    expect(h.active()).toBe(1);
    expect(keyboard.getSnapshot().keyboardSegment?.k).toBe(1);
    await h.press("ArrowLeft");
    expect(h.reshape.mock.lastCall?.[1]).toEqual({
      waypoints: [
        { x: 220, y: 36 },
        { x: 220, y: 336 },
      ],
    });
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
