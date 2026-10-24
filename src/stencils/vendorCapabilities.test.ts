import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NodePanel } from "../canvas/inspector/lazyNodePanel";
import { VENDOR_PARENTS } from "./vendorParents";
import { catalog } from "./catalog";
import { profileOf, resolvePreset } from "./profiles";
import { familyOf } from "./profileFamilies";
import { holdsCallerThread, holdsThreadByDefault } from "./freeCallerProfiles";
import { inferKind } from "./edgeKind";
import { inferRelation, stencilRelation } from "./relations";
import { deviceSpec, isDevice, isFirewallStencil } from "./netDevices";
import { stencilRole } from "./roles";
import * as kinds from "../checks/kinds";
import { admissionPresetFor, managedKind } from "../model/admissionPresets";
import { brokerSpec, isClusterWrapper } from "../model/brokers";
import { resourceWorkload } from "../model/autoscaling";
import { changeNodeStencil } from "../model/changeNodeStencil";
import { triggerFits } from "../model/kedaBindings";
import { routeTableCapable, trafficMixCapable, type RouteTable } from "../model/requestRouting";
import { nodeSimFields } from "../canvas/simFieldRules";
import { Inspector, type InspectorProps } from "../canvas/Inspector";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowNode } from "../canvas/types";
import type { EditorApi } from "../editor/types";
import { vendorParityFixture } from "../lab/vendorParityFixture";
import { createEngine } from "../sim/engine";
import { analyzeCapacity } from "../sim/capacity";
import { safeStorage } from "../lib/storage";

// Static inspector rendering reads the current external stores and the actual lazy-loaded field components.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));
vi.mock("../planning/lazy", () => import("../planning/ui"));

const variants = Object.entries(VENDOR_PARENTS);
// SSR runs no effects: render the actual downloaded panel for the same capability assertions.
beforeAll(async () => {
  await NodePanel.ensureLoaded();
});
const table: RouteTable = {
  rules: [
    {
      id: "read",
      match: { methods: ["GET"], path: { kind: "exact", value: "/items" } },
      targets: [{ edgeId: "out", weight: 1 }],
    },
  ],
};

function capabilities(id: string) {
  const role = stencilRole(id);
  return {
    routeTable: routeTableCapable(id, role),
    trafficMix: trafficMixCapable(role),
    managed: managedKind(id),
    admissionPreset: admissionPresetFor(id),
    device: deviceSpec(id),
    isDevice: isDevice(id),
    firewall: isFirewallStencil(id),
    profile: profileOf(id),
    family: familyOf(id),
    holdsThread: holdsThreadByDefault(id),
    callerThread: [undefined, "blocking", "non-blocking"].map((wait) =>
      holdsCallerThread(id, wait as Parameters<typeof holdsCallerThread>[1]),
    ),
    relation: stencilRelation(id),
    cluster: isClusterWrapper(id),
    selfHosted: kinds.isSelfHostedService(id),
    gateway: kinds.isSelfHostedGateway(id),
    frontDoor: kinds.isFrontDoor(id, role),
    outside: kinds.isOutsideClient(id, role),
    shared: kinds.isSharedByDesign(id),
    service: kinds.isService(id, role),
    secret: kinds.isSecretStore(id),
    workload: kinds.isWorkload(id),
    kafka: kinds.isKafkaFamily(id),
    resource: resourceWorkload(id, familyOf(id)),
    triggers: ["kafka", "aws-sqs-queue", "rabbitmq", "azure-servicebus"].map((t) =>
      triggerFits(t as Parameters<typeof triggerFits>[0], id),
    ),
  };
}

function diagramAfterStencilChange(id: string, routeTable?: RouteTable, admission = false) {
  const d = vendorParityFixture(VENDOR_PARENTS[id] ?? id, routeTable, admission);
  d.nodes[2] = changeNodeStencil(d.nodes[2], id);
  expect(d.nodes[2].props?.routeTable).toEqual(routeTable);
  return d;
}

