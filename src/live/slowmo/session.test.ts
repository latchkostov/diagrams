import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { DiagramFile, Simulation } from "../../model/types";
import type { SimEngine } from "../../sim/types";
import { stencilRole } from "../../stencils/roles";
import { LiveController } from "../controller";
import { buildScript } from "./script";
import { SlowMotion } from "./session";

const kafka = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
const stencils = new Map(kafka.nodes.map((n) => [n.id, n.stencil]));
const roleOf = (id: string) => stencilRole(stencils.get(id) ?? "");

/** Look-ahead slices run at once (no browser frames in tests). */
const now = (work: () => void) => {
  work();
  return () => {};
};

function setup(opts: { traffic: boolean; play?: number; sim?: string; replayDelayMs?: number }) {
  const c = new LiveController(kafka, { replayDelayMs: opts.replayDelayMs ?? 0 });
  if (opts.sim) c.selectSimulation(kafka.simulations!.find((s) => s.id === opts.sim)!);
  c.setTraffic(opts.traffic);
  c.setPlaying(true);
  for (let i = 0; i < (opts.play ?? 0); i++) c.advance(16);
  const slow = new SlowMotion(c, {
    build: (trace, waiting) => buildScript({ trace, diagram: kafka, roleOf, waiting }),
    schedule: now,
  });
  slow.watch();
  const engine = (c as unknown as { engine: SimEngine }).engine;
  return { c, slow, engine };
}

/** The engine's whole visible state, to compare before and after. */
const fingerprint = (engine: SimEngine) => {
  const s = engine.snapshot();
  return JSON.stringify({ time: s.time, particles: s.particles, nodes: s.nodes, inSystem: s.inSystem });
};

