import { sharedConcurrencyKey } from "./admissionPolicy";
import { describe, expect, it, vi } from "vitest";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { realSnapshot } from "./units";
import type { DiagramFile } from "../model/types";
import type { ApiBehaviour, Quota } from "../model/admission";
import { localRateQuota } from "../model/admissionPresets";
import { resolveNodeProps } from "./defaults";
import { analyzeCapacity } from "./capacity";
import { sizingFix } from "./capacityPlanning";
import { attemptAdmission, emptyAdmission, configureAdmission, releaseAdmissions } from "./admission";
import * as policyModule from "./admissionPolicy";
import * as admissionModule from "./admission";
import * as admissionSchema from "../model/admissionSchema";
import { validateDiagram } from "../interop/native";
import { buildJourney } from "../trace/journey";
import { explainNode } from "../planning/explanation";
import { explanationSimulation } from "../planning/explanation";
import { admissionCapacities } from "./admissionPlanning";
import { upgradePlanning } from "../planning/migration";
import * as topology from "./topology";
import { countingReads } from "../test/complexity";
import { capacityView, freePlaySaveProps } from "../live/capacityModel";

const q = (amount = 10, extra: Partial<Quota> = {}): Quota => ({
  id: "rate",
  unit: "requests",
  amount,
  windowMs: 1000,
  algorithm: "token-bucket",
  ...extra,
});
function diagram(api: ApiBehaviour = { quotas: [q()] }, stencil = "generic.external-api"): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3" },
    title: "Admission",
    nodes: [{ id: "api", stencil, label: "API", x: 300, y: 100, props: { api, latencyMs: 100, jitter: 0 } }],
    edges: [],
  };
}
const load = (d: DiagramFile, scale = 1) => {
  const e = createEngine({ seed: 1, scale, traceHistory: 20 });
  e.load(d);
  return e;
};

it.each([
  [1.1, 2, 1],
  [2.5, 3, 1.5],
  [2, 2.5, 1.25],
])("partial admission packs two cohorts at scale %s into %s slots", (represented, slots, weight) => {
  const state = emptyAdmission();
  const policy = { api: { maxInFlight: slots }, endpoints: [], slots };
  const admitted = Array.from({ length: 2 }, () =>
    attemptAdmission(state, "api", policy, undefined, undefined, 0, represented, slots, [], true),
  );
  for (const result of admitted) {
    if ("rejected" in result) throw new Error(result.rejected);
    expect(result.leases.request).toMatchObject({ represented, weight });
    expect(result.leases.thread).toMatchObject({ represented, weight });
  }
  expect([...state.inFlight.values()]).toEqual([slots, slots]);
  expect(attemptAdmission(state, "api", policy, undefined, undefined, 0, represented, slots, [], true)).toEqual({
    rejected: "concurrency",
  });
  for (const result of admitted) if (!("rejected" in result)) releaseAdmissions(state, result.leases);
  expect([...state.inFlight.values()]).toEqual([0, 0]);
});

