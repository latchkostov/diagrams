import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type SimRole, type Simulation } from "../model/types";
import { LiveController } from "./controller";

const roles: Record<string, SimRole> = { src: "source", q: "queue", svc: "processor", dlq: "queue" };
const roleOf = (stencil: string) => roles[stencil] ?? "sink";

const diagram = (failureRate = 0): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "t",
  nodes: [
    { id: "api", stencil: "src", label: "API", x: 0, y: 0, props: { ratePerSec: 4 } },
    { id: "queue", stencil: "q", label: "Queue", x: 0, y: 0, props: { maxDeliveryCount: 2 } },
    { id: "worker", stencil: "svc", label: "Worker", x: 0, y: 0, props: { failureRate, latencyMs: 50 } },
    { id: "dead", stencil: "dlq", label: "Dead letters", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", from: "api", to: "queue" },
    { id: "e2", from: "queue", to: "worker" },
    { id: "e3", from: "queue", to: "dead", props: { dlq: true } },
  ],
});

const play = (c: LiveController, ms: number) => {
  for (let t = 0; t < ms; t += 16) c.advance(16);
  c.publish();
};

describe("LiveController: message trace", () => {
  it.each([5000, 6000, 0])(
    "an ended trace stays closed after seeking to %i, including a retained checkpoint",
    (target) => {
      const c = new LiveController(diagram(), { roleOf });
      c.selectSimulation({
        id: "s",
        title: "s",
        traffic: [{ id: "t", node: "api", shape: { kind: "constant", ratePerSec: 4, durationMs: 20_000 } }],
      });
      c.traceNext();
      c.setPlaying(true);
      play(c, 11_000);
      expect(c.getState().trace?.current).toBeDefined();
      c.endTrace();
      c.seek(target);
      expect(c.getState().trace).toBeNull();
      expect(c.tracedRoot).toBeUndefined();
      c.seek(11_000);
      expect(c.getState().trace).toBeNull();
    },
  );

  it("a pending request replaces the selection in a restored checkpoint", () => {
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation({ id: "s", title: "s", traffic: [] });
    c.traceNext("api");
    c.inject("api", 1);
    c.setPlaying(true);
    play(c, 11_000);
    c.traceNext("dead");
    c.seek(5000);
    expect(c.getState().trace?.rootId).toBeUndefined();
    expect(c.getState().trace?.pending).toEqual({ next: "message", node: "dead" });
  });
  it("traces the next message, publishes its journey, and ends on request", () => {
    const c = new LiveController(diagram(), { roleOf });
    expect(c.getState().trace).toBeNull();
    c.traceNext("worker");
    expect(c.getState().trace).toEqual({ rootId: undefined, pending: { next: "message", node: "worker" } });
    c.inject("api", 1);
    c.setPlaying(true);
    play(c, 4000);
    const trace = c.getState().trace!;
    expect(trace.rootId).toBe(1);
    expect(trace.current?.done).toBe(true);
    expect(trace.current?.partial).toBe(false); // the history kept its first hop
    expect(c.tracedRoot).toBe(1);
    c.endTrace();
    expect(c.getState().trace).toBeNull();
  });

  it("follows a message on screen by id, the slowest one, and the latest dead letter", () => {
    const c = new LiveController(diagram(1), { roleOf });
    c.setSpeed(4);
    c.setTraffic(true);
    c.setPlaying(true);
    expect(c.traceSlowest()).toBe(false);
    expect(c.traceDeadLettered()).toBe("waiting");
    play(c, 3000);
    expect(c.getState().trace?.current?.steps.some((s) => s.kind === "deadletter")).toBe(true);
    expect(c.traceDeadLettered()).toBe("now");
    expect(c.traceSlowest()).toBe(true);
    const particle = c.snapshot().particles.find((p) => p.kind === "message");
    expect(particle).toBeDefined();
    expect(c.traceMessage(particle!.messageId)).toBe(true);
    expect(c.tracedRoot).toBe(particle!.rootId);
    expect(c.traceMessage(99_999)).toBe(false);
  });

  it("traces the message that dead-lettered most recently, not the most recently created one", () => {
    // Two queues into one failing worker: the older message gets two deliveries, the newer one only one,
    // so the newer one dead-letters first and the older one last.
    const twoQueues: DiagramFile = {
      format: DIAGRAM_FORMAT,
      title: "t",
      nodes: [
        { id: "slow", stencil: "q", label: "Slow", x: 0, y: 0, props: { maxDeliveryCount: 2 } },
        { id: "fast", stencil: "q", label: "Fast", x: 0, y: 0, props: { maxDeliveryCount: 1 } },
        { id: "worker", stencil: "svc", label: "Worker", x: 0, y: 0, props: { failureRate: 1, latencyMs: 50 } },
        { id: "dead", stencil: "dlq", label: "Dead letters", x: 0, y: 0 },
      ],
      edges: [
        { id: "e1", from: "slow", to: "worker" },
        { id: "e2", from: "fast", to: "worker" },
        { id: "e3", from: "slow", to: "dead", props: { dlq: true } },
        { id: "e4", from: "fast", to: "dead", props: { dlq: true } },
      ],
    };
    const c = new LiveController(twoQueues, { roleOf });
    // Follow the newer one first: it has dead-lettered by the time the older one does.
    c.traceNext("fast");
    c.inject("slow", 1);
    c.inject("fast", 1);
    c.setPlaying(true);
    play(c, 12_000);
    const newer = c.getState().trace!.current!;
    expect(newer.origin).toBe("fast");
    expect(newer.steps.some((s) => s.kind === "deadletter")).toBe(true);
    const newerAt = newer.steps.find((s) => s.kind === "deadletter")!.t;
    c.endTrace();

    expect(c.traceDeadLettered()).toBe("now");
    const picked = c.getState().trace!.current!;
    expect(picked.origin).toBe("slow");
    expect(picked.rootId).toBeLessThan(newer.rootId);
    expect(picked.steps.find((s) => s.kind === "deadletter")!.t).toBeGreaterThan(newerAt);
  });

  it("keeps following the same message when scrubbing back, and restart ends the trace", () => {
    const sim: Simulation = {
      id: "s",
      title: "s",
      seed: 2,
      traffic: [{ id: "t", node: "api", shape: { kind: "constant", ratePerSec: 4, durationMs: 20_000 } }],
    };
    const c = new LiveController(diagram(), { roleOf });
    c.selectSimulation(sim);
    c.setPlaying(true);
    play(c, 6000);
    c.traceNext();
    play(c, 3000);
    const root = c.getState().trace!.rootId!;
    const journey = c.getState().trace!.current!;
    c.seek(1000);
    expect(c.getState().trace?.rootId).toBe(root);
    expect(c.getState().trace?.current).toBeUndefined(); // not created yet at 1 s
    c.seek(9000);
    expect(c.getState().trace?.current).toEqual(journey);
    c.sendOne("worker");
    c.restart();
    expect(c.getState().trace).toBeNull();
  });
});