describe("slow motion session", () => {
  it.each([0, 2000])("starting from paused Inputs waits for the rebuild before recording (at %s)", (at) => {
    vi.useFakeTimers();
    try {
      const { c, slow } = setup({ traffic: true, sim: "black-friday", replayDelayMs: 250 });
      c.seek(at);
      vi.runAllTimers();
      c.setPlaying(false);
      c.subscribe(() => {
        if (c.getState().generation !== generation) {
          generation = c.getState().generation;
          slow.drop();
        }
      });
      let generation = c.getState().generation;
      c.setInputs({ ...c.getState().inputs, traffic: 14, scale: 10 });
      expect(c.busy).toBe(true);
      slow.start({ kind: "next", node: "shopper" });
      vi.runAllTimers();
      expect(c.busy).toBe(false);
      expect(slow.getState().status).toBe("on");
      expect(c.isPlaying).toBe(false);
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("restores live speed when a new watch request leaves replay waiting for a message", () => {
    const { c, slow } = setup({ traffic: true, play: 30 });
    c.setSpeed(8);
    slow.start({ kind: "next" });
    c.setSpeed(0.5);
    c.setTraffic(false);
    slow.start({ kind: "next", node: "unreachable" });
    expect(slow.getState().status).toBe("armed");
    expect(c.getState().speed).toBe(8);
    slow.end();
    expect(c.getState().speed).toBe(8);
  });

  it.each([0.25, 2, 8])("starts at 1× from live %s×, allows pace changes, then restores live speed", (speed) => {
    const { c, slow } = setup({ traffic: true, play: 30 });
    c.setSpeed(speed);
    slow.start({ kind: "next" });
    expect(c.getState().speed).toBe(1);
    c.setSpeed(0.5);
    slow.advance(1000, c.getState().speed);
    expect(slow.getState().t).toBe(500);
    slow.restart();
    expect(c.getState().speed).toBe(0.5);
    slow.start({ kind: "followed" });
    expect(c.getState().speed).toBe(1);
    slow.end();
    expect(c.getState().speed).toBe(speed);
    slow.start({ kind: "followed" });
    expect(c.getState().speed).toBe(1);
    slow.drop();
    expect(c.getState().speed).toBe(speed);
  });

  it("records the next order ahead, rewinds exactly, and replays it", () => {
    const { c, slow, engine } = setup({ traffic: true, play: 90 });
    const before = fingerprint(engine);
    const time = engine.metrics().time;
    slow.start({ kind: "next", node: "shopper" });
    const s = slow.getState();
    expect(s.status).toBe("on");
    expect(s.playing).toBe(true);
    expect(s.trace?.done).toBe(true);
    expect(s.trace?.origin).toBe("shopper");
    expect(s.script!.duration).toBeGreaterThan(15_000);
    // Live is frozen exactly where it was.
    expect(c.isPlaying).toBe(false);
    expect(fingerprint(engine)).toBe(before);
    expect(engine.metrics().time).toBe(time);
    c.advance(500);
    expect(fingerprint(engine)).toBe(before);
    // Live keeps following the same message.
    expect(c.tracedRoot).toBe(s.trace!.rootId);

    slow.end();
    expect(slow.getState().status).toBe("off");
    expect(c.isPlaying).toBe(true);
    expect(fingerprint(engine)).toBe(before);
    // Played live, it takes exactly the journey that was replayed.
    for (let i = 0; i < 400 && !c.getState().trace?.current?.done; i++) {
      c.advance(16);
      c.publish();
    }
    expect(c.getState().trace?.current?.steps).toEqual(s.trace!.steps);
  });

  it("plays, pauses, steps hop by hop, seeks a card row and replays", () => {
    const { slow } = setup({ traffic: true, play: 30 });
    slow.start({ kind: "next" });
    const script = slow.getState().script!;
    slow.advance(1000, 1);
    expect(slow.getState().t).toBe(1000);
    slow.advance(1000, 0.5);
    expect(slow.getState().t).toBe(1500);
    slow.toggle();
    expect(slow.getState().playing).toBe(false);
    slow.advance(1000, 1);
    expect(slow.getState().t).toBe(1500);
    slow.step(1);
    expect(slow.getState().t).toBe(script.stops.find((x) => x > 1500));
    expect(slow.getState().playing).toBe(false);
    slow.step(-1);
    expect(slow.getState().t).toBeLessThan(1500);
    const [key, at] = [...script.rowStart].at(-1)!;
    expect(slow.seekRow(key)).toBe(true);
    expect(slow.getState().t).toBe(at);
    expect(slow.getState().row).toBe(key);
    expect(slow.seekRow("nope")).toBe(false);
    slow.play();
    slow.advance(1e9, 1);
    expect(slow.getState().done).toBe(true);
    expect(slow.getState().playing).toBe(false);
    expect(slow.getState().caption).toMatch(/^Done · /);
    const take = slow.getState().take;
    slow.play();
    expect(slow.getState().t).toBe(0);
    expect(slow.getState().take).toBe(take + 1);
    slow.restart();
    expect(slow.getState().take).toBe(take + 2);
  });

  it("with nothing that can arrive it waits live for the message, then starts", () => {
    const { c, slow } = setup({ traffic: false });
    slow.start({ kind: "next", node: "shopper" });
    expect(slow.getState().status).toBe("armed");
    expect(slow.getState().armedAt).toBe("shopper");
    expect(c.getState().trace?.pending).toEqual({ next: "message", node: "shopper" });
    expect(c.isPlaying).toBe(true);
    c.sendOne("shopper");
    expect(slow.getState().status).toBe("on");
    expect(slow.getState().trace?.done).toBe(true);
    expect(c.isPlaying).toBe(false);
    slow.end();
    expect(c.isPlaying).toBe(true);
  });

  it("replays a recorded journey without looking ahead, and a saved run comes back to the same moment", () => {
    const { c, slow, engine } = setup({ traffic: false, sim: "payments-outage", play: 120 });
    c.setPlaying(false);
    const time = engine.metrics().time;
    const before = fingerprint(engine);
    slow.start({ kind: "next" });
    expect(slow.getState().status).toBe("on");
    const root = slow.getState().trace!.rootId;
    slow.end();
    expect(c.isPlaying).toBe(false);
    expect(engine.metrics().time).toBe(time);
    expect(fingerprint(engine)).toBe(before);
    expect(c.getState().run?.time).toBe(time);
    slow.start({ kind: "root", rootId: root });
    expect(slow.getState().trace?.rootId).toBe(root);
    slow.end();
  });

  it("Esc while recording the journey rewinds too", () => {
    const { c, slow, engine } = setup({ traffic: true, play: 30 });
    const frames: (() => void)[] = [];
    const deferred = new SlowMotion(c, {
      build: (trace) => buildScript({ trace, diagram: kafka, roleOf }),
      schedule: (work) => {
        frames.push(work);
        return () => frames.splice(frames.indexOf(work), 1);
      },
    });
    const before = fingerprint(engine);
    deferred.start({ kind: "next", node: "payments" });
    expect(deferred.getState().status).toBe("capturing");
    expect(frames.length).toBe(1);
    deferred.end();
    expect(frames.length).toBe(0);
    expect(deferred.getState().status).toBe("off");
    expect(fingerprint(engine)).toBe(before);
    expect(c.isPlaying).toBe(true);
    void slow;
  });

  it("holds live while it records and replays: play, step, continue and seek do nothing", () => {
    const { c, engine } = setup({ traffic: false, sim: "payments-outage" });
    const frames: (() => void)[] = [];
    const slow = new SlowMotion(c, {
      build: (trace) => buildScript({ trace, diagram: kafka, roleOf }),
      schedule: (work) => {
        frames.push(work);
        return () => frames.splice(frames.indexOf(work), 1);
      },
    });
    const time = engine.metrics().time;
    slow.start({ kind: "next", node: "payment-db" });
    expect(slow.getState().status).toBe("capturing");
    expect(c.isHeld).toBe(true);
    // Between look-ahead slices: every live control is ignored.
    const poke = () => {
      c.togglePlaying();
      c.setPlaying(true);
      c.step();
      c.resume();
      c.seek(time + 2000);
    };
    poke();
    expect(c.isPlaying).toBe(false);
    for (let i = 0; i < 200 && frames.length; i++) frames.shift()!();
    expect(slow.getState().status).toBe("on");
    expect(c.isPlaying).toBe(false);
    // Replaying: still held, live stays exactly where it was.
    poke();
    c.advance(500);
    expect(c.isPlaying).toBe(false);
    expect(engine.metrics().time).toBe(time);
    slow.end();
    expect(c.isHeld).toBe(false);
    expect(c.isPlaying).toBe(true);
  });

  it("keeps its message when the timeline's trace actions would pick another", () => {
    const sim: Simulation = {
      id: "retrace",
      title: "Retrace",
      scale: 1,
      traffic: [
        { id: "first", node: "shopper", shape: { kind: "burst", count: 1, atMs: 100 } },
        { id: "second", node: "shopper", shape: { kind: "burst", count: 1, atMs: 300 } },
      ],
      timeline: [{ atMs: 200, action: { do: "trace", node: "shopper" } }],
    };
    const c = new LiveController(kafka, { replayDelayMs: 0 });
    c.selectSimulation(sim);
    const slow = new SlowMotion(c, {
      build: (trace) => buildScript({ trace, diagram: kafka, roleOf }),
      schedule: now,
    });
    slow.start({ kind: "next", node: "shopper" });
    const s = slow.getState();
    expect(s.status).toBe("on");
    // The first order (emitted at 100 ms), told to its end, not the one the trace action asked for.
    expect(s.trace?.startedAt).toBe(100);
    expect(s.trace?.done).toBe(true);
    // Back live, the timeline's trace actions run again.
    slow.end();
    c.setPlaying(true);
    for (let i = 0; i < 40; i++) c.advance(16);
    c.publish();
    expect(c.getState().trace?.current?.startedAt).toBe(300);
  });

  it("passes every pausing note at one moment before looking further ahead", () => {
    const sim: Simulation = {
      id: "notes",
      title: "Notes",
      scale: 1,
      traffic: [{ id: "later", node: "shopper", shape: { kind: "burst", count: 1, atMs: 100 } }],
      timeline: [
        { atMs: 0, action: { do: "note", text: "One", pause: true } },
        { atMs: 0, action: { do: "note", text: "Two", pause: true } },
      ],
    };
    const c = new LiveController(kafka, { replayDelayMs: 0 });
    c.selectSimulation(sim);
    expect(c.getState().run?.waiting).toBe(true);
    const slow = new SlowMotion(c, {
      build: (trace) => buildScript({ trace, diagram: kafka, roleOf }),
      schedule: now,
    });
    slow.start({ kind: "next" });
    expect(slow.getState().status).toBe("on");
    expect(slow.getState().trace?.origin).toBe("shopper");
    // Live comes back at its first note.
    slow.end();
    expect(c.getState().run?.waiting).toBe(true);
    expect(c.getState().run?.time).toBe(0);
  });

  it("drop() forgets slow motion after the engine was rebuilt", () => {
    const { c, slow } = setup({ traffic: true, play: 30 });
    slow.start({ kind: "next" });
    c.restart();
    slow.drop();
    expect(slow.getState().status).toBe("off");
    expect(c.isPlaying).toBe(false);
    expect(c.isHeld).toBe(false);
  });
});
