import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LiveController } from "../../live/controller";
import { planningHost } from "../../live/planningHost";
import type { LiveUi } from "../../live/context";
import { breakerFixture } from "../../lab/resilienceFixture";
import { useCallerOverride } from "./useCallerOverride";

const snapshots = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => {
    snapshots.push(snapshot);
    return snapshot();
  },
}));

it("does not invalidate the edge inspector on ticks, but observes policy edits and run removal", () => {
  const title = "Test";
  const emptyTitle = "No overrides";
  const controller = new LiveController(breakerFixture());
  const stop = planningHost.publish({ controller } as LiveUi);
  function Probe() {
    useCallerOverride("call");
    return null;
  }
  try {
    controller.setBase({
      id: "test",
      title,
      traffic: [],
      setup: { edges: { call: { caller: { wait: "blocking" } } } },
    });
    renderToStaticMarkup(<Probe />);
    const read = snapshots.at(-1)!;
    const before = read();
    expect(before).toEqual({ wait: "blocking" });
    const state = controller.getState();
    controller.step(100);
    expect(controller.getState()).not.toBe(state);
    expect(read()).toBe(before);
    controller.setBase({
      id: "test",
      title,
      traffic: [],
      setup: { edges: { call: { caller: { wait: "non-blocking" } } } },
    });
    expect(read()).toEqual({ wait: "non-blocking" });
    expect(read()).not.toBe(before);
    controller.setBase({ id: "empty", title: emptyTitle, traffic: [] });
    expect(read()).toBeUndefined();
  } finally {
    stop();
    controller.dispose();
    snapshots.length = 0;
  }
});
