import { expect, it } from "vitest";
import type { BreakerView } from "../sim/breaker";
import type { EdgeSimState, NodeSimState } from "../sim/types";
import { HealthWindow, currentHealth, HEALTH_WINDOW_MS } from "./healthWindow";
import { nodeSummary, requestSummary, requestHealthy } from "./hoverSummary";
import { verdictSection } from "./verdictSection";
import { LiveController } from "./controller";
import { healthFixture } from "../lab/resilienceFixture";

const node = (patch: Partial<NodeSimState> = {}): NodeSimState => ({
  id: "api",
  role: "processor",
  status: "up",
  backlog: 5,
  lag: {},
  inFlight: 5,
  processed: 0,
  failed: 0,
  dropped: 0,
  deadLettered: 0,
  throughput: 300,
  threads: { slots: 400, working: 5, waiting: 0, queued: 5, waitingOn: [] },
  ...patch,
});
const calls = (patch: Partial<NonNullable<EdgeSimState["calls"]>> = {}) => ({
  inFlight: 5,
  held: 0,
  timedOut: 0,
  failed: 0,
  succeeded: 0,
  late: 0,
  ...patch,
});
const breaker: BreakerView = {
  state: "closed" as const,
  remainingMs: 0,
  probesSent: 0,
  probesSettled: 0,
  probesInFlight: 0,
  probes: 5,
  failurePercent: 0,
  calls: 0,
};
function frame(time: number, n = node(), c = calls()) {
  return { time, nodes: { api: n }, edges: { call: { id: "call", delivered: 0, active: 0, calls: c, breaker } } };
}

it("current failures need attention; recovered calls become healthy with historical counts intact", () => {
  const health = new HealthWindow();
  health.observe(frame(0), 0);
  const incident = frame(1000, node({ failed: 2, dropped: 1 }), calls({ timedOut: 2, failed: 2 }));
  health.observe(incident, 0);
  expect(nodeSummary(incident.nodes.api, [incident.edges.call.calls]).problems[0].key).toBe("timeout");
  expect(requestSummary(incident.edges.call.calls, breaker, false, 0).problems[0].key).toBe("timeout");
  for (let time = 2000; time <= HEALTH_WINDOW_MS + 2000; time += 1000) {
    const recovered = frame(
      time,
      node({ failed: 2, dropped: 1 }),
      calls({ timedOut: 2, failed: 2, succeeded: time / 10 }),
    );
    health.observe(recovered, 0);
    if (time > HEALTH_WINDOW_MS + 1000) {
      expect(nodeSummary(recovered.nodes.api, [recovered.edges.call.calls]).problems).toEqual([]);
      expect(requestSummary(recovered.edges.call.calls, breaker, false, 0).problems).toEqual([]);
      expect(requestHealthy(recovered.edges.call.calls, breaker, false)).toBe("Closed · calls succeeding");
      expect(recovered.edges.call.calls.timedOut).toBe(2);
    }
  }
});

it("a small stable queue at 300/s and five of 400 threads busy is neutral", () => {
  const health = new HealthWindow();
  for (let time = 0; time <= 20000; time += 1000) {
    const current = frame(time, node({ backlog: 4 + ((time / 1000) % 3) }));
    health.observe(current, 0);
    expect(nodeSummary(current.nodes.api, []).problems).toEqual([]);
  }
});

it.each(["processor", "queue"] as const)(
  "sustained growing %s queues need attention, and stop when they level off",
  (role) => {
    const health = new HealthWindow();
    for (let time = 0; time <= HEALTH_WINDOW_MS; time += 1000) {
      const current = frame(time, node({ role, backlog: time / 100 }));
      health.observe(current, 0);
      if (time === HEALTH_WINDOW_MS)
        expect(nodeSummary(current.nodes.api, []).problems[0].key).toBe(role === "queue" ? "lag" : "waiting");
    }
    for (const time of [11000, 12000, 13000]) health.observe(frame(time, node({ role, backlog: 100 })), 0);
    const level = frame(14000, node({ role, backlog: 100 }));
    health.observe(level, 0);
    expect(nodeSummary(level.nodes.api, []).problems).toEqual([]);
  },
);

it.each(["open", "half-open"] as const)(
  "a current %s breaker needs attention even without failures in the window",
  (state) => {
    const health = new HealthWindow();
    const current = frame(0);
    current.edges.call.breaker = { ...breaker, state };
    health.observe(current, 0);
    expect(nodeSummary(current.nodes.api, [current.edges.call.calls]).problems[0].key).toBe("breaker");
    expect(requestSummary(current.edges.call.calls, current.edges.call.breaker, false, 0).problems[0].key).toBe(
      "breaker",
    );
    expect(verdictSection("breaker")).toBe("threads");
    expect(verdictSection("failed", "edge")).toBe("outcomes");
  },
);

it("pausing does not age incidents, and a rebuild, rewind or long gap does not invent recent failures", () => {
  const health = new HealthWindow();
  health.observe(frame(0), 0);
  const failed = frame(1000, node({ failed: 1 }));
  for (let read = 0; read < 24; read++) health.observe(failed, 0);
  expect(currentHealth(failed.nodes.api).failed).toBe(1);
  for (const [time, generation] of [
    [0, 0],
    [1000, 1],
    [30000, 1],
  ]) {
    const unknown = frame(time, node({ failed: 100 }));
    health.observe(unknown, generation);
    expect(currentHealth(unknown.nodes.api).failed).toBe(0);
  }
});

it("the controller observes a recovered breaker through playback and seeking", () => {
  const diagram = healthFixture();
  const c = new LiveController(diagram);
  try {
    expect(c.selectSimulation(diagram.simulations![0]), c.getState().resourceError).toBe("selected");
    c.setPlaying(true);
    let sawTimeout = false;
    let sawOpen = false;
    for (let time = 0; time < 16000; time += 100) {
      c.advance(100);
      c.publish();
      const s = c.getState().snapshot;
      sawTimeout ||= currentHealth(s.edges.call.calls).timedOut > 0;
      sawOpen ||= s.edges.call.breaker?.state === "open";
    }
    expect(sawTimeout).toBe(true);
    expect(sawOpen).toBe(true);
    const snapshot = c.getState().snapshot;
    expect(snapshot.edges.call.calls!.timedOut).toBeGreaterThan(0);
    expect(snapshot.edges.call.breaker!.state).toBe("closed");
    expect(requestSummary(snapshot.edges.call.calls, snapshot.edges.call.breaker, false, 0).problems).toEqual([]);
    c.seek(6500);
    expect(currentHealth(c.getState().snapshot.edges.call.calls).timedOut).toBeGreaterThan(0);
    c.seek(1500);
    expect(
      requestSummary(c.getState().snapshot.edges.call.calls, c.getState().snapshot.edges.call.breaker, false, 0)
        .problems.length,
    ).toBeGreaterThan(0);
    c.seek(16000);
    expect(
      requestSummary(c.getState().snapshot.edges.call.calls, c.getState().snapshot.edges.call.breaker, false, 0)
        .problems,
    ).toEqual([]);
  } finally {
    c.dispose();
  }
});
