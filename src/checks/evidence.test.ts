import { describe, expect, it } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { collectEvidence, EVIDENCE_LIMITS, gatherEvidence, type Evidence } from "./evidence";
import { evidenceText, withEvidence } from "./evidenceMerge";
import { EvidenceStopped, playSimulations } from "./evidenceClient";
import { runChecks } from "./run";

// Run simulations (docs/research/architecture-checks.md, batch 5): the saved simulations played headless, their
// losses counted onto the findings they bear out, `dropped` for the rest, and what a simulation loses on purpose
// set apart. Bounded (60 s simulated each, a wall-clock budget) and deterministic.

const burst = (node: string, count: number, extra: Partial<Simulation> = {}): Simulation => ({
  id: "s",
  title: "Poison batch",
  seed: 7,
  traffic: [{ id: "t", node, shape: { kind: "burst", count, spreadMs: 1000 } }],
  ...extra,
});

/** A shop sending orders through a queue to a worker; the simulation makes the worker fail every one. */
const queued = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "Queued",
  nodes: [
    { id: "shop", stencil: "client.browser", label: "Shop", x: 0, y: 0 },
    { id: "q", stencil: "azure.service-bus.queue", label: "orders", x: 300, y: 0, props: { maxDeliveryCount: 2 } },
    { id: "worker", stencil: "service.dotnet", label: "Ledger worker", x: 600, y: 0 },
  ],
  edges: [
    { id: "e1", from: "shop", to: "q", kind: "async" },
    { id: "e2", from: "q", to: "worker", kind: "async" },
  ],
  // A queue that keeps its dead letters never empties: the duration ends it (as saved quarantine stories do).
  simulations: [burst("shop", 20, { setup: { props: { worker: { failureRate: 1 } } }, durationMs: 30_000 })],
  ...extra,
});

/** A browser calling an API that fails some requests itself (no broker in front to redeliver them). */
const flaky = (sim: Partial<Simulation> = {}, failureRate = 0.5): DiagramFile => ({
  format: "diagrams/v1",
  title: "Flaky",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "api", stencil: "service.node", label: "Payments API", x: 300, y: 0, props: { failureRate } },
    { id: "db", stencil: "postgres", label: "Ledger", x: 600, y: 0 },
  ],
  edges: [
    { id: "e1", from: "web", to: "api", kind: "sync" },
    { id: "e2", from: "api", to: "db", kind: "sync" },
  ],
  simulations: [{ ...burst("web", 40), title: "Checkout rush", ...sim }],
});

