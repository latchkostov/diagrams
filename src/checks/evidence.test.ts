import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { collectEvidence, EVIDENCE_LIMITS, gatherEvidence, startWork, type Evidence } from "./evidence";
import { evidenceText, withEvidence } from "./evidenceMerge";
import { EvidenceStopped, EvidenceUnavailable, MAIN_THREAD_NODES, playSimulations } from "./evidenceClient";
import { buildContext } from "./context";
import { runChecks } from "./run";
import { agentReport } from "./report";

// Run simulations (docs/research/architecture-checks.md, batch 5): the saved simulations played headless, their
// losses counted, then classified against the checks as they are (counts on the findings they bear out, `dropped` for
// the rest, what a simulation meant set apart). Bounded (60 s simulated each, a start-work bound, a wall-clock budget
// read through an injected clock) and deterministic. No millisecond budgets: ticks and slices are counted.

const TICKS_PER_MINUTE = EVIDENCE_LIMITS.simulatedMs / 10;

const burst = (node: string, count: number, extra: Partial<Simulation> = {}): Simulation => ({
  id: "s",
  title: "Poison batch",
  seed: 7,
  traffic: [{ id: "t", node, shape: { kind: "burst", count, spreadMs: 1000 } }],
  ...extra,
});

/** A shop sending orders through a queue to a worker; the simulation makes the worker fail every one. */
const queued = (extra: Partial<DiagramFile> = {}, sim: Partial<Simulation> = {}): DiagramFile => ({
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
  simulations: [burst("shop", 20, { setup: { props: { worker: { failureRate: 1 } } }, durationMs: 30_000, ...sim })],
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

/** What the card shows: the counts classified against the checks as the file has them. */
const shown = (d: DiagramFile, ev: Evidence = collectEvidence(d)) => withEvidence(runChecks(d), ev, d.checks);
const counts = (d: DiagramFile, ev?: Evidence) =>
  Object.fromEntries(
    shown(d, ev)
      .result.findings.filter((f) => f.evidence)
      .map((f) => [f.id, f.evidence!.map((e) => `${e.count} ${e.what} in ${e.simulation}`)]),
  );

describe("simulation evidence", () => {
  it("puts the losses on the finding they bear out", () => {
    const d = queued();
    expect(runChecks(d).findings.map((f) => `${f.severity} ${f.id}`)).toEqual(["warning dead-letter:q"]);
    const ev = collectEvidence(d);
    expect(ev.played).toEqual([{ id: "s", title: "Poison batch", playedMs: expect.any(Number), capped: false }]);
    const s = shown(d, ev);
    expect(s.result.findings[0].evidence).toEqual([{ simulation: "Poison batch", what: "dropped", count: 20 }]);
    expect(s.planned).toEqual([]);
    expect(s.counted).toBe(1);
    expect(evidenceText(s.result.findings[0].evidence![0])).toBe("20 dropped in “Poison batch”");
  });

  it("is deterministic: the same diagram gives the same counts, however the work is sliced", () => {
    const d = flaky();
    const first = collectEvidence(d);
    expect(first.dropped.map((f) => f.id)).toEqual(["dropped:api"]);
    expect(collectEvidence(structuredClone(d))).toEqual(first);
    expect(collectEvidence(d, { sliceTicks: 1 })).toEqual(first);
    expect(collectEvidence(d, { sliceTicks: 7 })).toEqual(first);
  });

  it("raises `dropped` where requests fail with nothing to deliver them again", () => {
    const [f] = shown(flaky()).result.findings;
    expect(f).toMatchObject({
      id: "dropped:api",
      rule: "dropped",
      severity: "suggestion",
      target: "api",
      elements: ["api"],
      title: "Failed requests to Payments API are lost",
    });
    // Run simulations reports what happened and where; it never offers a fix (the static checks do).
    expect(f.fix).toBeUndefined();
    expect(f.evidence).toHaveLength(1);
    // About half of 40 fail, from the seed.
    expect(f.evidence![0].count).toBeGreaterThan(10);
    expect(f.evidence![0].count).toBeLessThan(30);
  });

  /** A topic whose consumer retries in place while a simulation takes it down. */
  const inPlace = (): DiagramFile => ({
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
  });

  it("raises `dropped` at a broker that loses messages no static finding explains, with no fix", () => {
    // No failure rate anywhere, so the static check is quiet, but the deliveries in flight run out and are lost.
    const d = inPlace();
    expect(runChecks(d).findings).toEqual([]);
    const s = shown(d);
    expect(s.result.findings.map((f) => f.id)).toEqual(["dropped:topic"]);
    const [f] = s.result.findings;
    expect(f.title).toBe("Messages are lost at orders");
    // It names the consumer that failed, not every consumer of the topic.
    expect(f.elements).toEqual(["topic", "pay"]);
    expect(f.message).toBe(
      "Messages Payments kept failing ran out of deliveries and were lost: orders has no dead-letter queue.",
    );
    // What happened and where, never a fix: no button, no chips (the static dead-letter check offers that one).
    expect(f.fix).toBeUndefined();
    expect(f.evidence![0].count).toBeGreaterThan(0);
    // The node the simulation takes down drops nothing itself: deliveries wait at the topic.
    expect(s.planned).toEqual([]);
  });

  it("never offers a fix: check_diagram's `dropped` findings have none, and counts leave static fixes as they were", () => {
    // At a broker ("Messages are lost at …") and at a service ("Failed requests to … are lost").
    for (const d of [inPlace(), flaky()]) {
      const s = shown(d);
      const report = agentReport(s.result, "all", { evidence: collectEvidence(d), planned: s.planned });
      const dropped = report.findings.filter((f) => f.rule === "dropped");
      expect(dropped, d.title).toHaveLength(1);
      expect(dropped[0].evidence, d.title).toHaveLength(1);
      expect(dropped[0], d.title).not.toHaveProperty("fix");
      // No fix anywhere, so no hint about sending one.
      expect(report.hint, d.title).toBeUndefined();
    }
    // A count on a static finding: its fix is dead-letter's own, as the checks worked it out.
    const d = queued();
    const [counted] = shown(d).result.findings;
    expect(counted.evidence).toHaveLength(1);
    expect(counted.fix?.label).toBe("Add dead-letter queue");
    expect(counted.fix).toEqual(runChecks(d).findings[0].fix);
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
    const s = shown(d);
    // On purpose (the simulation takes it down), and still the finding's point: what one replica costs.
    expect(s.result.findings[0].evidence).toEqual([
      { simulation: "Orders API goes down", what: "dropped", count: expect.any(Number) },
    ]);
    expect(s.result.findings[0].evidence![0].count).toBeGreaterThan(10);
    expect(s.planned).toEqual([]);
  });

  describe("losses a simulation causes on purpose are planned, never findings", () => {
    /** The API takes requests from the start; the simulation takes it down from 0.2 s to 0.9 s. */
    const outage = (extra: Partial<Simulation> = {}) =>
      flaky(
        {
          timeline: [
            { atMs: 200, action: { do: "status", node: "api", status: "down" } },
            { atMs: 900, action: { do: "status", node: "api", status: "up" } },
          ],
          ...extra,
        },
        0,
      );

    it("at a node it takes down", () => {
      const s = shown(outage());
      expect(s.result.findings).toEqual([]);
      expect(s.planned).toEqual([
        { node: "api", simulation: "Checkout rush", what: "dropped", count: expect.any(Number), why: "down" },
      ]);
      expect(s.planned[0].count).toBeGreaterThan(0);
    });

    it("but not where it also expects nothing lost: then the loss is news", () => {
      const d = outage({
        expectations: [
          { id: "n", label: "No request lost", metric: { node: "api", field: "dropped" }, op: "==", value: 0 },
        ],
      });
      const s = shown(d);
      expect(s.planned).toEqual([]);
      expect(s.result.findings.map((f) => f.id)).toEqual(["dropped:api"]);
    });

    it("at a node it makes fail", () => {
      const d = flaky({ setup: { props: { api: { failureRate: 0.5 } } } }, 0);
      expect(shown(d).planned.map((p) => p.why)).toEqual(["fails"]);
    });

    it.each(["boundary", "fail", "link"] as const)(
      "recognizes an intentional %s fault without an expectation",
      (kind) => {
        const d = outage({ timeline: [] });
        d.groups = [
          { id: "a", label: "Zone a", x: 0, y: 0, width: 300, height: 300 },
          { id: "b", label: "Zone b", x: 400, y: 0, width: 300, height: 300 },
        ];
        for (const n of d.nodes) n.group = n.id === "api" ? "b" : "a";
        const edge = d.edges.find((e) => e.to === "api")!;
        const fault =
          kind === "boundary"
            ? { kind, boundary: "b", down: true }
            : kind === "link"
              ? { kind, edge: edge.id, cut: true }
              : { kind, node: "api", rate: 0.5 as const };
        d.simulations![0].timeline = [{ atMs: 0, action: { do: "fault", fault } }];
        const s = shown(d);
        expect(s.result.findings).toEqual([]);
        expect(s.planned).toEqual([
          {
            node: "api",
            simulation: "Checkout rush",
            what: "dropped",
            count: expect.any(Number),
            why: kind === "fail" ? "fails" : "down",
          },
        ]);
        expect(s.planned[0].count).toBeGreaterThan(0);
      },
    );

    it("only for what its played timeline did: an outage after the losses, or past the minute, excuses nothing", () => {
      // The API fails every request (the design); the simulation's outage comes later, or never plays.
      for (const atMs of [20_000, 90_000]) {
        const d = flaky(
          {
            timeline: [
              { atMs, action: { do: "status", node: "api", status: "down" } },
              { atMs: atMs + 500, action: { do: "status", node: "api", status: "up" } },
            ],
            durationMs: 25_000,
          },
          1,
        );
        const s = shown(d);
        expect(s.planned, `outage at ${atMs}`).toEqual([]);
        expect(s.result.findings.map((f) => f.id)).toEqual(["dropped:api"]);
        expect(s.result.findings[0].evidence![0].count).toBe(40);
      }
    });

    it("where its own expectations count on a loss, but not where they expect none", () => {
      const expecting = (op: "==" | ">", value: number) =>
        flaky({
          expectations: [{ id: "x", label: "x", metric: { node: "api", field: "dropped" }, op, value }],
        });
      expect(shown(expecting(">", 0)).planned.map((p) => p.why)).toEqual(["expected"]);
      const none = shown(expecting("==", 0));
      expect(none.planned).toEqual([]);
      expect(none.result.findings.map((f) => f.id)).toEqual(["dropped:api"]);
    });

    it("expected broker losses are planned even where a dead-letter finding is; an expectation of none attaches", () => {
      const expecting = (op: "==", value: number) =>
        queued({}, { expectations: [{ id: "x", label: "x", metric: { node: "q", field: "dropped" }, op, value }] });
      const some = shown(expecting("==", 20));
      expect(some.result.findings.map((f) => f.id)).toEqual(["dead-letter:q"]);
      expect(some.result.findings[0].evidence).toBeUndefined();
      expect(some.planned).toEqual([
        { node: "q", simulation: "Poison batch", what: "dropped", count: 20, why: "expected" },
      ]);
      const none = shown(expecting("==", 0));
      expect(none.result.findings[0].evidence).toEqual([{ simulation: "Poison batch", what: "dropped", count: 20 }]);
      expect(none.planned).toEqual([]);
    });

    it("a broker the simulation takes down loses on purpose, not for want of a dead-letter queue", () => {
      // A queue with a working DLQ: while it's down, what's published to it is lost; nothing runs out of deliveries.
      const d: DiagramFile = {
        ...queued(),
        nodes: [
          ...queued().nodes.map((n) => (n.id === "worker" ? { ...n, props: undefined } : n)),
          { id: "dlq", stencil: "azure.service-bus.queue", label: "orders DLQ", x: 300, y: 200 },
          { id: "ops", stencil: "service.node", label: "Ops", x: 600, y: 200 },
        ],
        edges: [
          ...queued().edges,
          { id: "e3", from: "q", to: "dlq", kind: "async", props: { dlq: true } },
          { id: "e4", from: "dlq", to: "ops", kind: "async" },
        ],
        simulations: [
          burst("shop", 20, {
            title: "Queue outage",
            timeline: [
              { atMs: 0, action: { do: "status", node: "q", status: "down" } },
              { atMs: 3000, action: { do: "status", node: "q", status: "up" } },
            ],
          }),
        ],
      };
      expect(runChecks(d).findings).toEqual([]);
      const s = shown(d);
      expect(s.result.findings).toEqual([]);
      expect(s.planned).toEqual([{ node: "q", simulation: "Queue outage", what: "dropped", count: 20, why: "down" }]);
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
      expect(counts(d)).toEqual({ "no-reader:dlq": ["20 unread in Poison batch"] });
      const keeps = structuredClone(d);
      keeps.simulations![0].expectations = [
        { id: "k", label: "Kept", metric: { node: "dlq", field: "backlog" }, op: "==", value: 20 },
      ];
      const s = shown(keeps);
      expect(s.counted).toBe(0);
      expect(s.planned).toEqual([
        { node: "dlq", simulation: "Poison batch", what: "unread", count: 20, why: "expected" },
      ]);
    });
  });

  it("caps each simulation at 60 s of simulated time, and can stop between any two ticks", () => {
    const d = flaky({
      traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 2, durationMs: 600_000 } }],
    });
    const it = gatherEvidence(d, { sliceTicks: 1 });
    let slices = 0;
    let next = it.next();
    for (; !next.done; next = it.next()) if (next.value.kind === "slice") slices++;
    // A slice after every engine tick: 6,000 in a minute.
    expect(slices).toBe(TICKS_PER_MINUTE);
    expect(next.value.played).toEqual([
      { id: "s", title: "Checkout rush", playedMs: EVIDENCE_LIMITS.simulatedMs, capped: true },
    ]);
    const [f] = shown(d, next.value).result.findings;
    expect(f.evidence![0].capped).toBe(true);
    expect(evidenceText(f.evidence![0])).toMatch(/ in the first minute of “Checkout rush”$/);
  });

  describe("the wall-clock budget (an injected clock)", () => {
    it("leaves out what it didn't finish, never half-counted", () => {
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
      // A clock that moves 1 ms each time it's read: a few hundred reads finish "Short"; "Long" would need 6,000.
      let t = 0;
      const ev = collectEvidence(d, { now: () => t++, wallMs: 1000, sliceTicks: 1 });
      expect(ev.played.map((p) => p.id)).toEqual(["short"]);
      expect(ev.unplayed).toEqual(["Long", "After"]);
      expect(shown(d, ev).result.findings[0].evidence!.map((e) => e.simulation)).toEqual(["Short"]);
    });

    it("leaves out a short simulation the deadline passes before its first slice, at the production slice size", () => {
      // Half a second: 50 ticks, fewer than a slice's 100, so no slice ever reads the clock.
      const d = flaky({ durationMs: 500 });
      let t = 0;
      const it = gatherEvidence(d, { now: () => t });
      expect(it.next().value).toEqual({ kind: "simulation", index: 1, total: 1, title: "Checkout rush" });
      t = EVIDENCE_LIMITS.wallMs + 1;
      const next = it.next();
      expect(next.done).toBe(true);
      const ev = next.value as Evidence;
      expect(ev.played).toEqual([]);
      expect(ev.unplayed).toEqual(["Checkout rush"]);
      expect(shown(d, ev).result.findings).toEqual([]);
    });

    it("is read between simulations: many short ones can't outrun it", () => {
      const d = flaky({ durationMs: 500 });
      d.simulations = Array.from({ length: 50 }, (_, i) => ({ ...d.simulations![0], id: `s${i}`, title: `S${i}` }));
      let t = 0;
      const ev = collectEvidence(d, { now: () => t++, wallMs: 20 });
      expect(ev.played.length).toBeGreaterThan(0);
      expect(ev.played.length).toBeLessThan(50);
      expect(ev.played.length + ev.unplayed.length).toBe(50);
    });
  });

  it("doesn't play a simulation that would start more work than the bound, before allocating any", () => {
    // A burst of 100,000 into a source with 2,000 routes: two hundred million copies in one tick.
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Hostile",
      nodes: [
        { id: "src", stencil: "client.browser", label: "Src", x: 0, y: 0 },
        ...Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}`, stencil: "postgres", label: `N${i}`, x: 300, y: i })),
      ],
      edges: Array.from({ length: 2000 }, (_, i) => ({
        id: `e${i}`,
        from: "src",
        to: `n${i}`,
        kind: "async" as const,
      })),
      simulations: [
        { id: "h", title: "Hostile", traffic: [{ id: "t", node: "src", shape: { kind: "burst", count: 100_000 } }] },
        { ...flaky().simulations![0], id: "ok", title: "Fine", traffic: [] },
      ],
    };
    expect(startWork(d.simulations![0], buildContext(d))).toBe(200_000_000);
    const ev = collectEvidence(d);
    expect(ev.tooBig).toEqual(["Hostile"]);
    expect(ev.played.map((p) => p.id)).toEqual(["ok"]);
  });

  it("is cancelled by not asking for more: nothing runs after the last step taken", () => {
    const it = gatherEvidence(flaky(), { sliceTicks: 1 });
    expect(it.next().value).toEqual({ kind: "simulation", index: 1, total: 1, title: "Checkout rush" });
    expect(it.next().value).toEqual({ kind: "slice" });
    expect(it.return(undefined as never).done).toBe(true);
    expect(it.next().done).toBe(true);
  });

  it("plays nothing for a diagram without saved simulations", () => {
    const d = flaky();
    delete d.simulations;
    expect(collectEvidence(d)).toEqual({ played: [], unplayed: [], tooBig: [], losses: [], dropped: [] });
  });
});

describe("withEvidence: the checks as they are now, not as they were when it played", () => {
  it("adds `dropped` after the checks' own findings, and puts counts on theirs", () => {
    expect(counts(queued())).toEqual({ "dead-letter:q": ["20 dropped in Poison batch"] });
    expect(shown(flaky()).result.findings.map((x) => x.id)).toEqual(["dropped:api"]);
  });

  it("honours Ignore here and Turn off this check", () => {
    const d = flaky();
    const ev = collectEvidence(d);
    const ignored = withEvidence(runChecks(d), ev, { ignore: [{ rule: "dropped", target: "api" }] });
    expect(ignored.result.findings).toEqual([]);
    expect(ignored.result.ignored.map((f) => f.id)).toEqual(["dropped:api"]);
    expect(ignored.counted).toBe(0);
    const off = withEvidence(runChecks(d), ev, { off: ["dropped"] });
    expect(off.result.findings).toEqual([]);
    expect(off.result.ignored).toEqual([]);
  });

  it("counts kept from a run with a check off show once it's turned back on, as a fresh run would", () => {
    const d = flaky();
    const played = collectEvidence({ ...d, checks: { off: ["dropped"] } });
    expect(shown(d, played)).toEqual(shown(d));
    expect(shown(d, played).result.findings.map((f) => f.id)).toEqual(["dropped:api"]);
  });

  it("turning dead-letter off after a run hides a broker's losses, as a fresh run would", () => {
    const d = inPlaceTopic();
    const played = collectEvidence(d);
    expect(shown(d, played).result.findings.map((f) => f.id)).toEqual(["dropped:topic"]);
    const off = { ...d, checks: { off: ["dead-letter"] } };
    expect(shown(off, played)).toEqual(shown(off));
    expect(shown(off, played).result.findings).toEqual([]);
  });

  it("puts counts on an ignored finding too, where Show again finds them", () => {
    const d = queued({ checks: { ignore: [{ rule: "dead-letter", target: "q" }] } });
    const s = shown(d);
    expect(s.result.findings).toEqual([]);
    expect(s.result.ignored[0].evidence?.[0].count).toBe(20);
  });
});

/** A topic whose consumer fails every message in a simulation that doesn't say so statically (no failure rate). */
function inPlaceTopic(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Topic",
    nodes: [
      { id: "shop", stencil: "client.browser", label: "Shop", x: 0, y: 0 },
      { id: "topic", stencil: "kafka.topic", label: "orders", x: 300, y: 0 },
      {
        id: "pay",
        stencil: "service.go",
        label: "Payments",
        x: 600,
        y: 0,
        props: { retry: "inplace", retryBackoffMs: 500 },
      },
    ],
    edges: [
      { id: "e1", from: "shop", to: "topic", kind: "async" },
      { id: "e2", from: "topic", to: "pay", kind: "async" },
    ],
    simulations: [
      {
        id: "o",
        title: "Down",
        seed: 3,
        traffic: [{ id: "t", node: "shop", shape: { kind: "constant", ratePerSec: 40, durationMs: 4000 } }],
        timeline: [
          { atMs: 2000, action: { do: "status", node: "pay", status: "down" } },
          { atMs: 8000, action: { do: "status", node: "pay", status: "up" } },
        ],
      },
    ],
  };
}

describe("playSimulations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("without a worker, gives what collectEvidence gives, saying which simulation it's on", async () => {
    const d = flaky();
    const progress: string[] = [];
    const run = playSimulations(d, (p) => progress.push(`${p.index}/${p.total} ${p.title}`), { worker: false });
    expect(await run.done).toEqual(collectEvidence(d));
    expect(progress).toEqual(["1/1 Checkout rush"]);
  });

  it("without a worker, ends a slice within a tick of its budget: the clock is read between ticks", async () => {
    const d = flaky();
    // A clock that moves 1 ms a read: a 6 ms slice is a handful of ticks, never a hundred.
    let t = 0;
    let slices = 0;
    const run = playSimulations(d, () => {}, {
      worker: false,
      now: () => t++,
      wallMs: 1e9,
      setTimer: (fn) => {
        slices++;
        return setTimeout(fn, 0);
      },
    });
    const ev = await run.done;
    const ticks = ev.played[0].playedMs / 10;
    expect(ticks).toBeGreaterThan(100);
    expect(slices).toBeGreaterThanOrEqual(Math.floor(ticks / 7));
  });

  it("without a worker, declines a diagram too big to prepare between frames", async () => {
    const d = flaky();
    d.nodes = [
      ...d.nodes,
      ...Array.from({ length: MAIN_THREAD_NODES }, (_, i) => ({
        id: `x${i}`,
        stencil: "postgres",
        label: "x",
        x: 0,
        y: i,
      })),
    ];
    const run = playSimulations(d, () => {}, { worker: false });
    await expect(run.done).rejects.toEqual(new EvidenceUnavailable("unsupported"));
  });

  it("stops at once when cancelled", async () => {
    const d = flaky({
      traffic: [{ id: "t", node: "web", shape: { kind: "constant", ratePerSec: 50, durationMs: 600_000 } }],
    });
    d.simulations!.push({ ...d.simulations![0], id: "two", title: "Two" });
    const progress: string[] = [];
    // Stopped as the first one starts.
    const run = playSimulations(
      d,
      (p) => {
        progress.push(p.title);
        run.cancel();
      },
      { worker: false },
    );
    await expect(run.done).rejects.toBeInstanceOf(EvidenceStopped);
    // Turns of the event loop, where a slice would have run: none does.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(progress).toEqual(["Checkout rush"]);
  });

  it("terminates a worker that outlasts its budget", async () => {
    const terminated = vi.fn();
    class SilentWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage() {}
      terminate = terminated;
    }
    vi.stubGlobal("Worker", SilentWorker);
    let watchdog: (() => void) | undefined;
    let after = 0;
    const run = playSimulations(flaky(), () => {}, {
      wallMs: 100,
      setTimer: (fn, ms) => {
        watchdog = fn;
        after = ms;
        return 1;
      },
      clearTimer: () => {},
    });
    expect(after).toBeGreaterThan(100);
    watchdog!();
    await expect(run.done).rejects.toEqual(new EvidenceUnavailable("timeout"));
    expect(terminated).toHaveBeenCalled();
  });
});
