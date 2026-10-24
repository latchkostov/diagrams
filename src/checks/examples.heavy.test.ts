import { applyOps } from "../ai";
import { upgradePlanning, upgradeAutoscaling } from "../planning/migration";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";
import { collectEvidence } from "./evidence";
import { withEvidence } from "./evidenceMerge";
// The regression snapshot over the public examples (top level only). Each finding here
// was judged in docs/research/architecture-checks.md ("Batch 1: precision gate", "Batch 3: precision gate",
// "Batch 4: precision gate"); a change to this list is a change to those tables. The batch 3 rules (sync-chain,
// shared-database, entry-gateway, single-point) raise nothing on them, by the gate's tightening; of batch 4's,
// secret-identity raises one (notification-fanout) and schema-registry none.

const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
const bySlug = Object.fromEntries(
  Object.entries(examples).map(([path, d]) => [path.replace(/^.*\/|\.json$/g, ""), d] as const),
);

const EXPECTED: Record<string, string[]> = {
  "vendor-edge-storefront": [],
  "retry-storm": ["warning no-reader:orders"],
  "scale-on-busy-threads": [
    "warning blocked-threads:caller",
    "warning scaling-blind:caller",
    "suggestion call-timeout:call",
  ],
  "slow-payment-provider": ["suggestion call-timeout:pay"],
  "blocking-call": ["warning blocked-threads:caller", "warning scaling-blind:caller", "suggestion call-timeout:call"],
  "where-the-time-goes": [],
  "zone-outage-drill": [],
  "recommendations-feature-store": [],
  "video-on-demand-pipeline": [],
  "observability-pipeline": [],
  "hybrid-enterprise-network": [],
  // The KEDA pipeline sleeps at zero in free play (no rate), so nothing is offered to it until a story sends work.
  "autoscaling-basics": [],
  "aks-app-config-key-vault": [],
  "aws-serverless-orders": [],
  "branch-to-datacentre": [],
  "azure-service-bus-integration": [],
  "cdc-analytics": [],
  "cqrs-event-sourcing": [],
  "event-driven-data-platform": [],
  "gcp-streaming-analytics": [],
  "kafka-order-pipeline": [],
  "nightly-batch-elt": [],
  "notification-fanout": [],
  "outbox-saga-checkout": ["suggestion no-reader:payments-dlq"],
  "rag-assistant": [],
  "webhook-ingestion": [],
  "partitions-vs-subscriptions": ["warning capacity:log-readers"],
  "shared-api-quotas": ["warning capacity:answer"],
  "serverless-burst-buffer": ["warning capacity:direct", "suggestion dead-letter:queue"],
  "measured-order-capacity": ["suggestion dead-letter:queue"],
  "contoso-dmz": [],
  "shared-worker-pool": ["warning capacity:worker"],
  "cloud-run-timetable-api": ["warning capacity:worker"],
  // Carrier events reach their service through the route table at 30/s, over its 20/s: on purpose.
  "api-route-table": ["warning capacity:events"],
  // The large showcases: realistic designs that pass every check.
  "black-friday-commerce": [],
  "cell-based-bookings": [],
  "payments-ledger": [],
  "delivery-dispatch": [],
  "ev-charging-network": [],
};

// Every finding a public example ignores, with the reason the file gives: an ignore explains a finding, it
// never hides one silently.
const IGNORED: Record<string, string[]> = {
  "azure-service-bus-integration": [
    "no-reader:dlq: Poison PostInvoice commands are replayed by hand, by an operator, once the cause is fixed",
  ],
};