it("paired release preserves a sibling slot after renewing unequal retained weights", () => {
  const state = emptyAdmission();
  const policy = { api: { maxInFlight: 10 }, endpoints: [], slots: 10 };
  const admitted = attemptAdmission(state, "api", policy, undefined, undefined, 0, 4);
  if ("rejected" in admitted) throw new Error(admitted.rejected);
  const retained = admitted.leases;
  // A continuation returned two execution slots while retaining its four requests.
  for (const key of retained.thread.keys) state.inFlight.set(key, state.inFlight.get(key)! - 2);
  retained.thread.weight = 2;
  const sibling = attemptAdmission(state, "api", policy, undefined, undefined, 0, 1);
  if ("rejected" in sibling) throw new Error(sibling.rejected);
  const renewed = attemptAdmission(state, "api", policy, undefined, undefined, 0, 4, 10, [], true, retained);
  if ("rejected" in renewed) throw new Error(renewed.rejected);
  expect(renewed.leases.request.weight).toBe(4);
  expect(renewed.leases.thread.weight).toBe(2);
  expect(renewed).not.toHaveProperty("lease");
  releaseAdmissions(state, renewed.leases);
  for (const lease of [sibling.leases.request, sibling.leases.thread])
    for (const key of lease.keys) expect(state.inFlight.get(key)).toBe(1);
  releaseAdmissions(state, sibling.leases);
  expect([...state.inFlight.values()].every((count) => count === 0)).toBe(true);
});
describe("P3 managed admission", () => {
  it.each(["node", "endpoint"])(
    "duplicate quota ids in the %s API scope fail import and runtime validation",
    (scope) => {
      const d = diagram(scope === "node" ? { quotas: [q(1), q(100)] } : {});
      if (scope === "endpoint")
        d.nodes[0].props!.endpoints = [{ id: "a", method: "GET", path: "/", behaviour: { quotas: [q(1), q(100)] } }];
      expect(validateDiagram(d)).toMatchObject({
        ok: false,
        error: expect.stringContaining("quota ids must be unique"),
      });
      const e = load(d);
      e.inject("api", 3);
      expect(e.snapshot().nodes.api).toMatchObject({ rejected: 3, inFlight: 0 });
    },
  );
  it("opaque node and allocation ids cannot collide with local concurrency", () => {
    const d = diagram({ maxInFlight: 1, sharedConcurrency: "node", latencyMs: 1000 });
    d.nodes[0].id = "shared";
    d.planning!.sharedAllocations = [{ id: "node", maxInFlight: 10 }];
    expect(validateDiagram(d).ok).toBe(true);
    const e = load(d);
    e.inject("shared", 2);
    expect(e.snapshot().nodes.shared).toMatchObject({ inFlight: 1, rejected: 1 });
    expect(
      admissionCapacities(
        [
          {
            id: "shared",
            policy: resolveNodeProps(d, d.nodes[0]).admission!,
            offered: 2,
            timing: { workMs: 1000, threadHoldMs: 1000, memoryResidenceMs: 1000 },
            endpoints: [{ rate: 2 }],
          },
        ],
        d.planning,
      ).get("shared"),
    ).toBe(1);
  });
  it.each(["node", "endpoint", "shared", "slots"])(
    "zero-duration calls respect a zero %s concurrency budget",
    (scope) => {
      const policy = {
        api: {
          latencyMs: 0,
          ...(scope === "node" ? { maxInFlight: 0 } : {}),
          ...(scope === "shared" ? { sharedConcurrency: "account" } : {}),
        },
        endpoints:
          scope === "endpoint" ? [{ id: "a", method: "GET" as const, path: "/", behaviour: { maxInFlight: 0 } }] : [],
        ...(scope === "slots" ? { slots: 0 } : {}),
      };
      const planning = { revision: "p3" as const, sharedAllocations: [{ id: "account", maxInFlight: 0 }] };
      const endpoint = scope === "endpoint" ? "a" : undefined;
      expect(
        admissionCapacities(
          [
            {
              id: "api",
              policy,
              offered: 10,
              timing: { workMs: 0, threadHoldMs: 0, memoryResidenceMs: 0 },
              endpoints: [{ id: endpoint, rate: 10 }],
            },
          ],
          planning,
        ).get("api"),
      ).toBe(0);
      const state = emptyAdmission();
      configureAdmission(state, [policy], planning);
      expect(attemptAdmission(state, "api", policy, endpoint, planning, 0, 1)).toEqual({ rejected: "concurrency" });
    },
  );
  it("capacity indexes declared endpoints before evaluating repeated incoming calls", () => {
    const endpoints = countingReads(
      Array.from({ length: 500 }, (_, i) => ({ id: String(i), method: "GET" as const, path: "/" })),
    );
    const capacity = admissionCapacities([
      {
        id: "api",
        policy: { api: { maxInFlight: 10 }, endpoints: endpoints.items },
        offered: 10000,
        timing: { workMs: 1000, threadHoldMs: 1000, memoryResidenceMs: 1000 },
        endpoints: Array.from({ length: 10000 }, (_, i) => ({ id: String(i % 500), rate: 1 })),
      },
    ]);
    expect(capacity.get("api")).toBe(10);
    expect(endpoints.reads()).toBeLessThan(500 * 8);
  });
  it("checkpoint cloning contains only mutable admission buckets and occupancy", () => {
    const e = load(diagram({ quotas: [q(2)], maxInFlight: 1 }));
    e.inject("api", 1);
    const clone = vi.spyOn(globalThis, "structuredClone");
    const saved = e.checkpoint();
    const graph = clone.mock.calls.map(([value]) => value as { admission?: object }).find((value) => value.admission);
    expect(Object.keys(graph!.admission!).sort()).toEqual(["buckets", "inFlight", "retainedExcess"]);
    clone.mockRestore();
    e.setNodeProps("api", { api: { quotas: [q(100)], maxInFlight: 10 } });
    e.restore(saved);
    e.inject("api", 1);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 1, rejected: 1 });
    e.step(1000);
    e.inject("api", 1);
    expect(e.snapshot().nodes.api.inFlight).toBe(1);
  });
  it("accepted time-zero scalar fleet timelines reuse validated endpoint requirements", () => {
    const d = diagram({ quotas: Array.from({ length: 32 }, (_, i) => q(100, { id: String(i) })) }, "aws.lambda");
    d.nodes[0].props!.endpoints = Array.from({ length: 500 }, (_, i) => ({ id: String(i), method: "GET", path: "/" }));
    const sim = {
      id: "scalar",
      title: "Fleet edits",
      traffic: [],
      timeline: Array.from({ length: 1000 }, (_, i) => ({
        atMs: 0,
        action: { do: "props" as const, node: "api", props: { concurrency: (i % 2) + 1 } },
      })),
    };
    d.simulations = [sim];
    expect(validateDiagram(d).ok).toBe(true);
    const validate = vi.spyOn(admissionSchema, "validAdmissionData");
    const normalize = vi.spyOn(policyModule, "normalizeCall");
    try {
      createSimulationRun(d, sim);
      expect(validate.mock.calls.length).toBeLessThanOrEqual(2);
      expect(normalize.mock.calls.length).toBeLessThanOrEqual(2 * 501);
    } finally {
      validate.mockRestore();
      normalize.mockRestore();
    }
  });
  it("document shared quotas enforce matching references, charging parent and endpoint only once", () => {
    const d = diagram({ quotas: [q(2, { sharedGroup: "account" })] });
    d.planning!.sharedQuotas = [q(2, { id: "account" })];
    d.nodes.push({ ...d.nodes[0], id: "other" });
    const policies = d.nodes.map((n) => resolveNodeProps(d, n).admission!);
    const entries = policies.map((policy, i) => ({
      id: String(i),
      policy,
      offered: 10,
      timing: { workMs: 100, threadHoldMs: 100, memoryResidenceMs: 100 },
      endpoints: [{ rate: 10 }],
    }));
    expect([...admissionCapacities(entries, d.planning).values()]).toEqual([1, 1]);
    let e = load(d);
    e.inject("api", 1);
    e.inject("other", 2);
    expect(e.snapshot().nodes.other).toMatchObject({ inFlight: 1, rejected: 1 });
    d.planning!.sharedQuotas[0].amount = 3;
    expect([...admissionCapacities(entries, d.planning).values()]).toEqual([0, 0]);
    const state = emptyAdmission();
    configureAdmission(state, policies, d.planning);
    expect(attemptAdmission(state, "api", policies[0], undefined, d.planning, 0, 1)).toHaveProperty("rejected");
    expect(state.buckets.size).toBe(0);
    e = load(d);
    e.inject("api", 1);
    e.inject("other", 1);
    expect(e.snapshot().nodes.api.rejected).toBe(1);
    expect(e.snapshot().nodes.other.rejected).toBe(1);
    d.planning!.sharedQuotas[0].amount = 2;
    d.nodes[0].props!.endpoints = [
      { id: "a", method: "GET", path: "/", behaviour: { quotas: [q(2, { sharedGroup: "account" })] } },
    ];
    const policy = resolveNodeProps(d, d.nodes[0]).admission!;
    const shared = emptyAdmission();
    configureAdmission(shared, [policy], d.planning);
    expect(attemptAdmission(shared, "api", policy, "a", d.planning, 0, 1)).toHaveProperty("leases");
    expect([...shared.buckets.values()].map((bucket) => bucket.tokens)).toEqual([1]);
    expect(
      admissionCapacities([{ ...entries[0], policy, endpoints: [{ id: "a", rate: 10 }] }], d.planning).get("0"),
    ).toBe(2);
  });
  it("endpoint quota namespaces agree between planning and playback", () => {
    const d = diagram({ quotas: [q(100)] });
    d.nodes[0].props!.endpoints = [{ id: "global", method: "GET", path: "/", behaviour: { quotas: [q(2)] } }];
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "source", to: "api", kind: "sync", props: { endpointId: "global", travelMs: 0 } });
    expect(analyzeCapacity(d).nodes.api.capacity).toBe(2);
    const e = load(d);
    e.inject("source", 3);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 2, rejected: 1 });
  });
  it("reference-only callers inherit an implicit account allocation", () => {
    const a = { api: { maxInFlight: 2, sharedConcurrency: "account" }, endpoints: [] };
    const b = { api: { sharedConcurrency: "account" }, endpoints: [] };
    const state = emptyAdmission();
    configureAdmission(state, [a, b]);
    const first = attemptAdmission(state, "a", a, undefined, undefined, 0, 1);
    expect(first).toHaveProperty("leases");
    expect(attemptAdmission(state, "b", b, undefined, undefined, 0, 1)).toHaveProperty("leases");
    expect(attemptAdmission(state, "b", b, undefined, undefined, 0, 1)).toEqual({ rejected: "concurrency" });
    if ("leases" in first) releaseAdmissions(state, first.leases);
    expect(attemptAdmission(state, "b", b, undefined, undefined, 0, 1)).toHaveProperty("leases");
    expect([
      ...admissionCapacities(
        [a, b].map((policy, i) => ({
          id: String(i),
          policy,
          offered: 10,
          timing: { workMs: 1000, threadHoldMs: 1000, memoryResidenceMs: 1000 },
          endpoints: [{ rate: 10 }],
        })),
      ).values(),
    ]).toEqual([1, 1]);
  });
  it.each([0, 5])("a request that cannot fit in a token bucket has zero usable capacity (burst %s)", (burst) => {
    const d = diagram({ quotas: [q(10, { unit: "tokens", burst })], costPerRequest: { tokens: 6 } });
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "source", to: "api", kind: "sync", props: { travelMs: 0 } });
    expect(analyzeCapacity(d).nodes.api.capacity).toBe(0);
    const e = load(d);
    e.inject("source", 1);
    e.step(2000);
    e.inject("source", 1);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 0, rejected: 2 });
  });
  it("managed consumers retain each input group's partition assignment and drain staged work", () => {
    const d = diagram({}, "aws.lambda");
    Object.assign(d.nodes[0].props!, {
      scaling: "fixed",
      replicas: 8,
      concurrency: 1,
      latencyMs: 1000,
      preset: "managed-measured",
    });
    for (const [id, partitions] of [
      ["small", 1],
      ["large", 8],
    ] as const) {
      d.nodes.push({ id, stencil: "kafka.topic", label: id, x: 0, y: 0, props: { partitions } });
      d.edges.push({ id: `feed-${id}`, from: id, to: "api", kind: "async", props: { travelMs: 0 } });
    }
    const e = load(d);
    e.inject("small", 3);
    e.step(100);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 1, activeReplicas: 8, rejected: 0 });
    e.step(4000);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 3, inFlight: 0, rejected: 0 });
  });
  it.each([0.5, 2])(
    "saving Capacity x %s on a fixed managed fleet preserves playback and its independent allocation",
    (factor) => {
      const d = diagram({}, "aws.lambda");
      Object.assign(d.nodes[0].props!, {
        scaling: "fixed",
        replicas: 8,
        concurrency: 1,
        maxConcurrency: 100,
        preset: "managed-measured",
      });
      const e = load(d);
      e.setCapacityMultiplier(factor);
      e.inject("api", 20);
      expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 8 * factor, rejected: 20 - 8 * factor });
      const saved = freePlaySaveProps(d, { props: {}, rates: {}, capacity: factor });
      expect(saved.api).toEqual({ replicas: 8 * factor });
      Object.assign(d.nodes[0].props!, saved.api);
      const restored = load(d);
      restored.inject("api", 20);
      expect(restored.snapshot().nodes.api).toMatchObject({ inFlight: 8 * factor, rejected: 20 - 8 * factor });
      expect(d.nodes[0].props!.maxConcurrency).toBe(100);
    },
  );
  it("fixed fleet capacity scales above the base in planning and after scalar edits", () => {
    const d = diagram({}, "aws.lambda");
    Object.assign(d.nodes[0].props!, {
      preset: "managed-measured",
      scaling: "fixed",
      replicas: 2,
      concurrency: 1,
      maxConcurrency: 100,
      latencyMs: 1000,
    });
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "source", to: "api", kind: "sync", props: { travelMs: 0 } });
    expect(
      analyzeCapacity(d, {
        id: "double",
        title: "Double",
        traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 10, durationMs: 1000 } }],
        multipliers: { capacity: 2 },
      }).nodes.api.capacity,
    ).toBe(4);
    const e = load(d);
    e.setCapacityMultiplier(2);
    e.setNodeProps("api", { concurrency: 2 });
    e.inject("api", 9);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 8, rejected: 1 });
  });
  it("unrelated managed edits and a source timeline do not revalidate or reconfigure admissions", () => {
    const d = diagram();
    d.nodes = Array.from({ length: 24 }, (_, i) => ({ ...d.nodes[0], id: String(i) }));
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0 });
    const e = load(d);
    const configure = vi.spyOn(admissionModule, "reconfigureAdmission");
    const validate = vi.spyOn(admissionSchema, "validAdmissionData");
    try {
      for (let i = 0; i < 24; i++) e.setNodeProps(String(i), { latencyMs: 50 });
      for (let i = 0; i < 1000; i++) e.setNodeProps("source", { ratePerSec: i });
      expect(configure.mock.calls.length).toBe(0);
      expect(validate).not.toHaveBeenCalled();
    } finally {
      configure.mockRestore();
      validate.mockRestore();
    }
  });
  it("local policy edits compile only the affected node; static admission attempts serialize no keys", () => {
    const d = diagram();
    d.nodes = Array.from({ length: 24 }, (_, i) => ({ ...d.nodes[0], id: String(i) }));
    const e = load(d);
    // Compile/warm both execution paths before counting work.
    e.inject("0", 1);
    e.inject("1", 1);
    const validate = vi.spyOn(admissionSchema, "validAdmissionData");
    const serialize = vi.spyOn(JSON, "stringify");
    try {
      e.setNodeProps("0", { api: { quotas: [q(20)] } });
      expect(validate).toHaveBeenCalledTimes(1);
      const edits = serialize.mock.calls.length;
      expect(edits).toBeLessThanOrEqual(12); // Independent of the other 23 managed policies.
      e.inject("0", 8);
      e.inject("1", 8);
      expect(serialize.mock.calls.length).toBe(edits);
    } finally {
      validate.mockRestore();
      serialize.mockRestore();
    }
  });
  it("large endpoint policies perform no endpoint searches or key serialization after compilation", () => {
    const quotas = Array.from({ length: 32 }, (_, i) => q(10000, { id: String(i) }));
    const endpoints = countingReads(
      Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        method: "GET" as const,
        path: "/",
        behaviour: { quotas },
      })),
    );
    const policy = { api: { quotas }, endpoints: endpoints.items };
    const state = emptyAdmission();
    configureAdmission(state, [policy]);
    expect(attemptAdmission(state, "api", policy, "499", undefined, 0, 1)).toHaveProperty("leases");
    const reads = endpoints.reads();
    const serialize = vi.spyOn(JSON, "stringify");
    try {
      for (let i = 0; i < 100; i++)
        expect(attemptAdmission(state, "api", policy, String(i), undefined, 0, 1)).toHaveProperty("leases");
      expect(serialize.mock.calls.length).toBe(0);
      expect(endpoints.reads()).toBe(reads);
    } finally {
      serialize.mockRestore();
    }
  });
  it("time-zero source patches do not visit managed definitions during simulation initialization", () => {
    const d = diagram();
    d.nodes[0].props!.endpoints = Array.from({ length: 500 }, (_, i) => ({ id: String(i), method: "GET", path: "/" }));
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0 });
    const configure = vi.spyOn(admissionModule, "reconfigureAdmission");
    try {
      createSimulationRun(d, {
        id: "patches",
        title: "Patches",
        traffic: [],
        timeline: Array.from({ length: 1000 }, (_, i) => ({
          atMs: 0,
          action: { do: "props", node: "source", props: { ratePerSec: i } },
        })),
      });
      expect(configure).toHaveBeenCalledTimes(1); // Initial load only, independent of timeline length.
    } finally {
      configure.mockRestore();
    }
  });
  it("shared allocation edits invalidate reference-only callers while retaining active leases", () => {
    const d = diagram({ maxInFlight: 2, sharedConcurrency: "account" });
    d.nodes.push({
      ...d.nodes[0],
      id: "other",
      props: { api: { sharedConcurrency: "account" }, latencyMs: 100, jitter: 0 },
    });
    const e = load(d);
    e.inject("other", 1);
    e.setNodeProps("api", { api: { maxInFlight: 1, sharedConcurrency: "account" } });
    e.inject("other", 1);
    expect(e.snapshot().nodes.other).toMatchObject({ inFlight: 1, rejected: 1 });
    const saved = e.checkpoint();
    e.step(200);
    e.inject("other", 1);
    expect(e.snapshot().nodes.other.rejected).toBe(1);
    e.restore(saved);
    e.inject("other", 1);
    expect(e.snapshot().nodes.other.rejected).toBe(2);
  });
  it("endpoint ids must be unique in imports and runtime resolution", () => {
    const d = diagram({});
    d.nodes[0].props!.endpoints = [100, 0].map((maxInFlight) => ({
      id: "get",
      method: "GET",
      path: "/",
      behaviour: { maxInFlight },
    }));
    expect(validateDiagram(d).ok).toBe(false);
    const e = load(d);
    e.inject("api", 1);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 0, rejected: 1 });
  });
  it.each([42, null, "", {}, "x".repeat(201)])("malformed endpoint references fail closed (%j)", (endpointId) => {
    const d = diagram({});
    d.nodes[0].props!.endpoints = [{ id: "42", method: "GET", path: "/", behaviour: { maxInFlight: 0 } }];
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "source", to: "api", kind: "sync", props: { endpointId, travelMs: 0 } });
    expect(validateDiagram(d).ok).toBe(false);
    expect(analyzeCapacity(d).nodes.api.capacity).toBe(0);
    const e = load(d);
    e.inject("source", 1);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 0, rejected: 1 });
  });
  it.each(["generic.external-api", "aws.api-gateway"])(
    "%s outage releases local and shared reservations",
    (stencil) => {
      const d = diagram({ maxInFlight: 1, sharedConcurrency: "account" }, stencil);
      d.nodes.push({ ...d.nodes[0], id: "other" });
      const e = load(d);
      e.inject("api", 1);
      e.setNodeStatus("api", "down");
      e.step(20);
      e.setNodeStatus("api", "up");
      e.inject("other", 1);
      e.step(200);
      e.inject("api", 1);
      e.step(200);
      expect(e.snapshot().nodes.other).toMatchObject({ processed: 1, rejected: 0 });
      expect(e.snapshot().nodes.api).toMatchObject({ processed: 1, rejected: 0, inFlight: 0, dropped: 1 });
    },
  );
  it.each(["node", "slots"])("endpoint %s cannot overwrite execution or node concurrency", (id) => {
    const policy = {
      ...(id === "slots" ? { slots: 1 } : {}),
      api: id === "node" ? { maxInFlight: 1 } : {},
      endpoints: [{ id, method: "GET" as const, path: "/", behaviour: { maxInFlight: 10 } }],
    };
    const state = emptyAdmission();
    configureAdmission(state, [policy]);
    expect(attemptAdmission(state, "api", policy, id, undefined, 0, 2)).toHaveProperty("rejected", "concurrency");
  });
  it("endpoint node has independent local quota keys even with the same quota id", () => {
    const policy = {
      api: { quotas: [q(2)] },
      endpoints: [{ id: "node", method: "GET" as const, path: "/", behaviour: { quotas: [q(1)] } }],
    };
    const state = emptyAdmission();
    configureAdmission(state, [policy]);
    expect(attemptAdmission(state, "api", policy, "node", undefined, 0, 1)).not.toHaveProperty("rejected");
    expect(attemptAdmission(state, "api", policy, "node", undefined, 0, 1)).toHaveProperty(
      "rejected",
      "rate: requests",
    );
  });
  it("conflicting shared budgets have no usable planning capacity", () => {
    const entries = [10, 20].map((amount, i) => ({
      id: String(i),
      policy: { api: { quotas: [q(amount, { sharedGroup: "account" })] }, endpoints: [] },
      offered: 2,
      timing: { workMs: 100, threadHoldMs: 100, memoryResidenceMs: 100 },
      endpoints: [{ rate: 2 }],
    }));
    expect([...admissionCapacities(entries).values()]).toEqual([0, 0]);
  });
  it("zero-demand direct injections do not erase endpoint token cost evidence", () => {
    const policy = {
      api: { quotas: [q(1000, { unit: "tokens" })] },
      endpoints: [{ id: "get", method: "GET" as const, path: "/", behaviour: { costPerRequest: { tokens: 10 } } }],
    };
    expect(
      admissionCapacities([
        {
          id: "api",
          policy,
          offered: 10,
          timing: { workMs: 100, threadHoldMs: 100, memoryResidenceMs: 100 },
          endpoints: [{ id: "get", rate: 10 }, { rate: 0 }],
        },
      ]).get("api"),
    ).toBe(100);
  });
  it("capacity uses the targeted endpoint duration instead of a slower parent", () => {
    const d = diagram({ maxInFlight: 1, latencyMs: 1000 });
    d.nodes[0].props!.endpoints = [{ id: "fast", method: "GET", path: "/", behaviour: { latencyMs: 10 } }];
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "source", to: "api", kind: "sync", props: { endpointId: "fast", travelMs: 0 } });
    expect(analyzeCapacity(d).nodes.api.capacity).toBe(100);
    const e = load(d);
    e.inject("source", 10, { spreadMs: 1000 });
    e.step(2000);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 10, rejected: 0 });
  });
  it("managed capacity visits incoming edges in linear work", () => {
    const d = diagram();
    d.nodes = Array.from({ length: 24 }, (_, i) => ({ ...d.nodes[0], id: String(i) }));
    d.nodes.push({ id: "source", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges = d.nodes
      .slice(0, -1)
      .map((node) => ({ id: `call-${node.id}`, from: "source", to: node.id, kind: "sync" }));
    const compile = topology.compileTopology;
    let reads = () => 0;
    const spy = vi.spyOn(topology, "compileTopology").mockImplementation((...args) => {
      const compiled = compile(...args);
      const counted = countingReads(compiled.edges);
      compiled.edges = counted.items;
      reads = counted.reads;
      return compiled;
    });
    try {
      analyzeCapacity(d);
      expect(reads()).toBeGreaterThanOrEqual(d.edges.length);
      expect(reads()).toBeLessThanOrEqual(4 * (d.nodes.length + d.edges.length));
    } finally {
      spy.mockRestore();
    }
  });
  it("live quota edits change the refill rate at edit time, before the next call", () => {
    const e = load(diagram({ quotas: [q(100, { burst: 100 })] }));
    e.inject("api", 100);
    e.step(500);
    e.setNodeProps("api", { api: { quotas: [q(1, { burst: 100 })] } });
    e.step(500);
    e.inject("api", 100);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 150, rejected: 50 });
  });
  it("retained consumer retries consume an attempt budget without double-booking concurrency", () => {
    const d = diagram({ maxInFlight: 1, quotas: [q(1, { windowMs: 60000 })], errorRate: 1 }, "aws.lambda");
    d.nodes[0].props!.retry = "inplace";
    d.nodes[0].props!.retryBackoffMs = 10;
    d.nodes.push({
      id: "queue",
      stencil: "aws.sqs",
      label: "Queue",
      x: 0,
      y: 0,
      props: { maxDeliveryCount: 3, latencyMs: 0 },
    });
    d.edges.push({ id: "delivery", from: "queue", to: "api", kind: "async", props: { travelMs: 0 } });
    const e = load(d);
    e.inject("queue", 1);
    e.step(1000);
    expect(e.snapshot().nodes.api).toMatchObject({ failed: 1, rejected: 1, inFlight: 0 });
    expect(e.metrics().inSystem).toBe(0);
  });
  it("P2 upgrade selects measured behaviour, preserving vendor admissions and saved contexts", () => {
    const d = diagram({}, "stripe");
    d.planning = { revision: "p2" };
    d.nodes[0].props = {};
    d.simulations = [
      {
        id: "saved",
        title: "Saved",
        durationMs: 1000,
        traffic: [],
        setup: { props: { api: { latencyMs: 0 } } },
        timeline: [{ atMs: 10, action: { do: "props", node: "api", props: { failureRate: 0 } } }],
      },
    ];
    const upgraded = upgradePlanning(d);
    const run = (file: DiagramFile) => {
      const e = load(file);
      e.inject("api", 101);
      e.step(200);
      return e.snapshot().nodes.api;
    };
    expect(run(d).processed).toBe(101);
    expect(run(upgraded)).toMatchObject({ processed: 101, rejected: 0 });
    const sim = upgraded.simulations![0];
    const e = load(upgraded);
    e.setNodeProps("api", sim.setup!.props!.api);
    e.setNodeProps("api", { failureRate: 0 });
    e.inject("api", 101);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 101, rejected: 0 });
    expect(resolveNodeProps(upgraded, upgraded.nodes[0]).profile.preset).toBe("managed-measured");
  });
  it("planning and admission share an endpoint allocation without charging its parent twice", () => {
    const policy = {
      api: { sharedConcurrency: "account" },
      endpoints: [{ id: "get", method: "GET" as const, path: "/", behaviour: { sharedConcurrency: "account" } }],
    };
    const planning = { revision: "p3" as const, sharedAllocations: [{ id: "account", maxInFlight: 2 }] };
    expect(
      admissionCapacities(
        [
          {
            id: "api",
            policy,
            offered: 10,
            timing: { workMs: 1000, threadHoldMs: 1000, memoryResidenceMs: 1000 },
            endpoints: [{ id: "get", rate: 10 }],
          },
        ],
        planning,
      ).get("api"),
    ).toBe(2);
    const state = emptyAdmission();
    configureAdmission(state, [policy], planning);
    expect(attemptAdmission(state, "api", policy, "get", planning, 0, 2)).not.toHaveProperty("rejected");
    expect(attemptAdmission(state, "api", policy, "get", planning, 0, 1)).toHaveProperty("rejected", "concurrency");
  });
  it("a fractional local RPS budget can bank one request rather than rejecting forever", () => {
    const e = load(diagram({ quotas: [localRateQuota(0.5)] }));
    e.inject("api", 2);
    e.step(2000);
    e.inject("api", 1);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 2, rejected: 1 });
  });
  it("rejects exactly one extra request over a deterministic bucket, without classifying a loss or failure", () => {
    const e = load(diagram());
    e.inject("api", 11);
    e.step(200);
    const n = e.snapshot().nodes.api;
    expect(n).toMatchObject({ processed: 10, rejected: 1, failed: 0, dropped: 0, backlog: 0, inFlight: 0 });
    expect(
      e.tracer.recent().filter((t) => e.tracer.get(t.rootId)?.steps.some((s) => s.kind === "reject")),
    ).toHaveLength(1);
  });
  it("refills on simulation time only and checkpoints restore bucket and slot reservations", () => {
    vi.useFakeTimers();
    try {
      const e = load(diagram({ quotas: [q(1)] }));
      e.inject("api", 1);
      const saved = e.checkpoint();
      vi.advanceTimersByTime(100000);
      e.inject("api", 1);
      expect(e.snapshot().nodes.api.rejected).toBe(1);
      e.restore(saved);
      e.step(1000);
      e.inject("api", 1);
      e.step(200);
      expect(e.snapshot().nodes.api).toMatchObject({ processed: 2, rejected: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
  it("two visual APIs share one account cap with atomic charging", () => {
    const d = diagram({ quotas: [q(10, { sharedGroup: "account" })] });
    d.nodes.push({ ...d.nodes[0], id: "other" });
    const e = load(d);
    e.inject("api", 6);
    e.inject("other", 5);
    e.step(200);
    expect(e.snapshot().nodes.api.processed + e.snapshot().nodes.other.processed).toBe(10);
    expect(e.snapshot().nodes.other.rejected).toBe(1);
  });
  it("conflicting shared definitions reject both callers before either consumes the account", () => {
    const d = diagram({ quotas: [q(10, { sharedGroup: "account" })] });
    d.nodes.push({ ...d.nodes[0], id: "other", props: { api: { quotas: [q(20, { sharedGroup: "account" })] } } });
    const e = load(d);
    e.inject("api", 1);
    e.inject("other", 1);
    e.step(200);
    expect(e.snapshot().nodes.api.processed + e.snapshot().nodes.other.processed).toBe(0);
    expect(e.snapshot().nodes.api.rejected).toBe(1);
  });
  it("two endpoints each consume global and endpoint budgets; a rejected attempt charges neither", () => {
    const d = diagram({ quotas: [q(3)] });
    d.nodes[0].props!.endpoints = ["a", "b"].map((id) => ({
      id,
      method: "POST",
      path: `/${id}`,
      behaviour: { quotas: [q(2, { id: `endpoint-${id}` })] },
    }));
    for (const id of ["a", "b"]) {
      d.nodes.push({ id, stencil: "client.user", label: id, x: 0, y: 0 });
      d.edges.push({ id: `call-${id}`, from: id, to: "api", kind: "sync", props: { endpointId: id, travelMs: 0 } });
    }
    const e = load(d);
    e.inject("a", 3);
    e.inject("b", 2);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 3, rejected: 2 });
    // The failed A endpoint attempt must leave the final global token for B.
    expect(e.snapshot().nodes.api.rejectionReasons).toEqual({ "endpoint-a: requests": 1, "rate: requests": 1 });
  });
  it.each(["tokens", "inputTokens", "outputTokens", "costPoints"] as const)(
    "%s binds before RPM and is not interpreted as requests",
    (unit) => {
      const e = load(
        diagram({
          quotas: [q(2, { id: "rpm", windowMs: 60000 }), q(20, { id: unit, unit, windowMs: 60000 })],
          costPerRequest: { [unit]: 10 },
        }),
      );
      e.inject("api", 3);
      e.step(200);
      expect(e.snapshot().nodes.api).toMatchObject({
        processed: 2,
        rejected: 1,
        rejectionReasons: { [`${unit}: ${unit}`]: 1 },
      });
    },
  );
  it("a dot charges its represented real workload; burst discretisation differs by less than one dot", () => {
    const run = (scale: number) => {
      const e = load(diagram({ quotas: [q(103)] }), scale);
      e.inject("api", 200 / scale);
      e.step(200);
      return realSnapshot(e.snapshot()).nodes.api;
    };
    const exact = run(1),
      sampled = run(10);
    expect(exact.processed).toBe(103);
    expect(sampled.processed).toBe(100);
    expect(Math.abs(exact.rejected! - sampled.rejected!)).toBeLessThan(10);
  });
  it("slow latency binds concurrent work below the request rate and releases on completion", () => {
    const e = load(diagram({ quotas: [q(100)], maxInFlight: 2 }));
    e.inject("api", 3);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 2, rejected: 1 });
    const saved = e.checkpoint();
    e.step(200);
    e.inject("api", 1);
    e.step(200);
    expect(e.snapshot().nodes.api.processed).toBe(3);
    e.restore(saved);
    e.inject("api", 1);
    expect(e.snapshot().nodes.api.rejected).toBe(2);
  });
  it("Lambda concurrency is independent from source RPS, fixed slots and auto are bounded by allocation", () => {
    const d = diagram({}, "aws.lambda");
    Object.assign(d.nodes[0].props!, {
      maxConcurrency: 3,
      scaling: "auto",
      replicas: 1,
      concurrency: 1,
      latencyMs: 1000,
    });
    d.nodes.push({ id: "src", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 100 } });
    d.edges.push({ id: "call", from: "src", to: "api", kind: "sync", props: { travelMs: 0 } });
    const e = load(d);
    e.setTraffic(true);
    e.step(110);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 3, rejected: 7 });
    expect(resolveNodeProps(d, d.nodes[0]).admission?.slots).toBe(3);
    Object.assign(d.nodes[0].props!, { scaling: "fixed", replicas: 2 });
    expect(resolveNodeProps(d, d.nodes[0]).admission).toMatchObject({ slots: 3, fixedSlotsPerReplica: 1 });
  });
  it("SNS workers use the full fleet rather than Kafka partition assignment", () => {
    const d = diagram({}, "service.node");
    Object.assign(d.nodes[0].props!, { replicas: 8, concurrency: 1, latencyMs: 1000 });
    d.nodes.push({ id: "sns", stencil: "aws.sns", label: "SNS", x: 0, y: 0, props: { partitions: 1 } });
    d.edges.push({ id: "subscription", from: "sns", to: "api", kind: "async", props: { travelMs: 0 } });
    const e = load(d);
    e.inject("sns", 8);
    e.step(20);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 8, activeReplicas: 8 });
    e.inject("sns", 8);
    e.step(8 * 10); // Drain the existing broker prefetch pipeline before checking refusals.
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 8, rejected: 8 });
  });
  it("external latency and errors process truthfully, while caller retry/deadline declarations have no effect", () => {
    const d = diagram({ errorRate: 1, latencyMs: 100 });
    const e = load(d);
    e.inject("api", 1);
    expect(e.snapshot().nodes.api.failed).toBe(0);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ failed: 1, processed: 0, rejected: 0, dropped: 0 });
    for (const revision of ["p1", "p2"] as const) {
      d.planning = { revision };
      const legacy = load(d);
      legacy.inject("api", 11);
      expect(legacy.snapshot().nodes.api.processed).toBe(11);
      expect(legacy.snapshot().nodes.api.rejected).toBeUndefined();
    }
  });
  it("shared concurrent allocations reserve across nodes and endpoint/global scopes once", () => {
    const state = emptyAdmission();
    const policy = { api: { maxInFlight: 2, sharedConcurrency: "account" }, endpoints: [] };
    configureAdmission(state, [policy]);
    expect(attemptAdmission(state, "a", policy, undefined, undefined, 0, 2)).toHaveProperty("leases");
    expect(attemptAdmission(state, "b", policy, undefined, undefined, 0, 1)).toEqual({ rejected: "concurrency" });
  });
  it("planning reports the binding token budget and never proposes SaaS replicas", () => {
    const d = diagram(
      { quotas: [q(100), q(20, { id: "tokens", unit: "tokens" })], costPerRequest: { tokens: 10 } },
      "openai",
    );
    d.nodes.push({ id: "src", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 10 } });
    d.edges.push({ id: "call", from: "src", to: "api", kind: "sync" });
    const analysis = analyzeCapacity(d);
    expect(analysis.nodes.api.capacity).toBe(2);
    expect(analysis.suggestion).toContain("Reduce calls");
    expect(sizingFix(d, { id: "test", title: "Test", traffic: [] }, [analysis.nodes.api])).toBeNull();
  });
  it("consistent live quota edits retain credit and do not leave a permanently conflicting bucket", () => {
    const e = load(diagram({ quotas: [q(1)] }));
    e.inject("api", 1);
    e.setNodeProps("api", { api: { quotas: [q(2)] } });
    e.inject("api", 1);
    expect(e.snapshot().nodes.api.rejected).toBe(1);
    e.step(500);
    e.inject("api", 1);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 2, rejected: 1 });
  });
  it("a quota edit retains credit already refilled by simulation time", () => {
    const e = load(diagram({ quotas: [q(1)] }));
    e.inject("api", 1);
    e.step(1000);
    e.setNodeProps("api", { api: { quotas: [q(2)] } });
    e.inject("api", 1);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ processed: 2, rejected: 0 });
  });
  it.each([{ latencyMs: NaN }, { quotas: [{ ...q(), windowMs: 0 }] }, { costPerRequest: { requests: 0 } }])(
    "malformed free-form API data refuses admission without poisoning the clock (%j)",
    (api) => {
      const e = load(diagram(api));
      e.inject("api", 1);
      e.step(200);
      expect(e.snapshot().nodes.api).toMatchObject({ rejected: 1, processed: 0, inFlight: 0 });
      expect(e.metrics().inSystem).toBe(0);
    },
  );
  it.each(["paypal", "iterable"])("%s limits remain unknown in every explanation", (stencil) => {
    const d = diagram({}, stencil);
    expect(resolveNodeProps(d, d.nodes[0]).admission?.api.quotas).toBeUndefined();
    expect(explainNode(d, "api")).toMatchObject({ managed: "api", capacity: Infinity });
    d.nodes.push({ id: "src", stencil: "client.user", label: "Calls", x: 0, y: 0, props: { ratePerSec: 20 } });
    d.edges.push({ id: "call", from: "src", to: "api", kind: "sync" });
    expect(capacityView(d, explanationSimulation(d))).toMatchObject({
      headline: "Unknown",
      detail: "Limits unknown; enter measured or contracted values.",
    });
  });
  it("Stripe endpoints inherit the cited endpoint budget and still share the global account", () => {
    const d = diagram(undefined, "stripe");
    delete d.nodes[0].props!.api;
    d.nodes[0].props!.endpoints = [{ id: "pay", method: "POST", path: "/v1/payment_intents" }];
    const p = resolveNodeProps(d, d.nodes[0]);
    expect(p.admission?.api.quotas?.[0]).toMatchObject({ amount: 100, sharedGroup: "stripe-live-account" });
    expect(p.admission?.endpoints[0].behaviour?.quotas?.[0]).toMatchObject({ amount: 25 });
    expect(p.profile.evidence.find((e) => e.key === "api")).toMatchObject({
      evidence: "quota",
      checked: "2026-10-14",
      url: "https://docs.stripe.com/rate-limits",
    });
  });
  it("endpoint duration and errors override their parent and rejection ends a trace as rejected", () => {
    const d = diagram({ quotas: [q(1)], errorRate: 0 });
    d.nodes[0].props!.endpoints = [
      { id: "slow", method: "GET", path: "/slow", behaviour: { latencyMs: 1000, errorRate: 1 } },
    ];
    d.nodes.push({
      id: "caller",
      stencil: "service.node",
      label: "Caller",
      x: 0,
      y: 0,
      props: { jitter: 0, latencyMs: 0 },
    });
    d.edges.push({
      id: "call",
      from: "caller",
      to: "api",
      kind: "sync",
      props: {
        travelMs: 0,
        endpointId: "slow",
        caller: {
          deadlineMs: 1,
          retry: {
            maxAttempts: 3,
            backoffMs: 1,
            strategy: "exponential",
            retryOn: ["throttled", "transient", "timeout"],
          },
        },
      },
    });
    const e = load(d);
    e.inject("caller", 2);
    e.step(200);
    expect(e.snapshot().nodes.api).toMatchObject({ inFlight: 1, rejected: 1, failed: 0 });
    const refused = e.tracer.recent().find((s) => s.rejected)!;
    expect(buildJourney(e.tracer.get(refused.rootId)!, d, e.snapshot().time)).toMatchObject({
      rejected: 1,
      failures: 0,
      dropped: 0,
    });
    e.step(1000);
    expect(e.snapshot().nodes.api).toMatchObject({ failed: 1, rejected: 1, processed: 0 });
    expect(e.snapshot().nodes.caller.failed).toBe(0);
    expect(e.tracer.recent().some((s) => s.retries > 0)).toBe(false);
  });
  it("native input rejects malformed units, unbounded endpoints and duplicate account ids", () => {
    const d = diagram({ quotas: [q(1, { unit: "bogus" as Quota["unit"] })] });
    expect(validateDiagram(d).ok).toBe(false);
    d.nodes[0].props = {
      endpoints: Array.from({ length: 501 }, (_, i) => ({ id: String(i), method: "GET", path: "/" })),
    };
    expect(validateDiagram(d).ok).toBe(false);
    d.nodes[0].props = {};
    d.planning!.sharedQuotas = [q(), q()];
    expect(validateDiagram(d).ok).toBe(false);
  });
});

