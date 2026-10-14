import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, Simulation } from "../model/types";
import { messagesPerSec } from "../stencils/netDevices";
import { analyzeCapacity } from "./capacity";
import { resolveProps } from "./defaults";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import type { SimEngine } from "./types";

// Network devices in the simulation (docs/SIMULATION.md, "Network devices"): pass-through gateways with a
// throughput ceiling from a size preset, HA pairs and clusters, firewall deny rules and ADC health checks.

const node = (id: string, stencil: string, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "sync",
  props: { travelMs: 20, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: "diagrams/v1",
  title: "Network",
  nodes,
  edges,
});
function load(d: DiagramFile): SimEngine {
  const sim = createEngine({ seed: 7 });
  sim.load(d);
  return sim;
}
function run(sim: SimEngine, ms: number): void {
  for (let t = 0; t < ms; t += 10) sim.step(10);
}
/** 0.8 Gbps at 1,000 kB a message: a ceiling of exactly 100 messages/s per unit. */
const HUNDRED = { gbps: 0.8, messageKB: 1000 };

describe("presets", () => {
  it("resolves a device's size preset, and its own values over it", () => {
    const campus = resolveProps("gateway", "fw", {}, "paloalto.ngfw");
    expect(campus.device).toMatchObject({ kind: "firewall", size: "campus", gbps: 20, ha: "standalone" });
    expect(campus.device!.preset!.model).toBe("PA-3440");
    expect(campus.latencyMs).toBe(0.5);
    expect(campus.device!.perUnit).toBeCloseTo(messagesPerSec(20, 64));
    const branch = resolveProps("gateway", "fw", { size: "branch", latencyMs: 2 }, "paloalto.ngfw");
    expect(branch.device).toMatchObject({ size: "branch", gbps: 1.2 });
    expect(branch.latencyMs).toBe(2);
    expect(resolveProps("gateway", "fw", { gbps: 3 }, "paloalto.ngfw").device!.gbps).toBe(3);
  });

  it("falls back to the family's size when it doesn't come in the one asked for", () => {
    // Nexus is made for data centres only: no branch size.
    expect(resolveProps("gateway", "leaf", { size: "branch" }, "cisco.nexus").device!.size).toBe("datacentre");
  });

  it("starts an HA pair or cluster at two units", () => {
    expect(resolveProps("gateway", "fw", { ha: "active-standby" }, "generic.ngfw").replicas).toBe(2);
    expect(resolveProps("gateway", "fw", { ha: "active-active", replicas: 4 }, "generic.ngfw").replicas).toBe(4);
    expect(resolveProps("gateway", "fw", {}, "generic.ngfw").replicas).toBe(1);
  });

  it("leaves other gateways as they were: no ceiling, no health checks", () => {
    for (const stencil of ["nginx", "load-balancer", "generic.firewall", "aws.elb"]) {
      const props = resolveProps("gateway", "g", {}, stencil);
      expect(props.device, stencil).toBeUndefined();
      expect(props.healthChecks, stencil).toBe(false);
      expect(props.latencyMs, stencil).toBe(60);
    }
    // ...unless one is given a throughput.
    expect(resolveProps("gateway", "g", { gbps: 1 }, "nginx").device?.perUnit).toBeCloseTo(messagesPerSec(1, 64));
  });

  it("turns health checks on for ADCs by default", () => {
    expect(resolveProps("gateway", "lb", {}, "f5.bigip").healthChecks).toBe(true);
    expect(resolveProps("gateway", "lb", { healthChecks: false }, "f5.bigip").healthChecks).toBe(false);
    expect(resolveProps("gateway", "r", {}, "cisco.isr").healthChecks).toBe(false);
  });
});

