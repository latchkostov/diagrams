import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { diagramThumb } from "../lib/thumbnail";
import { examples, getLoadedExample, loadExample } from "./index";
import { exampleMetadata } from "./metadata";
import { labMetadata } from "./labMetadata";
import { validateDiagram } from "../interop/native";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import { analyzeCapacity } from "../sim/capacity";

// Public fixtures only: this shallow glob never descends into local-only examples.
const files = import.meta.glob<DiagramFile>("./*.json", { eager: true, import: "default" });
const publicExamples = examples.filter((e) => !e.localOnly);

describe("example metadata and loading", () => {
  it("covers every public JSON exactly once and keeps eager metadata in sync", () => {
    const slugs = Object.keys(files)
      .map((path) => path.slice(2, -5))
      .sort();
    expect(publicExamples.map((e) => e.slug).sort()).toEqual(slugs);
    expect(Object.keys(exampleMetadata).sort()).toEqual(slugs);
    expect(Object.keys(labMetadata).sort()).toEqual(slugs);
    for (const example of publicExamples) {
      const d = files[`./${example.slug}.json`];
      expect(example).not.toHaveProperty("diagram");
      expect(example.title).toBe(d.title);
      expect(example.description).toBe(d.description);
      expect(example.thumb).toEqual(diagramThumb(d));
      expect(example.theme).toBeTruthy();
      expect(example.summary).toBeTruthy();
      expect(labMetadata[example.slug]).toEqual(
        (d.simulations ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          deadLetter: (s.expectations ?? []).some(
            (x) => "node" in x.metric && x.metric.field === "deadLettered" && (x.op === ">" || x.op === ">="),
          ),
        })),
      );
    }
  });

  it("imports full diagrams only on request, shares pending loads and caches successes", async () => {
    for (const example of publicExamples) {
      expect(getLoadedExample(example.slug)).toBeUndefined();
      const first = loadExample(example.slug);
      expect(loadExample(example.slug)).toBe(first);
      const d = await first;
      expect(d).toEqual(files[`./${example.slug}.json`]);
      expect(getLoadedExample(example.slug)).toBe(d);
      expect(await loadExample(example.slug)).toBe(d);
    }
  });

  it("rejects unknown slugs without poisoning later loads", async () => {
    await expect(loadExample("missing-example")).rejects.toThrow("unavailable");
    await expect(loadExample("missing-example")).rejects.toThrow("unavailable");
    expect((await loadExample(publicExamples[0].slug)).title).toBe(publicExamples[0].title);
  });
});

const showcases = [
  "where-the-time-goes",
  "zone-outage-drill",
  "partitions-vs-subscriptions",
  "shared-api-quotas",
  "serverless-burst-buffer",
  "measured-order-capacity",
  "contoso-dmz",
  "shared-worker-pool",
];
const diagram = (slug: string) => files[`./${slug}.json`];
const freePlay = (slug: string) => {
  const engine = createEngine({ seed: 7 });
  engine.load(diagram(slug));
  engine.setTraffic(true);
  for (let step = 0; step < 800; step++) engine.step(10);
  return engine.snapshot();
};