it("a full request tolerates floating subtraction residue at admission", () => {
  const policy = { api: { maxInFlight: 4 }, endpoints: [] };
  const state = emptyAdmission();
  configureAdmission(state, [policy]);
  state.inFlight.set(JSON.stringify(["local", "api", "concurrency", "node"]), 3 + Number.EPSILON * 2);
  const admitted = attemptAdmission(state, "api", policy, undefined, undefined, 0, 1);
  expect(admitted).toHaveProperty("leases.request.weight", 1);
});

it("local reconfiguration never traverses unrelated compiled limits or clears retained excess", () => {
  const state = emptyAdmission();
  const policies = Array.from({ length: 24 }, () => ({ api: { maxInFlight: 10 }, endpoints: [] }));
  admissionModule.reconfigureAdmission(
    state,
    policies.map((policy, i) => ({ id: String(i), policy })),
    undefined,
    0,
  );
  state.retainedExcess.set("unrelated", 3);
  const visits = policies.slice(1).map((policy) =>
    vi.spyOn(state.compiled.get(policy)!.values().next().value!.calls, "values").mockImplementation(() => {
      throw new Error("unrelated compiled policy visited");
    }),
  );
  const clear = vi.spyOn(state.retainedExcess, "clear").mockImplementation(() => {
    throw new Error("all excess cleared");
  });
  try {
    admissionModule.reconfigureAdmission(
      state,
      [{ id: "0", policy: { api: { maxInFlight: 1 }, endpoints: [] } }],
      undefined,
      10,
    );
    expect(state.retainedExcess.get("unrelated")).toBe(3);
  } finally {
    visits.forEach((visit) => visit.mockRestore());
    clear.mockRestore();
  }
});