describe("pass-through capacity", () => {
  const chain = (rate: number, routerProps: Record<string, unknown> = {}) =>
    diagram(
      [
        node("users", "client.user", { ratePerSec: rate }),
        node("router", "generic.router", { ...HUNDRED, ...routerProps }),
        node("mail", "generic.email"),
      ],
      [edge("users", "router"), edge("router", "mail")],
    );

  it("passes traffic under its ceiling straight through", () => {
    const sim = load(chain(50));
    sim.setTraffic(true);
    run(sim, 10_000);
    const router = sim.snapshot().nodes.router;
    expect(router.backlog).toBeLessThanOrEqual(1);
    expect(router.throughput).toBeGreaterThan(45);
    expect(router.dropped).toBe(0);
  });

  it("holds traffic over its ceiling to the ceiling, and the rest waits", () => {
    const sim = load(chain(200));
    sim.setTraffic(true);
    run(sim, 10_000);
    const router = sim.snapshot().nodes.router;
    expect(router.throughput).toBeGreaterThan(90);
    expect(router.throughput).toBeLessThan(110);
    // About 100/s of the 200/s arriving waits: around a thousand after ten seconds.
    expect(router.backlog).toBeGreaterThan(800);
    expect(router.dropped).toBe(0);
  });

  it("keeps the same real throughput when sampled", () => {
    const d = chain(200);
    const sim: Simulation = {
      id: "s",
      title: "s",
      scale: 10,
      durationMs: 10_000,
      traffic: [{ id: "t", node: "users", shape: { kind: "constant", ratePerSec: 200, durationMs: 10_000 } }],
    };
    const run10 = createSimulationRun(d, sim);
    for (let t = 0; t < 10_000; t += 10) run10.step(10);
    const real = run10.units.realFrame().nodes.router;
    expect(real.throughput).toBeGreaterThan(90);
    expect(real.throughput).toBeLessThan(110);
  });

  it("adds up the units of an active-active cluster, but not a standby's", () => {
    const cluster = load(chain(250, { ha: "active-active", replicas: 2 }));
    cluster.setTraffic(true);
    run(cluster, 10_000);
    expect(cluster.snapshot().nodes.router.throughput).toBeGreaterThan(185);
    const pair = load(chain(250, { ha: "active-standby", replicas: 2 }));
    pair.setTraffic(true);
    run(pair, 10_000);
    expect(pair.snapshot().nodes.router.throughput).toBeLessThan(110);
  });

  it("matches the capacity analysis", () => {
    const analysis = analyzeCapacity(chain(250, { ha: "active-active", replicas: 3 }));
    expect(analysis.nodes.router.capacity).toBeCloseTo(300);
    expect(analysis.nodes.router.device).toBe(true);
    expect(analysis.nodes.router.utilization).toBeCloseTo(250 / 300);
    expect(analyzeCapacity(chain(250, { ha: "active-standby", replicas: 2 })).nodes.router.capacity).toBeCloseTo(100);
    // A device's capacity is its ceiling, not the single-lane latency estimate other gateways get.
    expect(analyzeCapacity(chain(250, { latencyMs: 500 })).nodes.router.capacity).toBeCloseTo(100);
    expect(analysis.suggestion).toBe("router: 83% utilized");
    expect(analyzeCapacity(chain(500)).suggestion).toContain("pick a bigger size");
  });
});

