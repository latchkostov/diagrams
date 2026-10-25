import { describe, expect, it } from "vitest";
import type { DiagramFile, SimRole } from "../model/types";
import { createEngine, observeEngineEvents, randomDraws } from "./engine";
import type { SimEvent } from "./types";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Checkpoint regression",
  nodes: [
    { id: "source", stencil: "source", label: "Source", x: 0, y: 0, props: { ratePerSec: 7.3 } },
    { id: "broker", stencil: "topic", label: "Broker", x: 0, y: 0, props: { partitions: 3 } },
    { id: "worker", stencil: "processor", label: "Worker", x: 0, y: 0, props: { failureRate: 0.45, latencyMs: 80 } },
    { id: "sink", stencil: "sink", label: "Sink", x: 0, y: 0 },
    { id: "dlq", stencil: "queue", label: "DLQ", x: 0, y: 0 },
  ],
  edges: [
    { id: "a", from: "source", to: "broker", props: { travelMs: 30 } },
    { id: "b", from: "broker", to: "worker", props: { travelMs: 20, group: "workers" } },
    { id: "c", from: "worker", to: "sink", kind: "sync", props: { travelMs: 40 } },
    { id: "d", from: "broker", to: "dlq", props: { travelMs: 20, dlq: true } },
  ],
};

const makeEngine = () => {
  const engine = createEngine({ seed: 7, maxParticles: 5, roleOf: (id) => id as SimRole });
  engine.load(diagram);
  return engine;
};

describe("engine checkpoints", () => {
  it("replays accounting roots, event-ring order, lineage and RNG at every suffix step", () => {
    const engine = makeEngine();
    engine.tracer.request({ next: "message" });
    engine.inject("source", 150, { spreadMs: 600 });
    engine.setTraffic(true);
    engine.step(413);
    const checkpoint = engine.checkpoint();
    const observed: SimEvent[] = [];
    const stop = observeEngineEvents(engine, (event) => observed.push(event));
    const suffix = () => {
      observed.length = 0;
      return [17, 250, 900, 1500].map((duration, index) => {
        if (index === 1) engine.setScale(2);
        if (index === 2) engine.setNodeProps("worker", { concurrency: 3 });
        engine.step(duration);
        return structuredClone({
          snapshot: engine.snapshot(),
          frame: engine.frame(),
          events: observed,
          metrics: engine.metrics(),
          configuration: engine.configuration(),
          trace: engine.tracer.current(),
          draws: randomDraws(engine),
        });
      });
    };
    const expected = suffix();
    expect(expected.at(-1)!.events.length).toBeGreaterThan(200);
    expect(expected.at(-1)!.draws).toBeGreaterThan(expected[0].draws);
    for (let replay = 0; replay < 2; replay++) {
      engine.restore(checkpoint);
      expect(suffix()).toEqual(expected);
    }
    stop();
  });

  it("restores queued work, trips, batches, RNG, props, counters and fractional time repeatedly", () => {
    const engine = makeEngine();
    engine.setTraffic(true);
    engine.setSpeed(2);
    engine.inject("source", 100, { spreadMs: 3000 });
    engine.step(231);
    engine.setNodeStatus("worker", "paused");
    engine.setNodeProps("worker", { concurrency: 2, emits: { "*": "Stored" } });
    const atCheckpoint = engine.snapshot();
    const metrics = engine.metrics();
    const checkpoint = engine.checkpoint();
    expect(checkpoint.time).toBe(atCheckpoint.time);

    const continueRun = () => {
      engine.setNodeStatus("worker", "up");
      engine.step(13);
      engine.step(2800);
      return engine.snapshot();
    };
    const expected = continueRun();
    expect(expected.nodes.worker.failed).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) {
      engine.setNodeProps("worker", { emits: "Wrong" });
      engine.restore(checkpoint);
      expect(engine.snapshot()).toEqual(atCheckpoint);
      expect(engine.metrics()).toEqual(metrics);
      expect(engine.effectiveProps("worker").emits).toEqual({ "*": "Stored" });
      expect(continueRun()).toEqual(expected);
    }
  });

  it("rejects foreign checkpoints and checkpoints invalidated by loading another diagram", () => {
    const engine = makeEngine();
    const checkpoint = engine.checkpoint();
    expect(() => makeEngine().restore(checkpoint)).toThrow("another engine");
    engine.load(diagram);
    expect(() => engine.restore(checkpoint)).toThrow("previous diagram");
  });
});
