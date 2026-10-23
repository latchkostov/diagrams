import fc from "fast-check";
import { expect, it } from "vitest";
import { arbResilienceDiagram } from "../test/resilienceScenarios";
import { propertyRuns } from "../test/fastCheck";
import type { DiagramFile } from "../model/types";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import type { EdgeSimProps, NodeSimProps } from "./types";
import { createEngine } from "./engine";
import { backoffDelay } from "./retryPolicy";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";

/** A serial upper bound for this generator's finite DAG, not a fixed request lifetime.
 * Count every retry's surviving downstream work, even after its parent times out.
 * Serializing all real messages also covers one-slot pools/shared admission and sampling waves. */
function recoveryWorkMs(diagram: DiagramFile, scale: number): number {
  const work = (id: string): number => {
    const props = diagram.nodes.find((n) => n.id === id)?.props as NodeSimProps | undefined;
    const resources = props?.resources;
    const cpuRate = resources
      ? Math.min(1, (resources.cpuLimitMilli ?? resources.availableCpuMilli ?? 1000) / 1000)
      : 1;
    let ms =
      1000 +
      (props?.latencyMs ?? 250) +
      (props?.api?.latencyMs ?? 0) +
      (props?.retryBackoffMs ?? 1000) +
      (resources?.cpuMsPerMessage ?? 0) / cpuRate +
      (resources?.terminationGraceMs ?? 0);
    for (const edge of diagram.edges.filter((edge) => edge.from === id)) {
      const p = edge.props as EdgeSimProps | undefined;
      const retry = p?.caller?.retry;
      const attempts = retry?.maxAttempts ?? 1;
      ms +=
        attempts *
        (1000 +
          (p?.travelMs ?? 300) * 2 +
          (p?.networkDelayMs ?? 0) * 2 +
          (p?.caller?.replyMs ?? 0) +
          (p?.caller?.deadlineMs ?? 0) +
          work(edge.to));
      if (retry) for (let k = 1; k < attempts; k++) ms += backoffDelay(retry, k);
    }
    return ms;
  };
  const deliveries = Number(diagram.nodes.find((n) => n.id === "source")?.props?.maxDeliveryCount ?? 1);
  // Four sampled roots represent 4*scale real messages; each slot wave stretches by at most scale.
  return 4 * Math.max(1, scale) ** 2 * deliveries * work("source");
}

function recover(e: ReturnType<typeof createEngine>, tiers: readonly string[], diagram: DiagramFile, scale: number) {
  for (const id of tiers) {
    e.setNodeStatus(id, "up");
    e.setNodeProps(id, { failureRate: 0 });
  }
  const steps = Math.ceil(recoveryWorkMs(diagram, scale) / 1000);
  for (let i = 0; i < steps && e.metrics().inSystem; i++) e.step(1000);
  expect(e.metrics().inSystem).toBe(0);
}

