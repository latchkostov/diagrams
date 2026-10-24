import { autoScale } from "../sim/scale";
import { hpaLesson, resourceLesson } from "../model/autoscalingLessons";
import blockingExample from "../examples/blocking-call.json";
import busyExample from "../examples/scale-on-busy-threads.json";
import { planScaling } from "../sim/scalingPlanner";
import type { DiagramFile } from "../model/types";
import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { upgradeWaits, legacyExport } from "./migration";
import { analyzeCapacity } from "../sim/capacity";
import { validateDiagram } from "../interop/native";
import { makePayload, parsePayload } from "../editor/clipboard";

it.each([undefined, "p1", "p2", "p3", "p3-a1"] as const)(
  "previews and upgrades %s without mutating the previous document",
  (revision) => {
    const d = waitingFixture();
    d.planning = revision ? { revision } : undefined;
    d.format = revision ? "diagrams/v2" : "diagrams/v1";
    d.simulations = [{ id: "saved", title: "Saved", traffic: [], setup: { props: { caller: { concurrency: 8 } } } }];
    const before = structuredClone(d);
    const next = upgradeWaits(d);
    expect(d).toEqual(before);
    expect(next.planning?.revision).toBe("p3-w1");
    expect(validateDiagram(next).ok).toBe(true);
    expect(next.simulations).toEqual(d.simulations);
    expect(analyzeCapacity(next).nodes.caller.waits?.threadHoldMs).toBe(260);
    expect(analyzeCapacity(d).nodes.caller.waits).toBeUndefined();
    expect(legacyExport(next).losses).toContain("requests hold caller threads");
  },
);

it("keeps caller settings through clipboard v2 while older target models leave them dormant", () => {
  const d = waitingFixture();
  d.edges[1].props!.caller = { deadlineMs: 1000, poolConnections: 4 };
  const fragment = parsePayload(JSON.stringify(makePayload(d, ["caller", "partner"])));
  expect(fragment?.format).toBe("diagrams/clip-v2");
  expect(fragment?.edges[0].props?.caller).toEqual(d.edges[1].props!.caller);
});

it("computes hold time over a shared diamond and refuses a finite ceiling for loops", () => {
  const d = waitingFixture();
  d.nodes.push({ ...d.nodes[1], id: "other" });
  d.edges.push(
    { id: "fan", from: "caller", to: "other", kind: "sync" },
    { id: "join", from: "other", to: "partner", kind: "sync" },
  );
  expect(analyzeCapacity(d).nodes.caller.waits?.threadHoldMs).toBe(270);
  d.edges.push({ id: "loop", from: "other", to: "caller", kind: "sync" });
  expect(analyzeCapacity(d).converged).toBe(false);
  expect(analyzeCapacity(d).nodes.caller.capacity).toBe(0);
});

it("does not recommend lowering a CPU target to chase a held-thread bottleneck", () => {
  const plans = planScaling(blockingExample as DiagramFile);
  expect(plans.flatMap((p) => p.suggestions).some((s) => s.node === "caller" && s.kind === "target")).toBe(false);
});

it("verifies busy-thread scaling for a waiting majority, within the scenario horizon", () => {
  const plan = planScaling(busyExample as DiagramFile).find((p) => p.simulation === "blocking")!;
  expect(plan.suggestions).toHaveLength(1);
  expect(plan.suggestions[0]).toMatchObject({ kind: "busyThreads", verified: { endBacklog: 0 } });
  expect(plan.suggestions[0].fix?.[0].props).toMatchObject({
    autoscaling: { controller: { settings: { metrics: [{ source: { kind: "pods", metric: "busyThreads" } }] } } },
  });
  // The old twenty-second lesson ends exactly when a first new pod would become ready.
  expect(planScaling(blockingExample as DiagramFile)[0]).toMatchObject({ runs: 1, suggestions: [] });
});

it("does not verify scaling that only moves backlog into pool waiting", () => {
  const d = structuredClone(busyExample) as DiagramFile;
  const caller = d.nodes.find((n) => n.id === "caller")!;
  (caller.props!.resources as ReturnType<typeof resourceLesson>).cpuMsPerMessage = 1;
  d.nodes.find((n) => n.id === "partner")!.props!.jitter = 0;
  d.edges.find((e) => e.id === "call")!.props!.caller = { wait: "blocking", poolConnections: 1 };
  d.simulations = [d.simulations![0]];
  d.simulations[0].scale = 1;
  d.simulations[0].durationMs = 30000;
  d.simulations[0].traffic[0].shape = { kind: "constant", ratePerSec: 400, durationMs: 30000 };
  const plan = planScaling(d)[0];
  expect(plan.suggestions.filter((s) => s.kind === "busyThreads")).toEqual([]);
});

it("uses the called endpoint's duration in the hold-time ceiling", () => {
  const d = waitingFixture();
  d.nodes[2].props!.endpoints = [{ id: "score", method: "POST", path: "/score", behaviour: { latencyMs: 500 } }];
  d.edges[1].props!.endpointId = "score";
  expect(analyzeCapacity(d).nodes.caller.waits?.threadHoldMs).toBe(510);
});

it("keeps four sampled dots in the actual initial caller pool, including an HPA fleet", () => {
  const d = waitingFixture();
  d.nodes[0].props = { ratePerSec: 4000 };
  d.nodes[1].props = { ...d.nodes[1].props, replicas: 8, resources: resourceLesson(), autoscaling: hpaLesson() };
  const sim = { id: "auto", title: "Auto", traffic: [] };
  expect(autoScale(sim, d)).toBe(1);
  d.planning!.revision = "p3-a1";
  expect(autoScale(sim, d)).toBeGreaterThan(1);
});