describe("simulation evidence", () => {
  it("puts the losses on the finding they bear out", () => {
    const d = queued();
    expect(runChecks(d).findings.map((f) => `${f.severity} ${f.id}`)).toEqual(["warning dead-letter:q"]);
    const ev = collectEvidence(d);
    expect(ev.played).toEqual([{ id: "s", title: "Poison batch", playedMs: expect.any(Number), capped: false }]);
    expect(ev.byFinding).toEqual({ "dead-letter:q": [{ simulation: "Poison batch", what: "dropped", count: 20 }] });
    expect(ev.findings).toEqual([]);
    expect(ev.planned).toEqual([]);
    expect(evidenceText(ev.byFinding["dead-letter:q"][0])).toBe("20 dropped in “Poison batch”");
  });

  it("is deterministic: the same diagram gives the same counts, however the work is sliced", () => {
    const d = flaky();
    const first = collectEvidence(d);
    expect(first.findings.map((f) => f.id)).toEqual(["dropped:api"]);
    expect(collectEvidence(structuredClone(d))).toEqual(first);
    expect(collectEvidence(d, { sliceSteps: 1 })).toEqual(first);
    expect(collectEvidence(d, { sliceSteps: 7 })).toEqual(first);
  });

  it("raises `dropped` where requests fail with nothing to deliver them again", () => {
    const ev = collectEvidence(flaky());
    const [f] = ev.findings;
    expect(f).toMatchObject({
      id: "dropped:api",
      rule: "dropped",
      severity: "suggestion",
      target: "api",
      elements: ["api"],
      title: "Failed requests to Payments API are lost",
    });
    expect(f.fix).toBeUndefined();
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence![0]).toMatchObject({ simulation: "Checkout rush", what: "dropped" });
    // About half of 40 fail, from the seed.
    expect(f.evidence![0].count).toBeGreaterThan(10);
    expect(f.evidence![0].count).toBeLessThan(30);
  });

  it("raises `dropped` at a broker that loses messages no static finding explains, with the dead-letter fix", () => {
    // A topic whose consumer retries in place while a simulation takes it down: no failure rate anywhere, so the
    // static check is quiet, but the deliveries in flight run out and are lost.
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "In place",
      nodes: [
        { id: "shop", stencil: "client.browser", label: "Shop", x: 0, y: 0 },
        { id: "topic", stencil: "kafka.topic", label: "orders", x: 300, y: 0 },
        {
          id: "pay",
          stencil: "service.go",
          label: "Payments",
          x: 600,
          y: 0,
          props: { retry: "inplace", retryBackoffMs: 500, concurrency: 8 },
        },
      ],
      edges: [
        { id: "e1", from: "shop", to: "topic", kind: "async" },
        { id: "e2", from: "topic", to: "pay", kind: "async" },
      ],
      simulations: [
        {
          id: "outage",
          title: "Payments goes down",
          seed: 3,
          traffic: [{ id: "t", node: "shop", shape: { kind: "constant", ratePerSec: 40, durationMs: 4000 } }],
          timeline: [
            { atMs: 2000, action: { do: "status", node: "pay", status: "down" } },
            { atMs: 8000, action: { do: "status", node: "pay", status: "up" } },
          ],
        },
      ],
    };
    expect(runChecks(d).findings).toEqual([]);
    const ev = collectEvidence(d);
    expect(ev.findings.map((f) => f.id)).toEqual(["dropped:topic"]);
    const [f] = ev.findings;
    expect(f.title).toBe("Messages are lost at orders");
    // It names the consumer that failed, not every consumer of the topic.
    expect(f.message).toBe(
      "Messages Payments kept failing ran out of deliveries and were lost: orders has no dead-letter queue.",
    );
    expect(f.elements).toEqual(["topic", "pay"]);
    expect(f.fix?.label).toBe("Add dead-letter queue");
    expect(f.evidence![0].count).toBeGreaterThan(0);
    // The node the simulation takes down drops nothing itself: deliveries wait at the topic.
    expect(ev.planned).toEqual([]);
  });

  it("counts what an outage of the only way through loses on its single-point finding", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "One way through",
      nodes: [
        { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
        { id: "api", stencil: "service.node", label: "Orders API", x: 300, y: 0, props: { replicas: 1 } },
        { id: "db", stencil: "postgres", label: "Orders DB", x: 600, y: 0 },
      ],
      edges: [
        { id: "e1", from: "web", to: "api", kind: "sync" },
        { id: "e2", from: "api", to: "db", kind: "sync" },
      ],
      simulations: [
        {
          id: "o",
          title: "Orders API goes down",
          seed: 1,
          traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 20, durationMs: 4000 } }],
          timeline: [
            { atMs: 1000, action: { do: "status", node: "api", status: "down" } },
            { atMs: 2000, action: { do: "status", node: "api", status: "up" } },
          ],
        },
      ],
    };
    expect(runChecks(d).findings.map((f) => f.id)).toEqual(["single-point:api"]);
    const ev = collectEvidence(d);
    // On purpose (the simulation takes it down), and still the finding's point: what one replica costs.
    expect(ev.byFinding["single-point:api"]).toEqual([
      { simulation: "Orders API goes down", what: "dropped", count: expect.any(Number) },
    ]);
    expect(ev.byFinding["single-point:api"][0].count).toBeGreaterThan(10);
    expect(ev.planned).toEqual([]);
    expect(ev.findings).toEqual([]);
  });

  describe("losses a simulation causes on purpose are planned, never findings", () => {
    it("at a node it takes down", () => {
      const d = flaky(
        {
          timeline: [
            { atMs: 200, action: { do: "status", node: "api", status: "down" } },
            { atMs: 900, action: { do: "status", node: "api", status: "up" } },
          ],
        },
        0,
      );
      const ev = collectEvidence(d);
      expect(ev.findings).toEqual([]);
      expect(ev.byFinding).toEqual({});
      expect(ev.planned).toEqual([
        { node: "api", simulation: "Checkout rush", what: "dropped", count: expect.any(Number), why: "down" },
      ]);
      expect(ev.planned[0].count).toBeGreaterThan(0);
    });

    it("but not where it also expects nothing lost: then the loss is news", () => {
      const d = flaky(
        {
          timeline: [
            { atMs: 200, action: { do: "status", node: "api", status: "down" } },
            { atMs: 900, action: { do: "status", node: "api", status: "up" } },
          ],
          expectations: [
            { id: "n", label: "No request lost", metric: { node: "api", field: "dropped" }, op: "==", value: 0 },
          ],
        },
        0,
      );
      const ev = collectEvidence(d);
      expect(ev.planned).toEqual([]);
      expect(ev.findings.map((f) => f.id)).toEqual(["dropped:api"]);
    });

    it("at a node it makes fail", () => {
      const d = flaky({ setup: { props: { api: { failureRate: 0.5 } } } }, 0);
      expect(collectEvidence(d).planned.map((p) => p.why)).toEqual(["fails"]);
    });

    it("where its own expectations count on a loss, but not where they expect none", () => {
      const expecting = (op: "==" | ">", value: number) =>
        flaky({
          expectations: [{ id: "x", label: "x", metric: { node: "api", field: "dropped" }, op, value }],
        });
      expect(collectEvidence(expecting(">", 0)).planned.map((p) => p.why)).toEqual(["expected"]);
      // "Nothing is lost", and something was: that's evidence, not the story.
      const none = collectEvidence(expecting("==", 0));
      expect(none.planned).toEqual([]);
      expect(none.findings.map((f) => f.id)).toEqual(["dropped:api"]);
    });

    it("dead letters a simulation expects to keep aren't counted on `no-reader`", () => {
      const d = queued({
        nodes: [
          ...queued().nodes,
          { id: "dlq", stencil: "azure.service-bus.queue", label: "orders DLQ", x: 300, y: 200 },
        ],
        edges: [...queued().edges, { id: "e3", from: "q", to: "dlq", kind: "async", props: { dlq: true } }],
      });
      expect(runChecks(d).findings.map((f) => f.id)).toEqual(["no-reader:dlq"]);
      expect(collectEvidence(d).byFinding).toEqual({
        "no-reader:dlq": [{ simulation: "Poison batch", what: "unread", count: 20 }],
      });
      const keeps = structuredClone(d);
      keeps.simulations![0].expectations = [
        { id: "k", label: "Kept", metric: { node: "dlq", field: "backlog" }, op: "==", value: 20 },
      ];
      const ev = collectEvidence(keeps);
      expect(ev.byFinding).toEqual({});
      expect(ev.planned).toEqual([
        { node: "dlq", simulation: "Poison batch", what: "unread", count: 20, why: "expected" },
      ]);
    });
  });

  it("caps each simulation at 60 s of simulated time, in 600 steps", () => {
    const d = flaky({
      traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 2, durationMs: 600_000 } }],
    });
    const it = gatherEvidence(d, { sliceSteps: 1 });
    let steps = 0;
    let next = it.next();
    for (; !next.done; next = it.next()) if (next.value.kind === "slice") steps++;
    expect(steps).toBe(EVIDENCE_LIMITS.simulatedMs / EVIDENCE_LIMITS.stepMs);
    expect(next.value.played).toEqual([
      { id: "s", title: "Checkout rush", playedMs: EVIDENCE_LIMITS.simulatedMs, capped: true },
    ]);
    expect(next.value.findings[0].evidence![0].capped).toBe(true);
    expect(evidenceText(next.value.findings[0].evidence![0])).toMatch(/ in the first minute of “Checkout rush”$/);
  });

  it("stops at its wall-clock budget, leaving out what it didn't finish (never half-counted)", () => {
    const d = flaky();
    d.simulations = [
      { ...d.simulations![0], id: "short", title: "Short" },
      {
        ...d.simulations![0],
        id: "long",
        title: "Long",
        traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 2, durationMs: 600_000 } }],
      },
      { ...d.simulations![0], id: "after", title: "After" },
    ];
    // A clock that moves 1 ms each time it's read: about 40 reads finish "Short"; "Long" would need 600.
    let t = 0;
    const ev = collectEvidence(d, { now: () => t++, wallMs: 200, sliceSteps: 1 });
    expect(ev.played.map((p) => p.id)).toEqual(["short"]);
    expect(ev.unplayed).toEqual(["Long", "After"]);
    expect(ev.findings[0].evidence!.map((e) => e.simulation)).toEqual(["Short"]);
  });

  it("is cancelled by not asking for more: nothing runs after the last step taken", () => {
    const d = flaky();
    const it = gatherEvidence(d, { sliceSteps: 1 });
    expect(it.next().value).toEqual({ kind: "simulation", index: 1, total: 1, title: "Checkout rush" });
    expect(it.next().value).toEqual({ kind: "slice" });
    expect(it.return(undefined as never).done).toBe(true);
    expect(it.next().done).toBe(true);
  });

  it("plays nothing for a diagram without saved simulations", () => {
    const d = flaky();
    delete d.simulations;
    expect(collectEvidence(d)).toEqual({ played: [], unplayed: [], byFinding: {}, findings: [], planned: [] });
  });
});

