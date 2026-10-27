import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { resourceLesson } from "../model/autoscalingLessons";
import { createEngine, observeEngineEvents, randomDraws } from "./engine";
import { assertLedgerInvariants, assertResourceInvariants } from "./resourceInvariants";
import type { SimEvent } from "./types";

it.each([false, true])("preserves admission order, shedding and transit with resource clock %s", (resources) => {
  const diagram: DiagramFile = {
    format: "diagrams/v2",
    title: "Transport and admission boundary",
    planning: {
      revision: "p3-w2",
      requestRoutes: [
        { id: "second", address: { method: "GET", path: "/second" } },
        { id: "first", address: { method: "GET", path: "/first" } },
      ],
    },
    nodes: [
      {
        id: "z-source",
        stencil: "client.user",
        label: "Z",
        x: 0,
        y: 0,
        props: {
          ratePerSec: 200,
          jitter: 0,
          trafficMix: {
            mode: "shares",
            entries: [
              { routeId: "second", share: 0.5 },
              { routeId: "first", share: 0.5 },
            ],
          },
        },
      },
      { id: "a-source", stencil: "client.user", label: "A", x: 0, y: 100, props: { ratePerSec: 100, jitter: 0 } },
      {
        id: "worker",
        stencil: "generic.service",
        label: "Worker",
        x: 200,
        y: 0,
        props: {
          status: "paused",
          concurrency: 1,
          replicas: 1,
          latencyMs: 20,
          jitter: 0.1,
          queue: { limit: 2, whenFull: "drop-oldest", order: "lifo" },
          ...(resources && {
            resources: { ...resourceLesson(), cpuMsPerMessage: 10, startup: { delayMs: 0, jitterFraction: 0 } },
            autoscaling: { mode: "off" as const },
          }),
        },
      },
      {
        id: "api",
        stencil: "generic.external-api",
        label: "API",
        x: 200,
        y: 100,
        props: { latencyMs: 0, jitter: 0, api: { maxInFlight: 1 } },
      },
    ],
    edges: [
      { id: "push", from: "z-source", to: "worker", kind: "async", props: { travelMs: 20 } },
      { id: "call", from: "a-source", to: "api", kind: "sync", props: { travelMs: 30, networkDelayMs: 10 } },
    ],
  };
  const ownership: unknown[] = [];
  const events: SimEvent[] = [];
  const engine = createEngine({
    seed: 7,
    maxParticles: 3,
    verifyLedger: assertLedgerInvariants,
    verifyResources(state) {
      assertResourceInvariants(state);
      ownership.push(
        [...state.nodes].map((node) => [
          node.id,
          [...node.working].map((work) => [work.message && "id" in work.message ? work.message.id : undefined]),
          [...node.pending].map((work) => (work.message && "id" in work.message ? work.message.id : undefined)),
          [...(node.arriving ?? [])].map((message) => ("id" in message ? message.id : undefined)),
        ]),
      );
    },
  });
  engine.load(diagram);
  observeEngineEvents(engine, (event) => events.push(event));
  engine.inject("z-source", 3, { spreadMs: 20 });
  engine.inject("a-source", 3, { spreadMs: 20 });
  engine.setTraffic(true);
  engine.step(30);
  engine.setTraffic(false);
  const checkpoint = engine.checkpoint();
  const prefix = events.map((event) => `${event.time}:${event.kind}:${event.nodeId}:${event.messageId}`);
  const suffix = () => {
    ownership.length = 0;
    events.length = 0;
    const frames = [];
    for (let i = 0; i < 10; i++) {
      if (i === 0) engine.setNodeStatus("worker", "up");
      if (i === 1) engine.setScale(2);
      if (i === 3) engine.setNodeProps("worker", { replicas: 2 });
      if (i === 5) engine.setNodeStatus("worker", "down");
      if (i === 6) engine.setNodeStatus("worker", "up");
      engine.step(10);
      frames.push(engine.frame());
    }
    return structuredClone({
      ownership,
      events,
      frames,
      snapshot: engine.snapshot(),
      metrics: engine.metrics(),
      configuration: engine.configuration(),
      draws: randomDraws(engine),
    });
  };
  const expected = suffix();
  expect({
    prefix,
    suffix: expected.events.map((event) => `${event.time}:${event.kind}:${event.nodeId}:${event.messageId}`),
    draws: expected.draws,
    shed: expected.snapshot.nodes.worker.shed,
    routes: expected.snapshot.routes,
  }).toMatchSnapshot();
  for (let replay = 0; replay < 2; replay++) {
    engine.restore(checkpoint);
    expect(suffix()).toEqual(expected);
  }
});
