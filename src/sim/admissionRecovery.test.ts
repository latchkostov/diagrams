import { expect, it } from "vitest";
import {
  attemptAdmission,
  configureAdmission,
  emptyAdmission,
  reacquire,
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
