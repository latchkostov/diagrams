import { describe, expect, it, vi } from "vitest";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import type { DiagramFile } from "../model/types";
import type { ApiBehaviour, Quota } from "../model/admission";
import { localRateQuota } from "../model/admissionPresets";
import { resolveNodeProps } from "./defaults";
import { analyzeCapacity } from "./capacity";
import { sizingFix } from "./capacityPlanning";
import { attemptAdmission, emptyAdmission, configureAdmission } from "./admission";
import { validateDiagram } from "../interop/native";
import { buildJourney } from "../trace/journey";
import { explainNode } from "../planning/explanation";
import { explanationSimulation } from "../planning/explanation";
import { admissionCapacities } from "./admissionPlanning";
import { capacityView } from "../live/capacityModel";

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
describe("P3 managed admission", () => {
  it("planning and admission share an endpoint allocation without charging its parent twice", () => {
    const policy = {
      api: { sharedConcurrency: "account" },
      endpoints: [{ id: "get", method: "GET" as const, path: "/", behaviour: { sharedConcurrency: "account" } }],
    };
    const planning = { revision: "p3" as const, sharedAllocations: [{ id: "account", maxInFlight: 2 }] };
    expect(
      admissionCapacities(
        [{ id: "api", policy, offered: 10, latencyMs: 1000, endpoints: [{ id: "get", rate: 10 }] }],
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
      behaviour: { quotas: [q(2)] },
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
    expect(e.snapshot().nodes.api.rejectionReasons).toEqual({ "rate: requests": 2 });
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
    expect(resolveNodeProps(d, d.nodes[0]).admission?.slots).toBe(2);
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
    expect(attemptAdmission(state, "a", policy, undefined, undefined, 0, 2)).toHaveProperty("lease");
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
