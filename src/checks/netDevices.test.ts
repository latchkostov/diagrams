import { describe, expect, it, vi } from "vitest";
import * as planning from "../sim/capacityPlanning";
import { applyOps } from "../ai";
import { validateDiagram } from "../interop/native";
import { checkJsonSchema } from "../model/jsonSchema";
import { edgeSimPropsSchema, propsProblem, simPropsPatchSchema } from "../model/simProps";
import type { DiagramEdge, DiagramFile, DiagramNode } from "../model/types";
import { collectEvidence } from "./evidence";
import { runChecks } from "./run";
import { capacityView, emptyInputs, freePlaySaveProps, freePlaySimulation } from "../live/capacityModel";
import { isDenyRule } from "../stencils/netDevices";

// Checks on network devices (docs/research/network-infrastructure.md, "Checks"): a device is a box you run, so the
// single-point check offers an HA pair; can't-keep-up reads its datasheet ceiling and offers a bigger size; and a
// firewall's deny rule blocks on purpose, so no check (Run simulations included) calls it lost.

// Spy on the replica sizing the single-point check asks for, passing calls through.
vi.mock("../sim/capacityPlanning", async (original) => {
  const actual = await original<typeof import("../sim/capacityPlanning")>();
  return { ...actual, redundancyFix: vi.fn(actual.redundancyFix) };
});

let x = 0;
const node = (id: string, stencil: string, props?: Record<string, unknown>): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: (x += 300),
  y: 0,
  ...(props ? { props } : {}),
});
const req = (from: string, to: string, props?: Record<string, unknown>): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "sync",
  ...(props ? { props } : {}),
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: "diagrams/v1",
  title: "Network",
  nodes,
  edges,
});
const ids = (d: DiagramFile) => runChecks(d).findings.map((f) => `${f.severity} ${f.id}`);

/** Users through a firewall to a service and its database. */
const path = (fw: Record<string, unknown> | undefined, rate = 20) =>
  diagram(
    [
      node("users", "client.user", { ratePerSec: rate }),
      node("fw", "paloalto.ngfw", fw),
      node("api", "generic.service", { replicas: 2, concurrency: 1000, latencyMs: 1 }),
      node("db", "postgres"),
    ],
    [req("users", "fw"), req("fw", "api"), req("api", "db")],
  );

describe("single-point on a network device", () => {
  it("stays quiet when the diagram says nothing about its units", () => {
    expect(ids(path(undefined))).toEqual([]);
  });

  it("suggests an HA pair for a device the diagram says is standalone", () => {
    for (const props of [{ ha: "standalone" }, { replicas: 1 }]) {
      const d = path(props);
      const finding = runChecks(d).findings.find((f) => f.rule === "single-point")!;
      expect(finding.severity).toBe("suggestion");
      expect(finding.message).toContain("It's a single unit");
      expect(finding.fix).toEqual({
        label: "Make it an HA pair",
        ops: [{ op: "update", target: "fw", props: { ha: "active-standby", replicas: 2 } }],
      });
      const fixed = applyOps(d, finding.fix!.ops!);
      expect(fixed.errors).toEqual([]);
      expect(ids(fixed.diagram)).not.toContain("suggestion single-point:fw");
    }
  });

  it("is quiet for a pair or a cluster", () => {
    expect(ids(path({ ha: "active-standby" }))).toEqual([]);
    expect(ids(path({ ha: "active-active", replicas: 3 }))).toEqual([]);
  });
});

describe("can't keep up, on a network device", () => {
  // A branch PA-440 (1.2 Gbps: about 2,300 messages/s of 64 kB) sent 5,000/s.
  const busy = () => path({ size: "branch" }, 5000);

  it("warns at its datasheet ceiling, and offers the size that carries it", () => {
    const d = busy();
    const findings = runChecks(d).findings;
    const capacity = findings.find((f) => f.rule === "capacity")!;
    expect(capacity.severity).toBe("warning");
    expect(capacity.target).toBe("fw");
    expect(capacity.fix?.label).toBe("Use the campus size (PA-3440)");
    // Busy and the only way through: the single-point check says so too, as a warning.
    expect(findings.find((f) => f.rule === "single-point")?.severity).toBe("warning");
    const fixed = applyOps(d, capacity.fix!.ops!);
    expect(fixed.errors).toEqual([]);
    expect(fixed.diagram.nodes.find((n) => n.id === "fw")?.props).toEqual({ size: "campus" });
    expect(runChecks(fixed.diagram).findings.map((f) => f.rule)).not.toContain("capacity");
  });

  it("never sizes replicas for a device: its fix is a pair whatever the load", () => {
    // Review round 1 (P2): the device branch ran after redundancyFix and threw its whole-graph sizing away.
    const sizing = vi.mocked(planning.redundancyFix);
    sizing.mockClear();
    const finding = runChecks(busy()).findings.find((f) => f.rule === "single-point");
    expect(finding?.severity).toBe("warning");
    expect(sizing).not.toHaveBeenCalled();
  });

  it("offers no fix when no bigger size would do", () => {
    const d = path({ size: "datacentre" }, 1_000_000);
    const capacity = runChecks(d).findings.find((f) => f.rule === "capacity")!;
    expect(capacity.target).toBe("fw");
    expect(capacity.fix).toBeUndefined();
  });
});

