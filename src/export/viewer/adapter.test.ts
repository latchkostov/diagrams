import { describe, expect, it, vi } from "vitest";
import { ViewerAdapter } from "./adapter";
import { textFieldsFixture } from "../../lab/textFieldsFixture";
import type { LiveSessionHandle } from "../../live/LiveView";

describe("platform viewer adapter", () => {
  it("validates loads, never autoplays, and keeps the last good diagram on error", () => {
    const adapter = new ViewerAdapter();
    const loaded = vi.fn();
    const error = vi.fn();
    const changed = vi.fn();
    const goLive = vi.fn();
    adapter.on("loaded", loaded);
    adapter.on("error", error);
    adapter.subscribe(changed);
    expect(adapter.load(textFieldsFixture)).toBe(true);
    adapter.driver.setHandle({ live: false, session: null, goLive });
    expect(goLive).not.toHaveBeenCalled();
    expect(adapter.getSnapshot().options.autoplay).toBe(false);
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ title: "Fields", nodes: 3 }));
    expect(adapter.load("bad JSON")).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "invalid_diagram" }));
    expect(adapter.getSnapshot().diagram?.title).toBe("Fields");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("queues play and stop in order, selects known simulations, and discards commands on load", () => {
    const adapter = new ViewerAdapter();
    const run = vi.spyOn(adapter.driver, "run");
    const error = vi.fn();
    adapter.on("error", error);
    adapter.play();
    expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ code: "not_loaded" }));
    adapter.load({ ...textFieldsFixture, simulations: [{ id: "s", title: "Flow", durationMs: 1000, traffic: [] }] });
    adapter.play("missing");
    expect(run).not.toHaveBeenCalled();
    adapter.play("s");
    adapter.stop();
    expect(run.mock.calls).toEqual([[{ kind: "simulation", id: "s" }], [{ kind: "play" }], [{ kind: "pause" }]]);
    const reset = vi.spyOn(adapter.driver, "reset");
    adapter.load(textFieldsFixture);
    expect(reset).toHaveBeenCalledOnce();
    const goLive = vi.fn();
    adapter.driver.setHandle({ live: false, session: null, goLive });
    expect(goLive).not.toHaveBeenCalled();
  });

  it("reports content height, supports unsubscribe, and releases listeners on disposal", () => {
    const adapter = new ViewerAdapter();
    const size = vi.fn();
    const off = adapter.on("size", size);
    adapter.report({ type: "resize", height: 420 });
    expect(size).toHaveBeenCalledWith({ height: 420 });
    off();
    adapter.report({ type: "resize", height: 500 });
    expect(size).toHaveBeenCalledOnce();
    adapter.on("size", size);
    adapter.dispose();
    adapter.report({ type: "resize", height: 600 });
    expect(size).toHaveBeenCalledOnce();
  });

  it("disposes an attached controller and queued commands without a React unmount", () => {
    const adapter = new ViewerAdapter();
    adapter.load(textFieldsFixture);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const setPlaying = vi.fn();
    const session = {
      controller: { subscribe, setPlaying, getState: () => ({ playing: true, speed: 1, simulation: null }) },
    } as unknown as LiveSessionHandle;
    adapter.driver.setHandle({ live: true, session, goLive: vi.fn() });
    expect(subscribe).toHaveBeenCalledOnce();
    const changed = vi.fn();
    adapter.subscribe(changed);
    adapter.dispose();
    adapter.stop();
    expect(setPlaying).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    adapter.load(textFieldsFixture);
    expect(changed).not.toHaveBeenCalled();

    adapter.play();
    adapter.dispose();
    const goLive = vi.fn();
    adapter.driver.setHandle({ live: false, session: null, goLive });
    expect(goLive).not.toHaveBeenCalled();
  });
});
