import { describe, expect, it, vi } from "vitest";
import { admissionPlan } from "./admissionPlanning";
import * as policy from "./admissionPolicy";
import type { AdmissionPolicy } from "./admission";

describe("planning call normalization", () => {
  it("normalizes each endpoint once across matched actions, including the unaddressed call", () => {
    const endpoints = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, method: "GET" as const, path: `/e${i}` }));
    const api: AdmissionPolicy = { api: { maxInFlight: 100 }, endpoints };
    const workload = [...endpoints.map((e) => e.id), undefined].flatMap((id) =>
      Array.from({ length: 64 }, (_, i) => ({ id, action: `a${i}`, rate: 1 })),
    );
    const normalize = vi.spyOn(policy, "normalizeCall");
    try {
      const result = admissionPlan([
        { id: "first", policy: api, offered: workload.length, latencyMs: 10, endpoints: workload },
        { id: "second", policy: api, offered: 1, latencyMs: 20, endpoints: [{ id: "e0", rate: 1 }] },
      ]);
      expect(normalize).toHaveBeenCalledTimes(endpoints.length + 2);
      expect(result.capacities.get("first")).toBeCloseTo(10_000);
      expect(result.capacities.get("second")).toBeCloseTo(5_000);
    } finally {
      normalize.mockRestore();
    }
  });
});