describe("checks on the public examples", () => {
  it("covers every public example", () => {
    expect(Object.keys(bySlug).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("%s", (slug) => {
    const d = bySlug[slug];
    const result = runChecks(d);
    expect(result.findings.map((f) => `${f.severity} ${f.id}`)).toEqual(EXPECTED[slug]);
    const reasons = new Map((d.checks?.ignore ?? []).map((i) => [`${i.rule}:${i.target}`, i.reason]));
    expect(result.ignored.map((f) => `${f.id}: ${reasons.get(f.id)}`)).toEqual(IGNORED[slug] ?? []);
    // Every fix with ops applies through the ops core and clears its finding.
    for (const f of result.findings.filter((f) => f.fix?.ops)) {
      const applied = applyOps(d, f.fix!.ops!);
      expect(applied.errors, f.id).toEqual([]);
      if (f.rule === "dead-letter") {
        // The route goes to the queue the fix adds, never to an existing node.
        const route = applied.diagram.edges.find((e) => e.from === f.target && e.props?.dlq === true);
        expect(
          d.nodes.some((n) => n.id === route?.to),
          f.id,
        ).toBe(false);
      }
      if (f.scalingPlan?.kind === "busyThreads" || f.fix?.planLabel?.kind === "busyThreads") {
        // Sustained capacity credits the busy-thread fleet up to its maximum.
        const remaining = runChecks(applied.diagram).findings;
        expect(remaining.map((g) => g.id)).toEqual(
          slug === "blocking-call" ? ["capacity:caller", "call-timeout:call"] : ["call-timeout:call"],
        );
        if (slug === "blocking-call") {
          // Its slow 15 s controller still needs warm replicas for the saved run's startup backlog.
          expect(remaining[0]).toMatchObject({ severity: "suggestion", scalingPlan: { kind: "min", to: 6 } });
        }
      } else {
        expect(
          runChecks(applied.diagram).findings.map((g) => g.id),
          f.id,
        ).not.toContain(f.id);
      }
    }
  });
});
it("P3 precision gate adds no findings to the same materialized P2 public examples", () => {
  for (const d of Object.values(bySlug)) {
    if (d.planning?.revision === "p3") continue; // These examples already require managed admission.
    // So do the large p3-a1 showcases with managed APIs and functions; the other p3-a1 examples are still compared.
    if (d.planning?.revision === "p3-a1" && d.nodes.some((n) => n.props?.preset === "managed-measured")) continue;
    const p2 = upgradePlanning(d);
    p2.planning = { revision: "p2" };
    const p3 = upgradePlanning(p2);
    expect(runChecks(p3).findings.map((f) => [f.id, f.severity])).toEqual(
      runChecks(p2).findings.map((f) => [f.id, f.severity]),
    );
  }
});

const PLANNED: Record<string, string[]> = {
  "retry-storm": [
    "21 dropped payments in Three quick retries (fails)",
    "30 dropped payments in Jittered backoff (fails)",
    "30 dropped payments in A retry budget (fails)",
    "30 dropped payments in A circuit breaker (fails)",
    "30 dropped payments in Shed load at Payments (fails)",
  ],
  "slow-payment-provider": [
    "1059 dropped shop in No timeouts (expected)",
    "1059 dropped gateway in No timeouts (expected)",
    "1687 dropped shop in A 600 ms timeout (expected)",
    "1687 dropped gateway in A 600 ms timeout (expected)",
    "1687 dropped checkout in A 600 ms timeout (expected)",
    "1156 dropped shop in Threads freed while waiting for the pool (expected)",
    "1156 dropped gateway in Threads freed while waiting for the pool (expected)",
    "1326 dropped shop in Threads held while waiting for the pool (expected)",
    "1326 dropped gateway in Threads held while waiting for the pool (expected)",
    "1359 dropped shop in Three retries hold threads (expected)",
    "1359 dropped gateway in Three retries hold threads (expected)",
    "791 dropped checkout in Three retries hold threads (expected)",
  ],
  // The canary keeps its 10% of quotes while it's down: an outage the table doesn't hide (on purpose).
  "api-route-table": ["15 dropped pricing-canary in The pricing canary goes down (down)"],
  // Poison invoices quarantines its 30 commands for an operator to replay (the file's ignore says why no reader).
  "azure-service-bus-integration": ["30 unread dlq in Poison invoices (expected)"],
  // The canary's failed rankings are the story; the router's weight change ends them.
  "recommendations-feature-store": ["10 dropped ranker-v8 in The canary misbehaves (fails)"],
  // The fibre cut loses only the requests already on the wire; new sessions go over LTE.
  "hybrid-enterprise-network": ["2 dropped hub in Drill: the Leicester fibre is cut (down)"],
  // A dark region drops what was already on its way there; a bad canary build fails requests in its own cell only.
  "cell-based-bookings": [
    "20 dropped east-alb in us-east-1 goes dark (down)",
    "245 dropped east-c1-api in A bad deploy stays in one cell (fails)",
  ],
};

describe("simulation evidence on the public examples", () => {
  it.each(Object.keys(EXPECTED))("%s", (slug) => {
    const d = bySlug[slug];
    // Semantic completeness must not depend on coverage/CPU contention. Deadline tests inject a moving clock.
    const ev = collectEvidence(d, { now: () => 0 });
    expect(ev.played.map((p) => p.id)).toEqual((d.simulations ?? []).map((s) => s.id));
    expect(ev.played.filter((p) => p.capped)).toEqual([]);
    expect(ev.unplayed).toEqual([]);
    expect(ev.tooBig).toEqual([]);
    const shown = withEvidence(runChecks(d), ev, d.checks);
    // No count on any finding, and no `dropped`: the same findings as the checks' own.
    if (slug === "retry-storm") {
      expect(shown.result.findings.map((f) => f.id)).toEqual(["no-reader:orders", "dropped:shop", "dropped:checkout"]);
      for (const finding of shown.result.findings) {
        expect(finding.evidence).toHaveLength(5);
        expect(finding.evidence!.every((e) => e.count > 0)).toBe(true);
      }
      expect(shown.result.findings.map((f) => f.evidence!.at(-1))).toEqual([
        { simulation: "Shed load at Payments", what: "unread", count: 16413 },
        { simulation: "Shed load at Payments", what: "dropped", count: 1521 },
        { simulation: "Shed load at Payments", what: "dropped", count: 1521 },
      ]);
      expect(shown.counted).toBe(3);
    } else if (slug === "zone-outage-drill") {
      expect(shown.result.findings.map((f) => f.id)).toEqual(["dropped:api-b"]);
      expect(shown.result.findings[0].evidence).toEqual([
        { simulation: "Zone outage: no health checks", what: "dropped", count: 26 },
      ]);
      expect(shown.counted).toBe(1);
    } else {
      expect(shown.result).toEqual(runChecks(d));
      expect(shown.counted).toBe(0);
    }
    expect(shown.planned.map((p) => `${p.count} ${p.what} ${p.node} in ${p.simulation} (${p.why})`)).toEqual(
      PLANNED[slug] ?? [],
    );
  });
});

it("A1 precision gate preserves findings and severities on all 17 public examples", () => {
  for (const d of Object.values(bySlug)) {
    if (d.planning?.revision === "p3-a1") continue; // Already opted in: never downgrade an executing scaler.
    const p3 = upgradePlanning(d),
      a1 = upgradeAutoscaling(p3);
    expect(runChecks(a1).findings.map((f) => [f.id, f.severity])).toEqual(
      runChecks(p3).findings.map((f) => [f.id, f.severity]),
    );
  }
});
