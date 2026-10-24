// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LiveController } from "../../live/controller";
import { planningHost } from "../../live/planningHost";
import type { LiveUi } from "../../live/context";
import { breakerFixture } from "../../lab/resilienceFixture";
import { useCallerOverride } from "./useCallerOverride";

it("edge inspector skips ticks but observes policy and host changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const controller = new LiveController(breakerFixture());
  const container = document.createElement("div");
  const root = createRoot(container);
  let renders = 0;
  const title = "Test";
  function Probe() {
    renders++;
    return <output>{useCallerOverride("call")?.wait ?? "none"}</output>;
  }
  const stop = planningHost.publish({ controller } as LiveUi);
  try {
    controller.setBase({
      id: "test",
      title,
      traffic: [],
      setup: { edges: { call: { caller: { wait: "blocking" } } } },
    });
    await act(() => root.render(<Probe />));
    expect(container.textContent).toBe("blocking");
    const before = renders;
    const state = controller.getState();
    for (let tick = 0; tick < 8; tick++) await act(() => controller.step(100));
    expect(controller.getState()).not.toBe(state);
    expect(renders).toBe(before);
    await act(() =>
      controller.setBase({
        id: "test",
        title,
        traffic: [],
        setup: { edges: { call: { caller: { wait: "non-blocking" } } } },
      }),
    );
    expect(container.textContent).toBe("non-blocking");
    expect(renders).toBeGreaterThan(before);
    await act(() => controller.setBase({ id: "empty", title, traffic: [] }));
    expect(container.textContent).toBe("none");
    await act(() =>
      controller.setBase({
        id: "test",
        title,
        traffic: [],
        setup: { edges: { call: { caller: { wait: "non-blocking" } } } },
      }),
    );
    expect(container.textContent).toBe("non-blocking");
    await act(() => stop());
    expect(container.textContent).toBe("none");
  } finally {
    await act(() => root.unmount());
    stop();
    controller.dispose();
    vi.unstubAllGlobals();
  }
});