describe("recent-feature showcases", () => {
  it("shows busy-thread scaling starting within ten seconds and draining on about ten pods", () => {
    const d = diagram("scale-on-busy-threads");
    expect(exampleMetadata["scale-on-busy-threads"].shows).toEqual(
      expect.arrayContaining(["requestsWait", "autoscaling"]),
    );
    const runs = d.simulations!.map((s) => createSimulationRun(d, s));
    for (const run of runs) run.step(10000);
    expect(runs[0].engine.snapshot().nodes.caller.fleet!.desired).toBe(4);
    expect(runs[1].engine.snapshot().nodes.caller.fleet!.desired).toBeGreaterThan(4);
    expect(runs[2].engine.snapshot().nodes.caller.fleet!.desired).toBe(4);
    for (const run of runs) run.step(30000);
    const scaled = runs[1].engine.snapshot();
    expect(scaled.nodes.caller.fleet!.ready).toBe(10);
    expect(scaled.nodes.applications.backlog).toBeLessThan(100);
    expect(runs[2].engine.snapshot().nodes.applications.backlog).toBeLessThan(100);
  });
  it("shows forty payment connections while the DB-only order-status route keeps working", () => {
    const d = diagram("pool-of-40");
    expect(exampleMetadata["pool-of-40"].shows).toContain("requestsWait");
    const runs = d.simulations!.map((s) => createSimulationRun(d, s));
    for (const run of runs) run.step(8000);
    const free = runs[0].engine.snapshot(),
      held = runs[1].engine.snapshot();
    expect(free.edges.pay.calls!.inFlight).toBe(40);
    expect(free.nodes.checkout.threads!.waiting).toBeLessThan(5);
    expect(free.nodes.orders.processed).toBeGreaterThan(100);
    expect(held.nodes.checkout.threads!.waiting).toBeGreaterThan(90);
    expect(free.nodes.orders.processed).toBeGreaterThan(held.nodes.orders.processed);
  });
  it("shows slow payments saturating threads or failing fast with a timeout", () => {
    const d = diagram("slow-payment-provider");
    expect(exampleMetadata["slow-payment-provider"].shows).toContain("requestsWait");
    expect(exampleMetadata["slow-payment-provider"].shows).toContain("faultDrills");
    const [stalled, bounded] = d.simulations!.map((s) => createSimulationRun(d, s));
    stalled.step(8000);
    bounded.step(8000);
    const a = stalled.engine.snapshot(),
      b = bounded.engine.snapshot();
    expect(a.nodes.checkout.threads!.waiting).toBeGreaterThanOrEqual(98);
    expect(a.nodes.checkout.backlog).toBeGreaterThan(100);
    expect(b.nodes.checkout.threads!.waiting).toBeLessThan(80);
    expect(b.nodes.checkout.backlog).toBeLessThan(5);
    expect(b.edges.pay.calls!.timedOut).toBeGreaterThan(100);
    expect(b.edges.pay.calls!.late).toBeGreaterThan(0);
    expect(b.edges.route.calls!.timedOut).toBe(0);
    stalled.step(12000);
    bounded.step(12000);
    expect(stalled.engine.snapshot().edges.route.calls!.timedOut).toBeGreaterThan(0);
    expect(stalled.state().expectations![0].status).toBe("fail");
    expect(bounded.state().expectations!.every((e) => e.status === "pass")).toBe(true);
  });
  it("frees threads within ten seconds and lets CPU scaling answer the spike", () => {
    const d = diagram("blocking-call");
    const run = createSimulationRun(
      d,
      d.simulations!.find((s) => s.id === "free-thread")!,
    );
    run.step(9000);
    const early = run.engine.snapshot();
    expect(early.nodes.caller.threads!.waiting).toBe(0);
    expect(early.edges.call.calls!.inFlight).toBeGreaterThan(80);
    expect(early.nodes.applications.backlog).toBeLessThan(100);
    expect(early.nodes.caller.resources!.cpuRequestPct!).toBeGreaterThan(50);
    run.step(31000);
    const spike = run.engine.snapshot();
    expect(spike.nodes.caller.fleet!.desired).toBeGreaterThan(4);
    expect(spike.nodes.caller.fleet!.ready).toBeGreaterThan(4);
  });
  it("fills caller threads within ten seconds while CPU scaling stays quiet", () => {
    const d = diagram("blocking-call");
    const run = createSimulationRun(d, d.simulations![0]);
    let mostWaiting = 0;
    for (let i = 0; i < 90; i++) {
      run.step(100);
      mostWaiting = Math.max(mostWaiting, run.engine.snapshot().nodes.caller.threads!.waiting);
    }
    const s = run.engine.snapshot();
    expect(mostWaiting).toBeGreaterThan(48);
    expect(s.nodes.applications.backlog).toBeGreaterThan(500);
    expect(s.nodes.caller.fleet).toMatchObject({ ready: 4, desired: 4 });
    expect(s.nodes.caller.resources!.cpuRequestPct!).toBeLessThan(70);
    expect(exampleMetadata["blocking-call"].shows).toContain("requestsWait");
    run.step(11000);
    expect(run.engine.snapshot().nodes.caller.fleet).toMatchObject({ ready: 4, desired: 4 });
  });
  it("shows the Billing spike's sampled latency and 78% waiting within ten seconds", () => {
    const d = diagram("where-the-time-goes");
    const run = createSimulationRun(d, d.simulations![0]);
    run.step(3500);
    expect(run.engine.frame().nodes.billing.latency!.p95).toBe(300);
    run.step(5900);
    const latency = run.engine.frame().nodes.billing.latency!;
    expect(latency.p95).toBeGreaterThanOrEqual(3800);
    expect(latency.p95).toBeLessThan(4300);
    expect(Math.round((100 * latency.waitMs) / (latency.waitMs + latency.workMs + latency.travelMs))).toBe(78);
    expect(latency.samples).toBeGreaterThan(100);
    expect(exampleMetadata["where-the-time-goes"].shows).toContain("latency");
    expect(run.engine.frame().nodes.orders.backlog).toBeGreaterThan(0);
  });
  it("showcases fresh latency windows on a Billing fault and its restoration within nine seconds", () => {
    const d = diagram("where-the-time-goes");
    const simulation = d.simulations!.find((s) => s.id === "slow-billing-drill")!;
    const run = createSimulationRun(d, simulation);
    run.step(2900);
    expect(run.engine.snapshot().nodes.billing.latency!.sinceFault).toBeUndefined();
    run.step(2500);
    expect(run.engine.snapshot().nodes.billing.latency!.sinceFault).toMatchObject({ atMs: 3000, fault: { factor: 5 } });
    run.step(2700);
    expect(run.engine.snapshot().nodes.billing.latency!.sinceFault).toMatchObject({ atMs: 6000, fault: { factor: 1 } });
    expect(exampleMetadata["where-the-time-goes"].shows).toEqual(expect.arrayContaining(["latency", "faultDrills"]));
  });
  it.each(showcases)("%s validates, loads lazily and replays deterministically", async (slug) => {
    const d = await loadExample(slug);
    expect(validateDiagram(d)).toMatchObject({ ok: true });
    for (const simulation of d.simulations ?? []) {
      const replay = () => {
        const run = createSimulationRun(d, simulation);
        for (let step = 0; step < 6000 && !run.state().done; step++) run.step(10);
        expect(run.state().done, simulation.id).toBe(true);
        expect(
          run.state().expectations.map((e) => e.status),
          simulation.id,
        ).toEqual(
          simulation.expectations?.map((e) =>
            slug === "zone-outage-drill" && simulation.id === "no-health-checks" && e.id === "api-b-loss"
              ? "fail"
              : "pass",
          ),
        );
        return run.engine.snapshot();
      };
      expect(replay()).toEqual(replay());
    }
    expect(freePlay(slug)).toEqual(freePlay(slug));
  });

  it("three partitions leave five idle readers while both subscriptions use every replica", () => {
    const s = freePlay("partitions-vs-subscriptions");
    expect(s.nodes["log-readers"]).toMatchObject({ activeReplicas: 3, idleReplicas: 5 });
    expect(s.nodes.receipts).toMatchObject({ activeReplicas: 8, idleReplicas: 0 });
    expect(s.nodes.audit).toMatchObject({ activeReplicas: 8, idleReplicas: 0 });
    expect(s.nodes.log.backlog).toBeGreaterThan(0);
    expect(s.nodes.receipts.processed).toBeGreaterThan(s.nodes["log-readers"].processed);
    expect(s.nodes.receipts.processed).toBe(s.nodes.audit.processed);
  });

  it("the shared token budget rejects before RPM; payments reject independently", () => {
    const s = freePlay("shared-api-quotas");
    for (const id of ["answer", "review", "payments"]) {
      expect(s.nodes[id].processed).toBeGreaterThan(0);
      expect(s.nodes[id].rejected).toBeGreaterThan(0);
      expect(s.nodes[id].failed + s.nodes[id].dropped).toBe(0);
    }
    // One shared bucket, including eight seconds of simulated refill (100 tokens/s).
    expect(s.nodes.answer.processed + s.nodes.review.processed).toBe(Math.floor((6000 + 8 * 100) / 500));
    const reasons = Object.keys(s.nodes.answer.rejectionReasons ?? {}).join(" ");
    expect(reasons).toContain("assistant-tokens");
    expect(reasons).not.toContain("assistant-requests");
  });

  it("direct managed admission rejects excess but fixed queue consumers keep it buffered", () => {
    const s = freePlay("serverless-burst-buffer");
    expect(s.nodes.direct.rejected).toBeGreaterThan(0);
    expect(s.nodes.async.rejected ?? 0).toBe(0);
    expect(s.nodes.queue.backlog).toBeGreaterThan(0);
    expect(s.nodes["async-results"].processed).toBeGreaterThan(0);
  });

  it("measured payment capacity fits today and saturates at three times demand", () => {
    const d = diagram("measured-order-capacity");
    const baseline = analyzeCapacity(d);
    expect(baseline.nodes.intake.capacity).toBe(16);
    expect(baseline.nodes["payment-worker"]).toMatchObject({ offered: 1, capacity: 2, utilization: 0.5 });
    const triple = analyzeCapacity(d, d.simulations?.[1]);
    expect(triple.nodes["payment-worker"]).toMatchObject({ offered: 3, capacity: 2, utilization: 1.5 });
    expect(triple.bottleneck?.id).toBe("payment-worker");
  });

  it("the DMZ carries web requests and counts blocked probes separately", () => {
    const s = freePlay("contoso-dmz");
    expect(s.nodes.database.processed).toBeGreaterThan(0);
    expect(s.nodes.firewall.blocked).toBeGreaterThan(0);
    expect(s.nodes.firewall.failed + s.nodes.firewall.dropped).toBe(0);
    expect(s.nodes.admin.processed).toBe(0);
  });

  it("two inputs offer six events/s to one four-slot pool", () => {
    const d = diagram("shared-worker-pool");
    expect(analyzeCapacity(d).nodes.worker).toMatchObject({ offered: 6, capacity: 4, utilization: 1.5 });
    const s = freePlay("shared-worker-pool");
    expect(s.nodes["order-log"].backlog).toBeGreaterThan(0);
    expect(s.nodes["refund-log"].backlog).toBeGreaterThan(0);
    expect(s.nodes.worker.inFlight).toBeLessThanOrEqual(4);
  });
});