describe("a firewall's deny rule", () => {
  const denied = (): DiagramFile => ({
    ...diagram(
      [
        node("branch", "client.team", { ratePerSec: 10, messageType: "Admin" }),
        node("fw", "fortinet.fortigate", { ha: "active-standby" }),
        node("payments", "generic.service"),
      ],
      [req("branch", "fw"), req("fw", "payments", { deny: true })],
    ),
    simulations: [
      {
        id: "blocked",
        title: "The branch is blocked",
        seed: 1,
        traffic: [{ id: "t", node: "branch", shape: { kind: "constant", ratePerSec: 10, durationMs: 3000 } }],
      },
    ],
  });

  it("raises nothing, and Run simulations counts no loss", () => {
    const d = denied();
    expect(ids(d)).toEqual([]);
    const evidence = collectEvidence(d);
    expect(evidence.losses).toEqual([]);
    expect(evidence.dropped).toEqual([]);
  });

  it("is valid in the file, the agents' ops and their schemas", () => {
    const d = denied();
    expect(validateDiagram(d).ok).toBe(true);
    expect(() => checkJsonSchema({ deny: true }, edgeSimPropsSchema)).not.toThrow();
    expect(() => checkJsonSchema({ deny: "yes" }, edgeSimPropsSchema)).toThrow();
    const allowed = applyOps(d, [{ op: "update", target: "fw-payments", props: { deny: null } }]);
    expect(allowed.errors).toEqual([]);
    expect(allowed.diagram.edges[1].props?.deny).toBeUndefined();
  });
});

describe("device settings in the file format", () => {
  it("accepts a device's settings, and rejects malformed ones", () => {
    expect(
      propsProblem({
        size: "branch",
        gbps: 1.2,
        messageKB: 64,
        ha: "active-standby",
        failoverMs: 3000,
        healthChecks: true,
      }),
    ).toBe(false);
    for (const bad of [{ size: "huge" }, { ha: "pair" }, { gbps: -1 }, { messageKB: 0 }, { healthChecks: "on" }])
      expect(propsProblem(bad), JSON.stringify(bad)).toBe(true);
  });

  it("lets agents set and clear them", () => {
    expect(() =>
      checkJsonSchema({ size: "datacentre", gbps: null, ha: "active-active" }, simPropsPatchSchema),
    ).not.toThrow();
    expect(() => checkJsonSchema({ size: "rack" }, simPropsPatchSchema)).toThrow();
  });
});

describe("review round 2", () => {
  it("one planner sizes a device for checks and live view alike", () => {
    // Live view's capacity fix and the capacity check's come from src/sim/capacityPlanning.ts.
    const d = path({ size: "branch" }, 5000);
    const view = capacityView(d, freePlaySimulation(d, emptyInputs()));
    expect(view.fix?.changes).toEqual([
      { nodeId: "fw", key: "size", from: "branch", to: "campus", model: "PA-3440", label: "fw" },
    ]);
    // A throughput typed over the old size moves to the new size's figure, or the preset wouldn't show.
    const typed = path({ size: "branch", gbps: 1.2 }, 5000);
    const fix = runChecks(typed).findings.find((f) => f.rule === "capacity")!.fix!;
    expect(fix.label).toBe("Use the campus size (PA-3440)");
    expect(applyOps(typed, fix.ops!).diagram.nodes.find((n) => n.id === "fw")?.props).toEqual({
      size: "campus",
      gbps: 20,
    });
  });

  it("saves a device's units with Capacity ×, its HA default included", () => {
    const d = diagram(
      [
        node("users", "client.user"),
        node("cluster", "generic.router", { ha: "active-active" }),
        node("api", "generic.service"),
      ],
      [req("users", "cluster"), req("cluster", "api")],
    );
    const saved = freePlaySaveProps(d, { ...emptyInputs(), capacity: 2 });
    expect(saved.cluster).toEqual({ replicas: 4 });
    expect(saved.api).toEqual({ replicas: 2 });
  });

  it("reads a topic whose only route is a deny rule as unread, and never as overloaded", () => {
    const d = diagram(
      [
        node("svc", "generic.service", { replicas: 2 }),
        node("topic", "kafka.topic"),
        node("worker", "generic.service", { concurrency: 0 }),
      ],
      [
        { id: "svc-topic", from: "svc", to: "topic", kind: "async" },
        { id: "topic-worker", from: "topic", to: "worker", kind: "async", props: { deny: true } },
      ],
    );
    const findings = runChecks({
      ...d,
      nodes: [node("src", "client.user", { ratePerSec: 5 }), ...d.nodes],
      edges: [req("src", "svc"), ...d.edges],
    }).findings;
    const unread = findings.find((f) => f.rule === "no-reader")!;
    expect(unread.title).toBe("Nobody reads topic");
    expect(unread.message).toContain("its only route out is a deny rule: every message is blocked");
    expect(findings.map((f) => f.rule)).not.toContain("capacity");
  });

  it("reads a malformed deny from a file as deny, and says so", () => {
    const file = (deny: unknown) => ({
      format: "diagrams/v1",
      title: "t",
      nodes: [node("fw", "paloalto.ngfw"), node("api", "generic.service")],
      edges: [{ id: "fw-api", from: "fw", to: "api", props: { deny } }],
    });
    for (const deny of ["true", 1, "false", 0, null, { yes: true }]) {
      const result = validateDiagram(file(deny));
      if (!result.ok) throw new Error(result.error);
      expect(result.diagram.edges[0].props?.deny, JSON.stringify(deny)).toBe(true);
      expect(result.warnings.join(" "), JSON.stringify(deny)).toMatch(/read as deny/);
    }
    for (const deny of [true, false]) {
      const result = validateDiagram(file(deny));
      if (!result.ok) throw new Error(result.error);
      expect(result.diagram.edges[0].props?.deny).toBe(deny);
      expect(result.warnings.join(" ")).not.toMatch(/deny/);
    }
    // Anything else that reaches the engine fails closed too.
    expect(isDenyRule({ deny: "false" })).toBe(true);
    expect(isDenyRule({ deny: false })).toBe(false);
    expect(isDenyRule({})).toBe(false);
  });
});