describe("HA failover", () => {
  const pair = (failoverMs?: number) =>
    diagram(
      [
        node("users", "client.user", { ratePerSec: 50 }),
        node("fw", "generic.ngfw", {
          ...HUNDRED,
          ha: "active-standby",
          replicas: 2,
          ...(failoverMs === undefined ? {} : { failoverMs }),
        }),
        node("mail", "generic.email"),
      ],
      [edge("users", "fw"), edge("fw", "mail")],
    );

  it("stalls while the standby takes over, then drains, losing nothing", () => {
    const sim = load(pair(2000));
    sim.setTraffic(true);
    run(sim, 2000);
    sim.setNodeProps("fw", { replicas: 1 });
    expect(sim.snapshot().events.at(-1)?.text).toBe("fw status (failing over to the standby (1 of 2 units left))");
    run(sim, 1000);
    const during = sim.snapshot().nodes.fw;
    expect(during.failingOver).toBe(true);
    expect(during.backlog).toBeGreaterThan(30);
    run(sim, 3000);
    const after = sim.snapshot().nodes.fw;
    expect(after.failingOver).toBeUndefined();
    expect(after.backlog).toBeLessThanOrEqual(1);
    expect(after.dropped).toBe(0);
    expect(after.replicas).toBe(1);
  });

  it("defaults to a few seconds, and an active-active cluster losing a unit doesn't stall", () => {
    const sim = load(pair());
    sim.setTraffic(true);
    run(sim, 1000);
    sim.setNodeProps("fw", { replicas: 1 });
    run(sim, 2900);
    expect(sim.snapshot().nodes.fw.failingOver).toBe(true);
    run(sim, 200);
    expect(sim.snapshot().nodes.fw.failingOver).toBeUndefined();

    const cluster = load(
      diagram(
        [
          node("users", "client.user", { ratePerSec: 50 }),
          node("fw", "generic.ngfw", { ...HUNDRED, ha: "active-active", replicas: 2 }),
          node("mail", "generic.email"),
        ],
        [edge("users", "fw"), edge("fw", "mail")],
      ),
    );
    cluster.setTraffic(true);
    run(cluster, 1000);
    cluster.setNodeProps("fw", { replicas: 1 });
    run(cluster, 100);
    expect(cluster.snapshot().nodes.fw.failingOver).toBeUndefined();
  });

  it("restores the hold from a checkpoint", () => {
    const sim = load(pair(2000));
    sim.setTraffic(true);
    run(sim, 500);
    sim.setNodeProps("fw", { replicas: 1 });
    const cp = sim.checkpoint();
    run(sim, 3000);
    expect(sim.snapshot().nodes.fw.failingOver).toBeUndefined();
    sim.restore(cp);
    expect(sim.snapshot().nodes.fw.failingOver).toBe(true);
  });

  it("drops everything when the whole pair is down", () => {
    const sim = load(pair());
    sim.setNodeStatus("fw", "down");
    sim.inject("users", 5);
    run(sim, 1000);
    expect(sim.snapshot().nodes.fw.dropped).toBe(5);
  });
});

describe("firewall deny rules", () => {
  const rules = (deny: boolean) =>
    diagram(
      [
        node("branch", "client.team"),
        node("fw", "paloalto.ngfw"),
        node("web", "generic.email"),
        node("payments", "generic.email"),
      ],
      [
        edge("branch", "fw"),
        edge("fw", "web", { filter: ["Web"] }),
        edge("fw", "payments", { filter: ["Admin"], ...(deny ? { deny: true } : {}) }),
      ],
    );

  it("blocks what's routed onto a denied connection: counted as blocked, never dropped or failed", () => {
    const sim = load(rules(true));
    sim.inject("branch", 6, { type: "Web" });
    sim.inject("branch", 4, { type: "Admin" });
    run(sim, 2000);
    const { nodes, edges } = sim.snapshot();
    expect(nodes.fw.blocked).toBe(4);
    expect(nodes.fw.dropped).toBe(0);
    expect(nodes.fw.failed).toBe(0);
    expect(nodes.payments.processed).toBe(0);
    expect(edges["fw-payments"].delivered).toBe(0);
    expect(nodes.web.processed).toBe(6);
    expect(sim.measure({ node: "fw", field: "blocked" })).toBe(4);
    expect(sim.metrics().inSystem).toBe(0);
    expect(sim.snapshot().events.filter((e) => e.kind === "block")).toHaveLength(4);
  });

  it("lets everything through without the rule", () => {
    const sim = load(rules(false));
    sim.inject("branch", 4, { type: "Admin" });
    run(sim, 2000);
    expect(sim.snapshot().nodes.payments.processed).toBe(4);
    expect(sim.snapshot().nodes.fw.blocked).toBeUndefined();
  });

  it("traces a blocked message to its end at the firewall", () => {
    const sim = load(rules(true));
    sim.tracer.request({ next: "message", node: "branch" });
    sim.inject("branch", 1, { type: "Admin" });
    run(sim, 2000);
    const trace = sim.tracer.current()!;
    expect(trace.done).toBe(true);
    expect(trace.steps.at(-1)).toMatchObject({ kind: "drop", node: "fw", reason: "blocked by a deny rule" });
  });

  it("blocks a fan-out copy on a denied connection from a service", () => {
    const sim = load(
      diagram(
        [node("svc", "generic.service"), node("a", "generic.email"), node("b", "generic.email")],
        [edge("svc", "a"), edge("svc", "b", { deny: true })],
      ),
    );
    sim.inject("svc", 3);
    run(sim, 2000);
    expect(sim.snapshot().nodes.a.processed).toBe(3);
    expect(sim.snapshot().nodes.svc.blocked).toBe(3);
    expect(sim.metrics().inSystem).toBe(0);
  });

  it("sends no demand down a denied connection in the capacity analysis", () => {
    const d = rules(true);
    const sim: Simulation = {
      id: "s",
      title: "s",
      traffic: [
        { id: "w", node: "branch", messageType: "Web", shape: { kind: "constant", ratePerSec: 30, durationMs: 1000 } },
        {
          id: "a",
          node: "branch",
          messageType: "Admin",
          shape: { kind: "constant", ratePerSec: 10, durationMs: 1000 },
        },
      ],
    };
    const analysis = analyzeCapacity(d, sim);
    expect(analysis.nodes.fw.offered).toBeCloseTo(40);
    expect(analysis.nodes.web.offered).toBeCloseTo(30);
    expect(analysis.nodes.payments.offered).toBe(0);
  });
});

