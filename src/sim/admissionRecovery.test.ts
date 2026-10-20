import { expect, it } from "vitest";
import {
  attemptAdmission,
  configureAdmission,
  emptyAdmission,
  reacquire,
  reconfigureAdmission,
  releaseAdmission,
  type AdmissionPolicy,
} from "./admission";
import { assertResourceInvariants } from "./resourceInvariants";
import { createCpuPartBudget } from "./resourceWork";
import { concurrencyKey, sharedConcurrencyKey, slotsKey } from "./admissionPolicy";

it.each(["slots", "endpoint", "shared"])(
  "reacquisition atomically checks %s capacity without charging quotas",
  (full) => {
    const state = emptyAdmission();
    const policy: AdmissionPolicy = {
      slots: full === "slots" ? 1 : 4,
      api: {
        maxInFlight: 4,
        sharedConcurrency: "account",
        quotas: [{ id: "spent", unit: "requests", amount: 1, windowMs: 10000, algorithm: "token-bucket" }],
      },
      endpoints: [{ id: "read", method: "GET", path: "/", behaviour: { maxInFlight: full === "endpoint" ? 1 : 4 } }],
    };
    configureAdmission(state, [policy], {
      revision: "p3-w1",
      sharedAllocations: [{ id: "account", maxInFlight: full === "shared" ? 1 : 4 }],
    });
    const admitted = attemptAdmission(state, "caller", policy, "read", undefined, 0, 1);
    if ("rejected" in admitted) throw new Error(admitted.rejected);
    const buckets = structuredClone(state.buckets);
    const capacity = {
      node: "caller",
      policy,
      endpointId: "read",
      slots: policy.slots!,
      room: policy.slots!,
      ...admitted.leases,
    };
    const before = structuredClone(state.inFlight);
    expect(reacquire(state, capacity)).toBeNull();
    expect(state.inFlight).toEqual(before);
    expect(state.buckets).toEqual(buckets);
    releaseAdmission(state, admitted.leases.request);
    releaseAdmission(state, admitted.leases.thread);
    const restored = reacquire(state, capacity)!;
    expect(restored).toEqual(admitted.leases);
    expect(state.buckets).toEqual(buckets);
    for (const key of [
      slotsKey("caller"),
      concurrencyKey("caller", ["endpoint", "read"]),
      sharedConcurrencyKey("account"),
    ])
      expect(state.inFlight.get(key)).toBe(1);
    // An off-thread continuation needs a slot, while its request still owns shared/endpoint capacity.
    releaseAdmission(state, restored.thread);
    const continuation = reacquire(state, {
      ...capacity,
      request: undefined,
      thread: { ...restored.thread, keys: [] },
    });
    expect(continuation?.thread.keys).toEqual([slotsKey("caller")]);
    expect(state.inFlight.get(sharedConcurrencyKey("account"))).toBe(1);
    expect(state.buckets).toEqual(buckets);
  },
);

it.each(["node", "endpoint", "shared"])("recovery resizes to a reduced %s cap without spending quota", (scope) => {
  const state = emptyAdmission();
  const policy: AdmissionPolicy = {
    slots: 4,
    api: {
      maxInFlight: 4,
      quotas: [{ id: "spent", unit: "requests", amount: 4, windowMs: 10000, algorithm: "token-bucket" }],
      ...(scope === "shared" ? { sharedConcurrency: "account" } : {}),
    },
    endpoints: [{ id: "read", method: "GET", path: "/", behaviour: { maxInFlight: 4 } }],
  };
  reconfigureAdmission(state, [{ id: "caller", policy }], undefined, 0);
  const admitted = attemptAdmission(state, "caller", policy, "read", undefined, 0, 4, 4, [], true);
  if ("rejected" in admitted) throw new Error(admitted.rejected);
  releaseAdmission(state, admitted.leases.request);
  releaseAdmission(state, admitted.leases.thread);
  const smaller: AdmissionPolicy = {
    ...policy,
    api: { ...policy.api, maxInFlight: scope === "node" ? 1 : 4 },
    ...(scope === "shared" ? { accountConcurrency: 1 } : {}),
    endpoints: [{ ...policy.endpoints[0], behaviour: { maxInFlight: scope === "endpoint" ? 1 : 4 } }],
  };
  reconfigureAdmission(state, [{ id: "caller", policy: smaller }], undefined, 0);
  const buckets = structuredClone(state.buckets);
  const restored = reacquire(state, {
    node: "caller",
    policy: smaller,
    endpointId: "read",
    slots: 4,
    room: 4,
    ...admitted.leases,
  });
  expect(restored?.request).toMatchObject({ represented: 4, weight: 1 });
  expect(restored?.thread).toMatchObject({ represented: 4, weight: 1 });
  expect(state.buckets).toEqual(buckets);
});

