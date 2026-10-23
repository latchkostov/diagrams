import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import zone from "../examples/zone-outage-drill.json";
import serverless from "../examples/aws-serverless-orders.json";
import { LiveController } from "./controller";
import { runEndResult } from "./runEndResult";
import busy from "../examples/scale-on-busy-threads.json";
import payment from "../examples/slow-payment-provider.json";
import storm from "../examples/retry-storm.json";

it.each([
  { status: "up", requests: 0, succeeded: 0 },
  { status: "down", requests: 100, succeeded: 100 },
  { status: "up", requests: 100, succeeded: 0 },
])("never certifies recovery from absent or unhealthy traffic: %j", ({ status, requests, succeeded }) => {
  const state = {
    run: { done: true, expectations: [] },
    configuration: {},
    snapshot: {
      nodes: { payments: { status, backlog: 0, dropped: 0 } },
      edges: {
        pay: {
          breaker: { state: "closed" },
          calls: { shortCircuited: 100, windowRequests: requests, windowSucceeded: succeeded },
        },
      },
    },
  } as unknown as import("./controller").LiveState;
  expect(runEndResult(state, storm as DiagramFile)).not.toContain("recovered");
});

it.each(["three-quick-retries", "circuit-breaker"])("the retry storm ends with its measured lesson: %s", (id) => {
  const diagram = storm as DiagramFile;
  const c = new LiveController(diagram);
  try {
    c.selectSimulation(diagram.simulations!.find((s) => s.id === id)!);
    c.seek(60000);
    expect(runEndResult(c.getState(), diagram)).toContain(id === "circuit-breaker" ? "recovered" : "stayed overloaded");
  } finally {
    c.dispose();
  }
});

it("uses the caller stencil's default wait in a pool run result", () => {
  const diagram = structuredClone(payment) as DiagramFile;
  diagram.nodes.find((n) => n.id === "checkout")!.stencil = "azure.logic-apps";
  const simulation = diagram.simulations!.find((s) => s.id === "pool-40")!;
  delete simulation.setup!.edges!.pay.caller!.wait;
  const c = new LiveController(diagram);
  try {
    c.selectSimulation(simulation);
    c.seek(30000);
    expect(runEndResult(c.getState(), diagram)).toContain("threads freed while waiting for the pool");
  } finally {
    c.dispose();
  }
});

it.each(["fixed fleet", "source input"])("keeps a %s out of the scaling summary", (kind) => {
  const diagram = busy as DiagramFile;
  const c = new LiveController(diagram);
  try {
    c.selectSimulation(diagram.simulations![0]);
    c.seek(50000);
    const state = c.getState();
    expect(runEndResult(state, diagram)).toContain("scaled on CPU");
    const fixed = {
      ...state,
      configuration: {
        ...state.configuration,
        caller: { ...state.configuration.caller, autoscaling: { mode: "off" } },
      },
    };
    const source = {
      ...diagram,
      nodes: diagram.nodes.map((n) => (n.id === "applications" ? { ...n, stencil: "client.user" } : n)),
    };
    expect(runEndResult(kind === "fixed fleet" ? fixed : state, kind === "source input" ? source : diagram)).toBe(
      "No messages lost; other expectations failed",
    );
  } finally {
    c.dispose();
  }
});

it("names the largest real loss and does not celebrate a failed zero-loss goal", () => {
  const diagram = zone as DiagramFile;
  const controller = new LiveController(diagram);
  try {
    for (const simulation of diagram.simulations!) {
      controller.selectSimulation(simulation);
      expect(runEndResult(controller.getState(), diagram)).toBeUndefined();
      controller.seek(9000);
      expect(runEndResult(controller.getState(), diagram)).toBe(
        simulation.id === "health-checks" ? "No messages lost" : "Lost 26 messages at Checkout API b",
      );
    }
    const state = controller.getState();
    const nodes = structuredClone(state.snapshot.nodes);
    nodes["api-a"].dropped = 40;
    expect(runEndResult({ ...state, snapshot: { ...state.snapshot, nodes } }, diagram)).toBe(
      "Lost 40 messages at Checkout API a",
    );
    for (const node of Object.values(nodes)) {
      node.dropped = 0;
      node.deadLettered = 0;
    }
    expect(runEndResult({ ...state, snapshot: { ...state.snapshot, nodes } }, diagram)).toBe(
      "No messages lost; other expectations failed",
    );
    const unnamed = { ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, label: "" })) };
    expect(runEndResult(state, unnamed)).toBe("Lost 26 messages at the system");
  } finally {
    controller.dispose();
  }
});

it("does not report recovered dead letters as lost in the 3PL outage and DLQ redrive run", () => {
  const diagram = serverless as DiagramFile;
  const controller = new LiveController(diagram);
  try {
    controller.selectSimulation(diagram.simulations!.find((s) => s.id === "three-pl-outage")!);
    controller.seek(60000);
    const state = controller.getState();
    expect(state.run?.done).toBe(true);
    expect(state.run?.expectations.every((e) => e.status === "pass")).toBe(true);
    const nodes = Object.values(state.snapshot.nodes);
    expect(nodes.reduce((n, node) => n + node.deadLettered, 0)).toBeGreaterThan(0);
    expect(nodes.reduce((n, node) => n + node.dropped, 0)).toBe(0);
    expect(state.snapshot.nodes.dlq.backlog).toBe(0);
    expect(runEndResult(state, diagram)).toBe("No messages lost");
  } finally {
    controller.dispose();
  }
});

it("the budget comparison leads with measured recovery and counts requests once", () => {
  const diagram = storm as DiagramFile;
  const c = new LiveController(diagram);
  try {
    c.selectSimulation(diagram.simulations!.find((s) => s.id === "retry-budget")!);
    c.seek(60000);
    const state = c.getState();
    expect(state.snapshot.nodes.payments.backlog).toBe(3);
    expect(state.snapshot.nodes.checkout.throughput).toBeCloseTo(300);
    expect(state.snapshot.nodes.shop.dropped).toBe(9738);
    expect(runEndResult(state, diagram)?.replace(/[\u2068\u2069]/g, "")).toBe(
      "Payments recovered: successful checkouts returned to 300/s and the queue drained. 9,738 requests failed during the incident.",
    );
  } finally {
    c.dispose();
  }
});