it("retained excess reconfiguration updates only changed keys", () => {
  const state = emptyAdmission();
  const policy = { api: { maxInFlight: 4 }, endpoints: [] };
  admissionModule.reconfigureAdmission(
    state,
    [
      { id: "a", policy },
      { id: "b", policy: { ...policy } },
    ],
    undefined,
    0,
  );
  const b = state.policies.get("b")!;
  expect(attemptAdmission(state, "a", policy, undefined, undefined, 0, 4)).toHaveProperty("leases");
  expect(attemptAdmission(state, "b", b, undefined, undefined, 0, 4)).toHaveProperty("leases");
  admissionModule.reconfigureAdmission(
    state,
    [{ id: "b", policy: { api: { maxInFlight: 1 }, endpoints: [] } }],
    undefined,
    0,
  );
  const clear = vi.spyOn(state.retainedExcess, "clear").mockImplementation(() => {
    throw new Error("unrelated retained excess reset");
  });
  try {
    admissionModule.reconfigureAdmission(
      state,
      [{ id: "a", policy: { api: { maxInFlight: 1 }, endpoints: [] } }],
      undefined,
      0,
    );
    expect([...state.retainedExcess.values()]).toEqual([3, 3]);
  } finally {
    clear.mockRestore();
  }
});

it("shared diagnostic aggregation visits each owner once per configuration batch", () => {
  const state = emptyAdmission();
  const visits = vi.spyOn(state.limitOwners, "get");
  const count = 128;
  admissionModule.reconfigureAdmission(
    state,
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      policy: { api: { sharedConcurrency: "account", maxInFlight: 4 }, endpoints: [] },
    })),
    undefined,
    0,
  );
  const shared = state.limitOwners.get(sharedConcurrencyKey("account"))!;
  let owners = 0;
  const values = shared.values.bind(shared);
  vi.spyOn(shared, "values").mockImplementation(function* () {
    for (const value of values()) {
      owners++;
      yield value;
    }
    return undefined;
  });
  admissionModule.reconfigureAdmission(
    state,
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      policy: { api: { sharedConcurrency: "account", maxInFlight: 2 }, endpoints: [] },
    })),
    undefined,
    0,
  );
  expect(owners).toBe(count);
  expect(admissionModule.admissionLimits(state).get(sharedConcurrencyKey("account"))).toBe(2);
  expect(visits.mock.calls.length).toBeLessThan(count * 8);
});