describe("withEvidence", () => {
  const ev = (): Evidence => collectEvidence(flaky());

  it("adds `dropped` after the checks' own findings, and puts counts on theirs", () => {
    const d = queued();
    const merged = withEvidence(runChecks(d), collectEvidence(d), d.checks);
    expect(merged.findings.map((f) => f.id)).toEqual(["dead-letter:q"]);
    expect(merged.findings[0].evidence).toEqual([{ simulation: "Poison batch", what: "dropped", count: 20 }]);
    const f = flaky();
    expect(withEvidence(runChecks(f), ev(), undefined).findings.map((x) => x.id)).toEqual(["dropped:api"]);
  });

  it("honours Ignore here and Turn off this check, as the file has them now", () => {
    const d = flaky();
    const ignored = withEvidence(runChecks(d), ev(), { ignore: [{ rule: "dropped", target: "api" }] });
    expect(ignored.findings).toEqual([]);
    expect(ignored.ignored.map((f) => f.id)).toEqual(["dropped:api"]);
    const off = withEvidence(runChecks(d), ev(), { off: ["dropped"] });
    expect(off.findings).toEqual([]);
    expect(off.ignored).toEqual([]);
  });

  it("raises nothing when the check was off as they played, nor for losses dead-letter was turned off for", () => {
    const d = flaky();
    d.checks = { off: ["dropped"] };
    expect(collectEvidence(d).findings).toEqual([]);
    const q = queued({ checks: { off: ["dead-letter"] } });
    const e = collectEvidence(q);
    expect(e.findings).toEqual([]);
    expect(e.byFinding).toEqual({});
  });

  it("puts counts on an ignored finding too, where Show again finds them", () => {
    const d = queued({ checks: { ignore: [{ rule: "dead-letter", target: "q" }] } });
    const merged = withEvidence(runChecks(d), collectEvidence(d), d.checks);
    expect(merged.findings).toEqual([]);
    expect(merged.ignored[0].evidence?.[0].count).toBe(20);
  });
});

describe("playSimulations (no worker here: the main-thread way, in slices)", () => {
  it("gives what collectEvidence gives, saying which simulation it's on", async () => {
    const d = flaky();
    const progress: string[] = [];
    const run = playSimulations(d, (p) => progress.push(`${p.index}/${p.total} ${p.title}`));
    expect(await run.done).toEqual(collectEvidence(d));
    expect(progress).toEqual(["1/1 Checkout rush"]);
  });

  it("stops at once when cancelled", async () => {
    const d = flaky({
      traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 50, durationMs: 600_000 } }],
    });
    d.simulations!.push({ ...d.simulations![0], id: "two", title: "Two" });
    const progress: string[] = [];
    // Stopped as the first one starts.
    const run = playSimulations(d, (p) => {
      progress.push(p.title);
      run.cancel();
    });
    await expect(run.done).rejects.toBeInstanceOf(EvidenceStopped);
    const seen = progress.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(progress).toHaveLength(seen);
    expect(progress).not.toContain("Two");
  });
});