function inspector(id: string, routed: boolean) {
  const d = diagramAfterStencilChange(id, routed ? table : undefined, !!managedKind(id));
  const flow = toFlow(d);
  const props: InspectorProps = {
    editor: { getDiagram: () => d } as EditorApi,
    meta: flow.meta,
    selectedNodes: [flow.nodes.find((n) => n.id === "work") as DiagramFlowNode],
    selectedEdges: [],
    selectedGroups: [],
    groups: [],
    nodeLabel: (id) => id,
    counts: { nodes: d.nodes.length, edges: d.edges.length, groups: 0 },
    collapsed: false,
    onToggle: () => {},
  };
  const open = vi.spyOn(safeStorage, "getItem").mockReturnValue('{"node-simulation":true}');
  try {
    const html = renderToStaticMarkup(createElement(Inspector, props));
    return [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
  } finally {
    open.mockRestore();
  }
}

function replay(id: string, routeTable?: RouteTable, admission = false, requests = 8) {
  const d = diagramAfterStencilChange(id, routeTable, admission);
  const engine = createEngine({ seed: 7 });
  engine.load(d);
  engine.inject("source", requests);
  engine.step(80);
  const waiting = engine.snapshot();
  engine.step(5000);
  return { waiting, done: engine.snapshot(), analysis: analyzeCapacity(d) };
}

describe("all 58 vendor capability contracts", () => {
  it.each(variants)("%s matches %s on every capability and inspector section", (id, parent) => {
    expect(variants).toHaveLength(58);
    expect(capabilities(id)).toEqual(capabilities(parent));
    for (const other of catalog) {
      expect(inferKind(id, other.id)).toBe(inferKind(parent, other.id));
      expect(inferKind(other.id, id)).toBe(inferKind(other.id, parent));
      expect(inferRelation(id, other.id)).toBe(inferRelation(parent, other.id));
      expect(inferRelation(other.id, id)).toBe(inferRelation(other.id, parent));
    }
    for (const revision of [undefined, "p1", "p2", "p3", "p3-w2"] as const) {
      const planning = revision ? { revision } : undefined;
      expect(brokerSpec(id, stencilRole(id), planning)).toEqual(brokerSpec(parent, stencilRole(parent), planning));
      expect(nodeSimFields(stencilRole(id), id, planning)).toEqual(
        nodeSimFields(stencilRole(parent), parent, planning),
      );
    }
    for (const preset of ["processor-lesson", "managed-measured", "device-size"])
      for (const revision of ["1", "2026-10-14"])
        expect(resolvePreset(id, preset, revision)).toEqual(resolvePreset(parent, preset, revision));
    const routed = routeTableCapable(parent, stencilRole(parent));
    expect(inspector(id, routed)).toEqual(inspector(parent, routed));
    if (routed) expect(inspector(id, true)).toContain("inspector-routing");
  });

  it.each(variants)("%s preserves parent Request playback, admission and authored routing", (id, parent) => {
    const routed = routeTableCapable(parent, stencilRole(parent));
    const admission = !!managedKind(parent);
    const actual = replay(id, routed ? table : undefined, admission);
    expect(actual).toEqual(replay(parent, routed ? table : undefined, admission));
    expect(actual.done.inSystem).toBe(0);
    if (admission) expect(actual.done.nodes.work.rejected).toBeGreaterThan(0);
    if (routed) {
      expect(actual.done.nodes.end.processed).toBeGreaterThan(0);
      expect(actual.done.edges.unused.delivered).toBe(0);
      expect(actual.analysis.nodes.end.offered).toBeGreaterThan(0);
      expect(actual.analysis.nodes.other.offered).toBe(0);
      const empty = replay(id, { rules: [] });
      expect(empty).toEqual(replay(parent, { rules: [] }));
      expect(empty.done.nodes.work.rejectionReasons).toMatchObject({ "route-not-found": 8 });
      expect(empty.done.nodes.end.processed).toBe(0);
      expect(empty.analysis.nodes.end.offered).toBe(0);
    }
  });

  it.each(["apisix", "gcp.apigee", "fastly.compute"])(
    "%s vendor Request playback preserves parent waiting behavior",
    (id) => {
      const parent = VENDOR_PARENTS[id];
      const routed = routeTableCapable(parent, stencilRole(parent));
      // Two Requests fit the serverless parent's two-slot fleet, so this case exercises successful replies.
      const actual = replay(id, routed ? table : undefined, false, 2);
      expect(actual).toEqual(replay(parent, routed ? table : undefined, false, 2));
      expect(actual.waiting.nodes.caller.threads?.waiting).toBeGreaterThan(0);
      expect(actual.waiting.edges.in.calls?.inFlight).toBeGreaterThan(0);
      if (id === "fastly.compute") {
        expect(actual.waiting.nodes.work.threads?.waiting).toBeGreaterThan(0);
        expect(actual.waiting.edges.out.calls?.held).toBeGreaterThan(0);
      }
      expect(actual.done.nodes.end.processed).toBe(2);
      expect(actual.done.nodes.work.rejected ?? 0).toBe(0);
      expect(actual.done.nodes.caller.threads).toMatchObject({ waiting: 0, working: 0, queued: 0 });
      expect(actual.done.edges.in.calls).toMatchObject({ inFlight: 0, held: 0 });
      expect(actual.done.edges.out.calls).toMatchObject({ inFlight: 0, held: 0 });
      expect(actual.done.inSystem).toBe(0);
    },
  );
});
