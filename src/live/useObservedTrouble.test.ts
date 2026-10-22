import { expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import payment from "../examples/slow-payment-provider.json";
import type { TroubleAction } from "./observedTrouble";
import type { ThreadFixRequest } from "./threadFixPlan";
import { LiveController } from "./controller";
import { TroubleTracker } from "./troubleTracker";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Orders",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "q", stencil: "aws.sqs", label: "orders", x: 0, y: 0 },
    { id: "worker", stencil: "service.go", label: "Worker", x: 0, y: 0 },
  ],
  edges: [
    { id: "a", from: "web", to: "q" },
    { id: "b", from: "q", to: "worker" },
  ],
};

it("an observed outage hidden behind Inputs keeps its turn; a shown outage ends", () => {
  const controller = new LiveController(diagram);
  const tracker = new TroubleTracker(controller);
  const off = tracker.subscribe(() => undefined);
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()?.key).toBe("down:worker");
  controller.setNodeStatus("worker", "up");
  expect(tracker.current()).toBeUndefined();
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()?.key).toBe("down:worker");
  tracker.shown("down:worker");
  controller.setNodeStatus("worker", "up");
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()).toBeUndefined();
  off();
});

it("reading an external-store snapshot does not observe or mutate display history", () => {
  const controller = new LiveController(diagram);
  const tracker = new TroubleTracker(controller);
  const read = vi.spyOn(controller, "getState");
  for (let i = 0; i < 10; i++) expect(tracker.current()).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it("an ongoing lag warning returns after forward seeking warms its history", () => {
  const sim: Simulation = {
    id: "lag",
    title: "Lag",
    traffic: [
      {
        id: "traffic",
        node: "web",
        messageType: "Order",
        shape: { kind: "constant", ratePerSec: 100, durationMs: 60_000 },
      },
    ],
    timeline: [],
  };
  const controller = new LiveController(diagram);
  controller.selectSimulation(sim);
  const tracker = new TroubleTracker(controller);
  const off = tracker.subscribe(() => undefined);
  for (let i = 0; i < 12; i++) controller.step(1000);
  expect(tracker.current()?.key).toBe("lag:q");
  tracker.shown("lag:q");
  const generation = controller.getState().generation;
  controller.seek(20_000);
  expect(controller.getState().generation).toBe(generation);
  expect(tracker.current()).toBeUndefined();
  for (let i = 0; i < 10; i++) controller.step(1000);
  expect(tracker.current()?.key).toBe("lag:q");
  off();
});

it.each([
  { duration: 500, at: 250 },
  { duration: 1_800, at: 1_500 },
])("a completed $duration ms run reports a loss in its final partial second", ({ duration, at }) => {
  const d = structuredClone(diagram);
  d.nodes.find((n) => n.id === "worker")!.props = { failureRate: 1, latencyMs: 0 };
  const c = new LiveController(d);
  c.selectSimulation({
    id: "short",
    title: "Short",
    seed: 1,
    scale: 1,
    durationMs: duration,
    traffic: [],
    timeline: [{ atMs: at, action: { do: "inject", node: "worker", count: 1 } }],
  });
  const tracker = new TroubleTracker(c);
  const off = tracker.subscribe(() => undefined);
  for (let t = 0; t < duration; t += 50) c.step(50);
  expect(c.getState().run?.done).toBe(true);
  expect(c.snapshot().nodes.worker.dropped).toBe(1);
  expect(tracker.current()).toMatchObject({ kind: "dropping", node: "worker" });
  off();
});

it.each([0, 0.3])("keeps unrelated losses visible when another request times out (failure rate %s)", (failureRate) => {
  const d = structuredClone(payment) as DiagramFile;
  d.nodes.find((n) => n.id === "checkout")!.props!.failureRate = failureRate;
  const c = new LiveController(d);
  c.selectSimulation(d.simulations![1]);
  const tracker = new TroubleTracker(c);
  const stop = tracker.subscribe(() => {});
  try {
    for (let i = 0; i < 200; i++) c.step(100);
    const st = c.getState();
    expect(st.snapshot.edges.pay.calls!.timedOut).toBeGreaterThan(0);
    if (failureRate) {
      expect(st.snapshot.nodes.checkout.dropped).toBeGreaterThan(c.expectedTimeoutLosses().checkout);
      expect(tracker.current()).toMatchObject({ kind: "dropping", node: "gateway" });
      tracker.dismiss(tracker.current()!.key);
      expect(tracker.current()).toMatchObject({ kind: "dropping", node: "checkout" });
      expect(tracker.current()!.headline).toContain("losing");
    } else expect(tracker.current()).toBeUndefined();
  } finally {
    stop();
    c.dispose();
  }
});

it("invalidates completed and pending fixes on live configuration changes without a new run", async () => {
  const d = payment as DiagramFile;
  const c = new LiveController(d);
  c.selectSimulation(d.simulations![0]);
  const pending: { request: ThreadFixRequest; resolve: (fix: TroubleAction | undefined) => void }[] = [];
  const tracker = new TroubleTracker(c, (request) => new Promise((resolve) => pending.push({ request, resolve })));
  const stop = tracker.subscribe(() => {});
  const fix = { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  try {
    for (let i = 0; i < 150; i++) c.step(100);
    expect(pending).toHaveLength(1);
    const generation = c.getState().generation;
    c.setNodeProps("checkout", { concurrency: 65 });
    expect(c.getState().generation).toBe(generation);
    // Single flight: the newer revision waits for the outstanding request, whose answer is then stale.
    expect(pending).toHaveLength(1);
    pending[0].resolve(fix);
    await settle();
    expect(tracker.current()?.action.kind).toBe("events");
    expect(pending).toHaveLength(2);
    pending[1].resolve(fix);
    await settle();
    expect(tracker.current()?.action).toEqual(fix);
    c.setNodeProps("checkout", { concurrency: 64 });
    expect(tracker.current()?.action.kind).toBe("events");
    expect(pending).toHaveLength(3);
    expect(pending[2].request.context.controls.at(-1)?.op).toMatchObject({
      kind: "props",
      patch: { concurrency: 64 },
    });
    pending[2].resolve(undefined);
    await settle();
    c.setInputs({ rates: {}, props: {}, traffic: 0.1 });
    expect(c.getState().generation).toBe(generation);
    expect(pending).toHaveLength(4);
    // The run's origin keeps the traffic it started with; the change is a control at the time it was made.
    expect(pending[3].request.context.origin.simulation.multipliers?.traffic ?? 1).toBe(1);
    expect(pending[3].request.context.controls.at(-1)).toMatchObject({
      time: c.snapshot().time,
      op: { kind: "configuration", multipliers: { traffic: 0.1 } },
    });
    pending[3].resolve(undefined);
    await settle();
  } finally {
    stop();
    c.dispose();
  }
});