it("execution-room waits preserve quota credit", () => {
  const state = emptyAdmission();
  const policy = { api: { maxInFlight: 10, quotas: [q(10)] }, endpoints: [], slots: 10 };
  // Populate the bucket without spending it, then repeat the admission phase at the same clock.
  expect(attemptAdmission(state, "api", policy, undefined, undefined, 0, 10, 10, [], true, undefined, 0)).toEqual({
    rejected: "concurrency",
    waiting: true,
  });
  const before = structuredClone({ buckets: state.buckets, inFlight: state.inFlight });
  for (let attempt = 0; attempt < 20; attempt++) {
    expect(attemptAdmission(state, "api", policy, undefined, undefined, 0, 10, 10, [], true, undefined, 0)).toEqual({
      rejected: "concurrency",
      waiting: true,
    });
    expect({ buckets: state.buckets, inFlight: state.inFlight }).toEqual(before);
  }
  const admitted = attemptAdmission(state, "api", policy, undefined, undefined, 0, 10, 10, [], true, undefined, 10);
  if ("rejected" in admitted) throw new Error(admitted.rejected);
  expect([...state.buckets.values()].map((bucket) => bucket.tokens)).toEqual([0]);
  expect(admitted.leases.thread.weight).toBe(10);
  releaseAdmissions(state, admitted.leases);
  expect([...state.inFlight.values()].every((count) => count === 0)).toBe(true);
  expect([...state.buckets.values()].map((bucket) => bucket.tokens)).toEqual([0]);
});