it("drains surviving nested retries using their finite work bound", () => {
  // Reduced from sweep seed -1421313886: timeout does not cancel downstream work.
  const diagram = waitingFixture();
  diagram.planning!.revision = "p3-w2";
  diagram.nodes[0].stencil = "generic.queue";
  diagram.nodes[0].props = { maxDeliveryCount: 3 };
  const prototype = diagram.nodes[1];
  const tiers = ["tier0", "tier1", "tier2"];
  diagram.nodes = [
    diagram.nodes[0],
    ...tiers.map((id, i) => ({
      ...prototype,
      id,
      props: { concurrency: 1, replicas: 1, latencyMs: i === 2 ? 61 : 0, jitter: 0 },
    })),
    { ...diagram.nodes[2], id: "side", props: { api: { latencyMs: 20 }, jitter: 0 } },
    diagram.nodes[3],
    {
      ...prototype,
      id: "standalone",
      props: {
        replicas: 1,
        concurrency: 1,
        latencyMs: 10,
        jitter: 0,
        retry: "inplace",
        retryBackoffMs: 100,
        resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
      },
    },
  ];
  diagram.edges = [
    { id: "input", from: "source", to: "tier0", props: { travelMs: 10 } },
    ...tiers.slice(0, -1).map((from, i) => ({
      id: `call${i}`,
      from,
      to: tiers[i + 1],
      kind: "sync" as const,
      props: {
        travelMs: 10,
        networkDelayMs: 10,
        caller: {
          poolConnections: 1,
          wait: "blocking",
          replyMs: 0,
          deadlineMs: 100,
          retry: {
            maxAttempts: 10,
            backoffMs: 73,
            strategy: "exponential",
            jitter: 0,
            retryOn: ["throttled", "transient", "timeout"],
          },
        },
      },
    })),
    { id: "standalone-input", from: "source", to: "standalone", props: { travelMs: 10 } },
    { id: "output", from: "tier0", to: "result", props: { travelMs: 10 } },
  ];
  const e = createEngine({ seed: 7, scale: 3, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(diagram);
  e.inject("source", 4);
  e.step(500);
  e.setNodeStatus("side", "down");
  e.step(1000);
  e.setNodeStatus("side", "up");
  e.step(30000);
  recover(e, tiers, diagram, 3);
});

it("R1–R3, R5, R6 survive sampled branches, budgets, pools, failures, outage and checkpoint replay", () => {
  fc.assert(
    fc.property(arbResilienceDiagram, ({ diagram, scale }) => {
      const tiers = diagram.nodes.filter((n) => n.id.startsWith("tier")).map((n) => n.id);
      const e = createEngine({
        seed: 7,
        scale,
        maxParticles: 0,
        verifyResilience: assertResilienceInvariants,
        verifyLedger: assertLedgerInvariants,
      });
      e.load(diagram);
      e.inject("source", 4);
      e.step(500);
      const cp = e.checkpoint();
      const advance = () => {
        e.setNodeStatus("side", "down");
        e.step(1000);
        e.setNodeStatus("side", "up");
        e.step(30000);
        recover(e, tiers, diagram, scale);
        return e.snapshot();
      };
      const expected = advance();
      e.restore(cp);
      expect(advance()).toEqual(expected);
      expect(e.snapshot().edges).toEqual(expected.edges);
      expect(e.snapshot().inSystem).toBe(0);
    }),
    { numRuns: propertyRuns(30) },
  );
});

const transition = fc.record({
  tier: fc.nat({ max: 3 }),
  status: fc.constantFrom("paused" as const, "down" as const, "up" as const, "shrink" as const),
  ticks: fc.integer({ min: 1, max: 40 }),
});

it("every reply is classified by its own attempt across pause, outage, drain and replay, under selective policies", () => {
  fc.assert(
    fc.property(
      arbResilienceDiagram,
      fc.subarray(["throttled", "transient", "timeout"] as const, { minLength: 1 }),
      fc.array(transition, { maxLength: 8 }),
      ({ diagram, scale }, retryOn, transitions) => {
        for (const edge of diagram.edges) {
          const caller = edge.props?.caller as import("./types").EdgeSimProps["caller"];
          if (caller?.retry) caller.retry = { ...caller.retry, retryOn: [...retryOn] };
        }
        const tiers = diagram.nodes.filter((n) => n.id.startsWith("tier")).map((n) => n.id);
        // verifyResilience also makes a reply that disagrees with its attempt's cause throw.
        const e = createEngine({
          seed: 7,
          scale,
          maxParticles: 0,
          verifyResilience: assertResilienceInvariants,
          verifyLedger: assertLedgerInvariants,
          verifyOutcomes: assertOutcomeInvariants,
        });
        const apply = (from: number, to: number) => {
          for (const { tier, status, ticks } of transitions.slice(from, to)) {
            const id = tiers[tier % tiers.length];
            if (status === "shrink") e.setNodeProps(id, { replicas: 1 });
            else e.setNodeStatus(id, status);
            e.step(ticks * 10);
          }
        };
        const finish = () => {
          apply(half, transitions.length);
          recover(e, tiers, diagram, scale);
          return e.snapshot();
        };
        const half = transitions.length >> 1;
        e.load(diagram);
        e.inject("source", 4);
        apply(0, half);
        const cp = e.checkpoint();
        const expected = finish();
        e.restore(cp);
        expect(finish()).toEqual(expected);
      },
    ),
    { numRuns: propertyRuns(20) },
  );
});

it("a generated healthy callee eventually closes after its fault clears", () => {
  fc.assert(
    fc.property(fc.double({ min: 1.001, max: 10, noNaN: true }), fc.integer({ min: 1, max: 12 }), (scale, probes) => {
      const d = waitingFixture();
      d.planning!.revision = "p3-w2";
      d.nodes[2].stencil = "generic.service";
      d.nodes[2].props = { replicas: 1, concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
      d.edges[1].props = { travelMs: 10, caller: { deadlineMs: 200, poolConnections: 1 } };
      (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).breaker = {
        minimumCalls: 1,
        openMs: 1000,
        halfOpenCalls: probes,
      };
      const e = createEngine({ seed: 7, scale, verifyResilience: assertResilienceInvariants });
      e.load(d);
      e.inject("source", 4);
      e.step(1000);
      expect(e.snapshot().edges.call.breaker?.state).toBe("open");
      e.setNodeProps("partner", { failureRate: 0 });
      for (let i = 0; i <= probes; i++) {
        e.inject("source", 1);
        e.step(1000);
      }
      expect(e.snapshot().edges.call.breaker?.state).toBe("closed");
    }),
    { numRuns: propertyRuns(30) },
  );
});