it("recovery enforces limits added while caller is down atomically without changing quota credit", () => {
  const state = emptyAdmission();
  const policy: AdmissionPolicy = {
    slots: 4,
    api: { quotas: [{ id: "spent", unit: "requests", amount: 1, windowMs: 10000, algorithm: "token-bucket" }] },
    endpoints: [],
  };
  const sibling: AdmissionPolicy = { slots: 1, api: { sharedConcurrency: "account", maxInFlight: 1 }, endpoints: [] };
  reconfigureAdmission(
    state,
    [
      { id: "caller", policy },
      { id: "sibling", policy: sibling },
    ],
    undefined,
    0,
  );
  const admitted = attemptAdmission(state, "caller", policy, undefined, undefined, 0, 1);
  if ("rejected" in admitted) throw new Error(admitted.rejected);
  releaseAdmission(state, admitted.leases.request);
  releaseAdmission(state, admitted.leases.thread);
  const occupied = attemptAdmission(state, "sibling", sibling, undefined, undefined, 0, 1);
  if ("rejected" in occupied) throw new Error(occupied.rejected);
  const updated: AdmissionPolicy = {
    ...policy,
    api: { ...policy.api, sharedConcurrency: "account" },
    endpoints: [{ id: "read", method: "GET", path: "/", behaviour: { maxInFlight: 1 } }],
  };
  reconfigureAdmission(state, [{ id: "caller", policy: updated }], undefined, 0);
  const capacity = { node: "caller", policy: updated, endpointId: "read", slots: 4, room: 4, ...admitted.leases };
  const buckets = structuredClone(state.buckets);
  const before = structuredClone(state.inFlight);
  expect(reacquire(state, capacity)).toBeNull();
  expect(state.inFlight).toEqual(before);
  expect(state.buckets).toEqual(buckets);
  releaseAdmission(state, occupied.leases.request);
  releaseAdmission(state, occupied.leases.thread);
  const restored = reacquire(state, capacity)!;
  expect(restored.request?.keys).toContain(sharedConcurrencyKey("account"));
  expect(restored.request?.keys).toContain(concurrencyKey("caller", ["endpoint", "read"]));
  expect(state.buckets).toEqual(buckets);
  releaseAdmission(state, restored.request);
  releaseAdmission(state, restored.thread);
  expect([...state.inFlight.values()].every((n) => n === 0)).toBe(true);
});

it.each(["endpoint", "shared"])("the per-tick oracle detects overbooked %s capacity", (scope) => {
  const key = scope === "shared" ? sharedConcurrencyKey("account") : concurrencyKey("caller", ["endpoint", "read"]);
  expect(() =>
    assertResourceInvariants({
      time: 10,
      scale: 1,
      capacityMultiplier: 1,
      partBudget: createCpuPartBudget(),
      nodes: [],
      admission: { inFlight: new Map([[key, 2]]), limits: new Map([[key, 1]]), leases: [{ keys: [key], weight: 2 }] },
    }),
  ).toThrow("capacity exceeded");
});

it("the per-tick oracle requires admission occupancy to equal live leases", () => {
  const key = slotsKey("caller");
  expect(() =>
    assertResourceInvariants({
      time: 10,
      scale: 1,
      capacityMultiplier: 1,
      partBudget: createCpuPartBudget(),
      nodes: [],
      admission: { inFlight: new Map([[key, 0]]), limits: new Map([[key, 1]]), leases: [{ keys: [key], weight: 1 }] },
    }),
  ).toThrow("lease occupancy disagrees");
});

it("the oracle permits retained excess but detects a new allocation above the reduced cap", () => {
  const key = concurrencyKey("caller", ["node"]);
  const state = {
    time: 10,
    admission: {
      inFlight: new Map([[key, 3]]),
      limits: new Map([[key, 1]]),
      retainedExcess: new Map([[key, 2]]),
      leases: [{ keys: [key], weight: 3 }],
    },
    scale: 1,
    capacityMultiplier: 1,
    partBudget: createCpuPartBudget(),
    nodes: [],
  };
  expect(() => assertResourceInvariants(state)).not.toThrow();
  state.admission.inFlight.set(key, 4);
  state.admission.leases.push({ keys: [key], weight: 1 });
  expect(() => assertResourceInvariants(state)).toThrow("capacity exceeded");
});