describe("ADC spread and health checks", () => {
  const pool = (stencil: string, props: Record<string, unknown> = {}) =>
    diagram(
      [
        node("users", "client.user"),
        node("lb", stencil, props),
        node("a", "generic.service", { latencyMs: 10, concurrency: 50 }),
        node("b", "generic.service", { latencyMs: 10, concurrency: 50 }),
      ],
      [edge("users", "lb"), edge("lb", "a"), edge("lb", "b")],
    );

  it("spreads requests evenly across its targets", () => {
    const sim = load(pool("f5.bigip"));
    sim.inject("users", 100);
    run(sim, 3000);
    expect(sim.snapshot().nodes.a.processed).toBe(50);
    expect(sim.snapshot().nodes.b.processed).toBe(50);
  });

  it("sends nothing to a target that's down while another is up", () => {
    const sim = load(pool("f5.bigip"));
    sim.setNodeStatus("b", "down");
    sim.inject("users", 40);
    run(sim, 3000);
    const { nodes } = sim.snapshot();
    expect(nodes.a.processed).toBe(40);
    expect(nodes.b.dropped).toBe(0);
    expect(nodes.lb.dropped).toBe(0);
  });

  it("keeps the old round-robin, down targets included, without health checks", () => {
    for (const [stencil, props] of [
      ["f5.bigip", { healthChecks: false }],
      ["load-balancer", {}],
    ] as const) {
      const sim = load(pool(stencil, props));
      sim.setNodeStatus("b", "down");
      sim.inject("users", 40);
      run(sim, 3000);
      expect(sim.snapshot().nodes.a.processed, stencil).toBe(20);
      expect(sim.snapshot().nodes.b.dropped, stencil).toBe(20);
    }
  });

  it("routes around a down target in the capacity analysis too", () => {
    const sim: Simulation = {
      id: "s",
      title: "s",
      setup: { status: { b: "down" } },
      traffic: [{ id: "t", node: "users", shape: { kind: "constant", ratePerSec: 40, durationMs: 1000 } }],
    };
    const analysis = analyzeCapacity(pool("f5.bigip"), sim);
    expect(analysis.nodes.a.offered).toBeCloseTo(40);
    expect(analysis.nodes.b.offered).toBe(0);
    expect(analyzeCapacity(pool("load-balancer"), sim).nodes.b.offered).toBeCloseTo(20);
  });
});
