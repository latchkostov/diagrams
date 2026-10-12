import { describe, expect, it, vi } from "vitest";
import kafka from "../../examples/kafka-order-pipeline.json";
import type { DiagramFile } from "../../model/types";
import type { LiveController, LiveState } from "../../live/controller";
import type { LiveSessionHandle } from "../../live/LiveView";
import { MAX_DIAGRAM_CHARS, type HostMessage, type LoadOptions } from "./hostProtocol";
import { hostReducer, initialHostState, loadDiagram, type Effect, type HostState } from "./hostReducer";
import { LiveDriver } from "./hostLive";

const diagram = kafka as unknown as DiagramFile;
const sims = (diagram.simulations ?? []).map((s) => s.id);
const firstNode = diagram.nodes[0].id;

function run(messages: HostMessage[], from: HostState = initialHostState) {
  let state = from;
  const effects: Effect[] = [];
  for (const m of messages) {
    const r = hostReducer(state, m);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const load = (d: unknown = diagram, options: LoadOptions = {}): HostMessage => ({
  type: "load",
  id: "L",
  diagram: d,
  options,
});
const posts = (effects: Effect[]) => effects.flatMap((e) => (e.kind === "post" ? [e.message] : []));

describe("host embed reducer: load", () => {
  it("shows a valid diagram, private, and replies loaded with its simulations", () => {
    const { state, effects } = run([load(diagram, { simulation: sims[0], autoplay: true, speed: 2, theme: "dark" })]);
    expect(state.diagram?.title).toBe(diagram.title);
    expect(state.diagram?.private).toBe(true);
    expect(state.generation).toBe(1);
    expect(state.options).toEqual({ theme: "dark", simulation: sims[0], autoplay: true, speed: 2, fit: true });
    expect(effects).toContainEqual({ kind: "theme", theme: "dark" });
    expect(posts(effects)).toEqual([
      {
        type: "loaded",
        id: "L",
        title: diagram.title,
        nodes: diagram.nodes.length,
        simulations: (diagram.simulations ?? []).map((s) => ({ id: s.id, title: s.title })),
      },
    ]);
  });

  it("accepts the JSON text too, and defaults the options", () => {
    const { state } = run([load(JSON.stringify(diagram))]);
    expect(state.diagram?.nodes).toHaveLength(diagram.nodes.length);
    expect(state.options).toEqual({ theme: null, simulation: null, autoplay: false, speed: null, fit: true });
  });

  it("rejects an oversized diagram before parsing it, and an invalid one with the validator's reason", () => {
    const big = run([load("x".repeat(MAX_DIAGRAM_CHARS + 1))]);
    expect(posts(big.effects)).toEqual([expect.objectContaining({ type: "error", id: "L", code: "too_large" })]);
    expect(big.state.diagram).toBeNull();
    expect(big.state.error).toMatch(/too large/);

    const bad = run([load({ format: "diagrams/v1", title: "x" })]);
    expect(posts(bad.effects)).toEqual([
      expect.objectContaining({ type: "error", code: "invalid_diagram", message: expect.stringMatching(/nodes/) }),
    ]);
    expect(posts(run([load("{nope")]).effects)[0]).toMatchObject({ code: "invalid_diagram", message: /valid JSON/ });
    expect(posts(run([load({ format: "something/else", nodes: [] })]).effects)[0]).toMatchObject({
      code: "invalid_diagram",
    });
  });

  it("keeps the diagram on screen when a later load fails, and replaces it when one succeeds", () => {
    const first = run([load()]);
    const failed = run([load("{nope")], first.state);
    expect(failed.state).toBe(first.state);
    const other = { ...diagram, title: "Second" };
    const second = run([{ type: "highlight", nodeIds: [firstNode] }, load(other)], first.state);
    expect(second.state.diagram?.title).toBe("Second");
    expect(second.state.generation).toBe(2);
    // A new diagram starts without the old highlights.
    expect(second.state.highlight).toEqual([]);
  });

  it("refuses a start simulation the diagram doesn't have", () => {
    const { state, effects } = run([load(diagram, { simulation: "nope" })]);
    expect(state.diagram).toBeNull();
    expect(posts(effects)[0]).toMatchObject({ type: "error", code: "unknown_simulation" });
  });

  it("validates with the app's own validator (the same limits as opening a file)", () => {
    expect(
      loadDiagram({
        format: "diagrams/v1",
        nodes: Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}` })),
        edges: [],
      }),
    ).toMatchObject({ ok: false, tooLarge: false, message: /5001 nodes/ });
  });
});

describe("host embed reducer: the control API", () => {
  it("needs a diagram first (except setTheme)", () => {
    for (const m of [
      { type: "play" },
      { type: "pause" },
      { type: "setSpeed", speed: 2 },
      { type: "selectSimulation", simulation: null },
      { type: "fit" },
      { type: "highlight", nodeIds: [] },
    ] as HostMessage[]) {
      const { effects, state } = run([{ ...m, id: "q" }]);
      expect(state).toBe(initialHostState);
      expect(posts(effects)).toEqual([expect.objectContaining({ type: "error", id: "q", code: "not_loaded" })]);
    }
    const themed = run([{ type: "setTheme", theme: "dark" }]);
    expect(themed.effects).toEqual([{ kind: "theme", theme: "dark" }]);
    expect(themed.state.options.theme).toBe("dark");
    // The theme carries over to the next load.
    expect(run([load()], themed.state).state.options.theme).toBe("dark");
  });

  it("turns play, pause, speed and simulation into live commands", () => {
    const { state } = run([load()]);
    const live = (m: HostMessage) => hostReducer(state, m).effects;
    expect(live({ type: "play" })).toEqual([{ kind: "live", op: { kind: "play" } }]);
    expect(live({ type: "pause" })).toEqual([{ kind: "live", op: { kind: "pause" } }]);
    expect(live({ type: "setSpeed", speed: 4 })).toEqual([{ kind: "live", op: { kind: "speed", speed: 4 } }]);
    expect(live({ type: "selectSimulation", simulation: sims[1] })).toEqual([
      { kind: "live", op: { kind: "simulation", id: sims[1] } },
    ]);
    expect(live({ type: "selectSimulation", simulation: null })).toEqual([
      { kind: "live", op: { kind: "simulation", id: null } },
    ]);
    expect(posts(live({ type: "selectSimulation", simulation: "nope", id: "s" }))).toEqual([
      expect.objectContaining({ type: "error", id: "s", code: "unknown_simulation" }),
    ]);
    expect(live({ type: "fit" })).toEqual([{ kind: "fit" }]);
  });

  it("highlights only nodes of this diagram", () => {
    const { state } = run([load(), { type: "highlight", nodeIds: [firstNode, "not-a-node"] }]);
    expect(state.highlight).toEqual([firstNode]);
    expect(run([{ type: "highlight", nodeIds: [] }], state).state.highlight).toEqual([]);
  });
});

describe("host embed: the live driver", () => {
  function fakeSession(initial: Partial<LiveState> = {}) {
    let st = { playing: false, speed: 1, simulation: null, ...initial } as LiveState;
    const listeners = new Set<() => void>();
    const controller = {
      getState: () => st,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      setPlaying: vi.fn((on: boolean) => {
        st = { ...st, playing: on };
        listeners.forEach((l) => l());
      }),
      setSpeed: vi.fn((speed: number) => {
        st = { ...st, speed };
        listeners.forEach((l) => l());
      }),
    } as unknown as LiveController;
    const session: LiveSessionHandle = {
      controller,
      selectSimulation: vi.fn((id: string | null) => {
        st = { ...st, playing: true, simulation: id ? ({ id } as LiveState["simulation"]) : null };
        listeners.forEach((l) => l());
      }),
    };
    return { session, controller, listeners };
  }

  it("goes live for play or a simulation, then applies what waited, in order", () => {
    const sent: unknown[] = [];
    const d = new LiveDriver((m) => sent.push(m));
    const goLive = vi.fn();
    d.setHandle({ goLive, live: false, session: null });
    d.run({ kind: "speed", speed: 4 });
    expect(goLive).not.toHaveBeenCalled();
    d.run({ kind: "simulation", id: "s1" });
    expect(goLive).toHaveBeenCalledTimes(1);
    const { session, controller } = fakeSession();
    d.setHandle({ goLive, live: true, session });
    expect(controller.setSpeed).toHaveBeenCalledWith(4);
    expect(session.selectSimulation).toHaveBeenCalledWith("s1");
    expect(sent).toContainEqual({ type: "simulationChanged", simulation: "s1" });
    expect(sent).toContainEqual({ type: "playState", playing: true, speed: 4 });
  });

  it("starts playback queued before the first handle attaches", () => {
    // Right after `loaded` the canvas may still be downloading: there's no handle to go live with yet.
    const d = new LiveDriver(() => {});
    d.run({ kind: "play" });
    const goLive = vi.fn();
    d.setHandle({ goLive, live: false, session: null });
    expect(goLive).toHaveBeenCalledTimes(1);
    // Live view turned on; its session is still starting: no second goLive.
    d.setHandle({ goLive, live: true, session: null });
    expect(goLive).toHaveBeenCalledTimes(1);
    const { session, controller } = fakeSession();
    d.setHandle({ goLive, live: true, session });
    expect(controller.setPlaying).toHaveBeenCalledWith(true);

    const d2 = new LiveDriver(() => {});
    d2.run({ kind: "simulation", id: "s2" });
    const goLive2 = vi.fn();
    d2.setHandle({ goLive: goLive2, live: false, session: null });
    expect(goLive2).toHaveBeenCalledTimes(1);
    const s2 = fakeSession();
    d2.setHandle({ goLive: goLive2, live: true, session: s2.session });
    expect(s2.session.selectSimulation).toHaveBeenCalledWith("s2");
  });

  it("keeps a pause while a session is on its way, in order", () => {
    // play, then pause, before the session is up: it ends paused.
    const d = new LiveDriver(() => {});
    d.setHandle({ goLive: () => {}, live: false, session: null });
    d.run({ kind: "play" });
    d.run({ kind: "pause" });
    const a = fakeSession();
    d.setHandle({ goLive: () => {}, live: true, session: a.session });
    expect(vi.mocked(a.controller.setPlaying).mock.calls).toEqual([[true], [false]]);
    expect(a.controller.getState().playing).toBe(false);

    // An autoplay load, then pause, before the canvas exists: the session starts playing, then pauses.
    const auto = new LiveDriver(() => {});
    auto.run({ kind: "pause" });
    auto.setHandle({ goLive: () => {}, live: true, session: null });
    const b = fakeSession({ playing: true });
    auto.setHandle({ goLive: () => {}, live: true, session: b.session });
    expect(b.controller.getState().playing).toBe(false);

    // A simulation switch (which plays), then pause: paused on the new simulation.
    const sw = new LiveDriver(() => {});
    sw.setHandle({ goLive: () => {}, live: false, session: null });
    sw.run({ kind: "simulation", id: "s1" });
    sw.run({ kind: "pause" });
    const c = fakeSession();
    sw.setHandle({ goLive: () => {}, live: true, session: c.session });
    expect(c.controller.getState()).toMatchObject({ playing: false, simulation: { id: "s1" } });
  });

  it("drops a pause when live view is off and nothing turns it on", () => {
    const d = new LiveDriver(() => {});
    d.run({ kind: "pause" });
    // The canvas arrives with live view off (a static load): nothing to pause, nothing kept for later.
    d.setHandle({ goLive: () => {}, live: false, session: null });
    const s = fakeSession({ playing: true });
    d.setHandle({ goLive: () => {}, live: true, session: s.session });
    expect(s.controller.setPlaying).not.toHaveBeenCalled();
    // And while off, a pause alone is ignored.
    const off = new LiveDriver(() => {});
    off.setHandle({ goLive: () => {}, live: false, session: null });
    off.run({ kind: "pause" });
    const t = fakeSession({ playing: true });
    off.setHandle({ goLive: () => {}, live: true, session: t.session });
    expect(t.controller.setPlaying).not.toHaveBeenCalled();
  });

  it("reports play state and simulation changes once each, and stops listening when the session ends", () => {
    const sent: unknown[] = [];
    const d = new LiveDriver((m) => sent.push(m));
    const { session, controller, listeners } = fakeSession({ playing: true });
    d.setHandle({ goLive: () => {}, live: true, session });
    expect(sent).toEqual([
      { type: "playState", playing: true, speed: 1 },
      { type: "simulationChanged", simulation: null },
    ]);
    sent.length = 0;
    d.run({ kind: "pause" });
    controller.setSpeed(1); // no change: nothing new to say
    expect(sent).toEqual([{ type: "playState", playing: false, speed: 1 }]);
    d.run({ kind: "play" });
    d.setHandle({ goLive: () => {}, live: false, session: null });
    expect(listeners.size).toBe(0);
    expect(sent.at(-1)).toEqual({ type: "playState", playing: false, speed: 1 });
  });
});
