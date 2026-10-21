import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { createEngine } from "../sim/engine";
import { realSnapshot } from "../sim/units";
import { TroubleWatcher, pickTrouble, troubleLeads, type Trouble, type WatchedFrame } from "./observedTrouble";
import { waitingFixture } from "../lab/waitingFixture";
import { GROWTH_FACTOR, LINEAR_LIMIT, growth } from "../test/complexity";
import * as admission from "../model/admissionSchema";
import * as defaults from "../sim/defaults";
import { simulationEdges } from "../sim/simulationEdges";

// What playback shows going wrong, read from seeded runs: rising lag, lost messages, a node that's down.

function diagram(rate: number, worker: Record<string, unknown> = {}, broker = "aws.sqs"): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Orders",
    nodes: [
      { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0, props: { ratePerSec: rate } },
      { id: "q", stencil: broker, label: "orders", x: 0, y: 0 },
      { id: "worker", stencil: "service.go", label: "Fulfilment worker", x: 0, y: 0, props: worker },
    ],
    edges: [
      { id: "a", from: "web", to: "q", kind: "async" },
      { id: "b", from: "q", to: "worker", kind: "async" },
    ],
  };
}

/** Free play for `seconds`, watching every 100 ms; the troubles seen at the end. */
function watch(d: DiagramFile, seconds: number, setup?: (e: ReturnType<typeof createEngine>) => void): Trouble[] {
  const engine = createEngine({ seed: 1 });
  engine.load(d);
  engine.setTraffic(true);
  setup?.(engine);
  const watcher = new TroubleWatcher();
  let seen: Trouble[] = [];
  for (let t = 0; t < seconds * 1000; t += 100) {
    engine.step(100);
    seen = watcher.observe(realSnapshot(engine.snapshot()), d);
  }
  return seen;
}

describe("trouble seen in playback", () => {
  it.each(["p3", "p3-w1"] as const)(
    "keeps per-edge timeout suggestions when sharing target timing at %s",
    (revision) => {
      const d = waitingFixture();
      d.planning = { revision };
      d.nodes = [
        ...["first", "second", "third"].map((id) => ({ ...d.nodes[1], id })),
        { ...d.nodes[2], props: { latencyMs: 2000, api: { latencyMs: 2000 }, jitter: 0 } },
        { ...d.nodes[2], id: "slower", props: { latencyMs: 8000, api: { latencyMs: 8000 }, jitter: 0 } },
      ];
      d.edges = [
        { id: "near", from: "first", to: "partner", kind: "sync", props: { networkDelayMs: 100 } },
        { id: "far", from: "second", to: "partner", kind: "sync", props: { networkDelayMs: 500 } },
        { id: "slow", from: "third", to: "slower", kind: "sync", props: { networkDelayMs: 200 } },
      ];
      const fallback = vi.spyOn(defaults, "resolveNodeProps");
      const watcher = new TroubleWatcher();
      try {
        let seen: Trouble[] = [];
        for (let second = 0; second <= 10; second++) {
          const frame: WatchedFrame = {
            time: second * 1000,
            nodes: Object.fromEntries(
              d.edges.map((edge) => [
                edge.from,
                {
                  status: "up",
                  lag: {},
                  dropped: 0,
                  backlog: second,
                  threads: { slots: 4, working: 0, waiting: 4, queued: 0, waitingOn: [[edge.id, 4]] },
                },
              ]),
            ),
          };
          seen = watcher.observe(frame, d);
        }
        expect(seen.map((trouble) => trouble.action)).toEqual([
          { kind: "add-timeout", edge: "near", deadlineMs: 10000 },
          { kind: "add-timeout", edge: "far", deadlineMs: 20000 },
          { kind: "add-timeout", edge: "slow", deadlineMs: 50000 },
        ]);
        for (const target of ["partner", "slower"])
          expect(fallback.mock.calls.filter(([, node]) => node.id === target)).toHaveLength(1);
      } finally {
        fallback.mockRestore();
      }
    },
  );
  it("accepts documentation edges with a shape at either end", () => {
    const d = waitingFixture();
    d.annotations = [
      { id: "box", kind: "shape", shape: "rect", text: "Outside simulation", x: 0, y: 0, width: 160, height: 90 },
    ];
    d.edges.push(
      { id: "to-shape", from: "caller", to: "box", kind: "async" },
      { id: "from-shape", from: "box", to: "partner", kind: "async" },
    );
    expect(new TroubleWatcher().observe({ time: 0, nodes: {} }, d)).toEqual([]);
  });
  it.each(["p3", "p3-w1"] as const)("validates fallback endpoints once per target at %s", (revision) => {
    const d = waitingFixture();
    d.planning = { revision };
    d.nodes[2].props!.endpoints = Array.from({ length: 50 }, (_, i) => ({
      id: `endpoint-${i}`,
      method: "GET",
      path: `/items/${i}`,
      behaviour: {
        quotas: Array.from({ length: 4 }, (_, q) => ({
          id: `quota-${q}`,
          unit: "requests",
          amount: 1000,
          windowMs: 1000,
          algorithm: "token-bucket",
        })),
      },
    }));
    d.edges = Array.from({ length: 20 }, (_, i) => ({ ...d.edges[1], id: `call-${i}` }));
    const validate = vi.spyOn(admission, "validAdmissionData");
    const fallback = vi.spyOn(defaults, "resolveNodeProps");
    try {
      new TroubleWatcher().observe({ time: 0, nodes: {} }, d);
      expect(fallback.mock.calls.filter(([, node]) => node.id === "partner")).toHaveLength(1);
      const targetCalls = validate.mock.calls.filter(([, endpoints]) => endpoints === d.nodes[2].props!.endpoints);
      // W1 planning independently validates the configuration once, before fallback timing.
      expect(targetCalls).toHaveLength(revision === "p3-w1" ? 2 : 1);
    } finally {
      validate.mockRestore();
      fallback.mockRestore();
    }
  });
  it("offers Add a timeout when a saved simulation disables the inherited deadline", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 120;
    d.nodes[1].props!.concurrency = 100;
    d.edges[1].props!.caller = { deadlineMs: 600 };
    const effective = simulationEdges(d, {
      id: "unbounded",
      title: "No timeout",
      traffic: [],
      setup: { edges: { call: { caller: { deadlineMs: null } } } },
    });
    expect(effective.edges[1].props!.caller).toEqual({ deadlineMs: null });
    const observed = watch(effective, 12, (e) => e.setFault({ kind: "slow", node: "partner", factor: 10 }));
    expect(observed.find((t) => t.kind === "threads-exhausted")?.action).toEqual({
      kind: "add-timeout",
      edge: "call",
      deadlineMs: 600,
    });
    d.edges[1].props!.caller = {};
    expect(watch(d, 12, (e) => e.setFault({ kind: "slow", node: "partner", factor: 10 }))).toEqual(observed);
  });
  it("keeps Free the thread when a cut call cannot afford a normal reply", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 100;
    d.groups = ["local", "remote"].map((id) => ({ id, label: id, x: 0, y: 0, width: 100, height: 100 }));
    d.nodes[1].group = "local";
    d.nodes[2].group = "remote";
    const e = createEngine();
    e.load(d);
    e.setTraffic(true);
    const watcher = new TroubleWatcher();
    for (let i = 0; i < 120; i++) {
      e.step(100);
      watcher.observe(realSnapshot(e.snapshot()), d);
    }
    expect(
      watcher.observe(realSnapshot(e.snapshot()), d).find((t) => t.kind === "threads-exhausted")?.action.kind,
    ).toBe("free-thread");
    e.setFault({ kind: "link", edge: "call", cut: true });
    expect(
      watcher.observe(realSnapshot(e.snapshot()), d).find((t) => t.kind === "threads-exhausted")?.action.kind,
    ).toBe("free-thread");
  });
  it("offers a timeout before freeing threads on cut calls, unless a timeout already exists", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 120;
    d.nodes[1].props!.concurrency = 100;
    d.groups = ["local", "remote"].map((id) => ({ id, label: id, x: 0, y: 0, width: 100, height: 100 }));
    d.nodes[1].group = "local";
    d.nodes[2].group = "remote";
    const troubles = watch(d, 12, (e) => e.setFault({ kind: "link", edge: "call", cut: true }));
    expect(troubles.find((t) => t.kind === "threads-exhausted")?.action).toEqual({
      kind: "add-timeout",
      edge: "call",
      deadlineMs: 600,
    });
    d.edges[1].props!.caller = { deadlineMs: 100_000 };
    const bounded = watch(structuredClone(d), 12, (e) => e.setFault({ kind: "link", edge: "call", cut: true }));
    expect(bounded.find((t) => t.kind === "threads-exhausted")?.action).toEqual({ kind: "free-thread", edge: "call" });
  });
  it("keeps the exhausted-thread fix visible across reply/admission gaps while the queue rises", () => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 100;
    const e = createEngine({ seed: 17 });
    e.load(d);
    e.setTraffic(true);
    const watcher = new TroubleWatcher();
    const memory = { shown: new Set<string>(), ended: new Set<string>(), dismissed: new Set<string>() };
    let shown = false;
    for (let i = 0; i < 120; i++) {
      e.step(100);
      const trouble = pickTrouble(watcher.observe(realSnapshot(e.snapshot()), d), memory, watcher.warm);
      if (trouble) {
        expect(trouble).toMatchObject({ kind: "threads-exhausted", action: { kind: "free-thread", edge: "call" } });
        memory.shown.add(trouble.key);
        shown = true;
      } else expect(shown).toBe(false);
    }
    expect(shown).toBe(true);
  });
  it("a healthy run has none", () => {
    expect(watch(diagram(6), 30)).toEqual([]);
  });

  it("a backlog that keeps growing is reported, naming who can't keep up", () => {
    const [lag] = watch(diagram(30), 30);
    expect(lag).toMatchObject({ kind: "lag", node: "q", action: { kind: "inputs" } });
    expect(lag.headline).toMatch(/^orders is falling behind: lag \d+ and rising$/);
    expect(lag.detail).toBe("Fulfilment worker doesn't keep up with it.");
  });

  it("a backlog that's draining isn't", () => {
    // 30/s for 15 s, then nothing: the lag peaks and falls.
    const d = diagram(30);
    const engine = createEngine({ seed: 1 });
    engine.load(d);
    engine.setTraffic(true);
    const watcher = new TroubleWatcher();
    let seen: Trouble[] = [];
    for (let t = 0; t < 30_000; t += 100) {
      if (t === 15_000) engine.setTraffic(false);
      engine.step(100);
      seen = watcher.observe(realSnapshot(engine.snapshot()), d);
    }
    expect(seen).toEqual([]);
  });

  it("a dead-letter queue filling up is no trouble: it keeps them on purpose", () => {
    const d = diagram(8, { failureRate: 0.8, replicas: 3 });
    d.nodes.push({ id: "dlq", stencil: "aws.sqs", label: "orders-dlq", x: 0, y: 0 });
    d.edges.push({ id: "dead", from: "q", to: "dlq", kind: "async", props: { dlq: true } });
    expect(watch(d, 40)).toEqual([]);
  });

  it("a down consumer behind a queue: its messages wait there, counted, with Revive", () => {
    const [down] = watch(diagram(2), 20, (e) => e.setNodeStatus("worker", "down"));
    expect(down).toMatchObject({
      kind: "down",
      headline: "Fulfilment worker is down",
      action: { kind: "revive", node: "worker" },
    });
    expect(down.detail).toMatch(/^Messages wait in orders until it's back \(\d+ so far\)\.$/);
    expect(Number(/\((\d+) so far/.exec(down.detail)![1])).toBeGreaterThan(30);
  });

  it("a consumer failing behind a topic with no dead-letter queue loses messages: the action adds one", () => {
    const troubles = watch(diagram(10, { failureRate: 0.5 }, "kafka.topic"), 30);
    expect(troubles.find((t) => t.kind === "dropping")).toMatchObject({
      node: "q",
      action: { kind: "add-dlq", node: "q" },
      detail: "They ran out of deliveries, and no dead-letter queue keeps them.",
    });
    expect(troubles[0].headline).toMatch(/^orders is losing messages: \d+ dropped$/);
  });
});

describe("a jump isn't a trend", () => {
  it("seeking forward over a backlog that's now draining reports nothing", () => {
    const d = diagram(2);
    const frame = (time: number, lag: number) => ({
      time,
      nodes: {
        q: { status: "up" as const, lag: { queue: lag }, dropped: 0 },
        worker: { status: "up" as const, lag: {}, dropped: 0 },
      },
    });
    const watcher = new TroubleWatcher();
    expect(watcher.observe(frame(4_000, 0), d)).toEqual([]);
    // The seek lands on a big backlog, which then drains.
    for (let t = 12_000, lag = 500; t <= 30_000; t += 500, lag -= 10)
      expect(watcher.observe(frame(t, lag), d), `at ${t}`).toEqual([]);
  });
});

describe("which trouble the callout shows", () => {
  const t = (key: string): Trouble => ({
    key,
    kind: "lag",
    node: key,
    headline: key,
    announce: key,
    detail: "",
    action: { kind: "inputs" },
  });
  it("each cause once per run, until it's dismissed or over", () => {
    const memory = { shown: new Set<string>(), ended: new Set<string>(), dismissed: new Set<string>() };
    const show = (current: Trouble[]) => {
      const pick = pickTrouble(current, memory);
      if (pick) memory.shown.add(pick.key);
      return pick?.key;
    };
    expect(show([t("a"), t("b")])).toBe("a");
    expect(show([t("a"), t("b")])).toBe("a");
    memory.dismissed.add("a");
    expect(show([t("a"), t("b")])).toBe("b");
    // b is over, then back: not shown again in this run.
    expect(show([t("a")])).toBeUndefined();
    expect(show([t("a"), t("b")])).toBeUndefined();
  });

  it("a cause never on screen (hidden behind a panel) keeps its turn when it comes back", () => {
    const memory = { shown: new Set<string>(), ended: new Set<string>(), dismissed: new Set<string>() };
    // Picked but not shown: the Inputs panel was open.
    expect(pickTrouble([t("down:worker")], memory)?.key).toBe("down:worker");
    expect(pickTrouble([], memory)).toBeUndefined();
    expect(pickTrouble([t("down:worker")], memory)?.key).toBe("down:worker");
  });

  it("while the history is short (a seek), a shown lag isn't over: it comes back once seen again", () => {
    const memory = { shown: new Set(["lag:q"]), ended: new Set<string>(), dismissed: new Set<string>() };
    expect(pickTrouble([], memory, false)).toBeUndefined();
    expect(memory.ended.has("lag:q")).toBe(false);
    expect(pickTrouble([t("lag:q")], memory)?.key).toBe("lag:q");
  });
});

describe("status and classification", () => {
  const frame = (time: number, worker: "up" | "down", lag = 0) => ({
    time,
    nodes: {
      q: { status: "up" as const, lag: { queue: lag }, dropped: 0 },
      worker: { status: worker, lag: {}, dropped: 0 },
    },
  });

  it("a node killed or revived while time stands still shows at once", () => {
    const d = diagram(2);
    const watcher = new TroubleWatcher();
    expect(watcher.observe(frame(5_000, "up"), d)).toEqual([]);
    expect(watcher.observe(frame(5_000, "down"), d).map((t) => t.key)).toEqual(["down:worker"]);
    expect(watcher.observe(frame(5_000, "up"), d)).toEqual([]);
  });

  it("a queue whose route is marked not dead-letter (dlq: false) still reports rising lag, whatever its name", () => {
    const d = diagram(2);
    d.nodes.push({ id: "parked", stencil: "aws.sqs", label: "No DLQ", x: 0, y: 0 });
    d.nodes.push({ id: "reader", stencil: "service.go", label: "Reader", x: 0, y: 0 });
    d.edges.push({ id: "p", from: "q", to: "parked", kind: "async", props: { dlq: false } });
    d.edges.push({ id: "r", from: "parked", to: "reader", kind: "async" });
    const watcher = new TroubleWatcher();
    let seen: Trouble[] = [];
    for (let t = 0, lag = 0; t <= 12_000; t += 1_000, lag += 40)
      seen = watcher.observe(
        {
          time: t,
          nodes: {
            ...frame(t, "up").nodes,
            parked: { status: "up", lag: { r: lag }, dropped: 0 },
            reader: { status: "up", lag: {}, dropped: 0 },
          },
        },
        d,
      );
    expect(seen.map((x) => x.key)).toContain("lag:parked");
  });

  it("an observation is linear in the diagram, however many brokers have no dead-letter route", () => {
    const build = (n: number) => {
      const d: DiagramFile = { format: "diagrams/v1", title: "Many", nodes: [], edges: [] };
      const nodes: Record<string, { status: "up"; lag: Record<string, number>; dropped: number }> = {};
      for (let i = 0; i < n; i++) {
        d.nodes.push({ id: `q${i}`, stencil: "aws.sqs", label: `q${i}`, x: 0, y: 0 });
        d.nodes.push({ id: `w${i}`, stencil: "service.go", label: `w${i}`, x: 0, y: 0 });
        d.edges.push({ id: `e${i}`, from: `q${i}`, to: `w${i}`, kind: "async" });
        nodes[`q${i}`] = { status: "up", lag: { queue: 0 }, dropped: 0 };
        nodes[`w${i}`] = { status: "up", lag: {}, dropped: 0 };
      }
      const watcher = new TroubleWatcher();
      let time = 0;
      // Past the window, so every broker is examined; a new sample each call.
      for (; time <= 12_000; time += 1_000) watcher.observe({ time, nodes }, d);
      return () => watcher.observe({ time: (time += 1_000), nodes }, d);
    };
    expect(growth(build(300), build(300 * GROWTH_FACTOR))).toBeLessThan(LINEAR_LIMIT);
  });
});

it("a down consumer behind a queue waits there, whatever a firewall's deny rule toward it says", () => {
  const d = diagram(2);
  d.nodes.push({ id: "fw", stencil: "generic.firewall", label: "Edge firewall", x: 0, y: 0 });
  d.edges.push({ id: "denied", from: "fw", to: "worker", kind: "sync", props: { deny: true } });
  const watcher = new TroubleWatcher();
  const [down] = watcher.observe(
    {
      time: 1_000,
      nodes: {
        q: { status: "up", lag: { queue: 7 }, dropped: 0 },
        worker: { status: "down", lag: {}, dropped: 0 },
        fw: { status: "up", lag: {}, dropped: 0 },
      },
    },
    d,
  );
  expect(down.detail).toBe("Messages wait in orders until it's back (7 so far).");
});

describe("second review", () => {
  const up = { status: "up" as const, lag: {}, dropped: 0 };

  it("a short run that drops a message says so, without ten seconds of history", () => {
    const d = diagram(2);
    const watcher = new TroubleWatcher();
    watcher.observe({ time: 0, nodes: { q: { ...up, lag: { queue: 0 } }, worker: up } }, d);
    const seen = watcher.observe(
      { time: 1_800, nodes: { q: { ...up, lag: { queue: 0 } }, worker: { ...up, dropped: 1 } } },
      d,
    );
    expect(seen.map((x) => x.key)).toEqual(["dropping:worker"]);
  });

  it("a backlog that levels off is not reported as rising", () => {
    const d = diagram(2);
    const watcher = new TroubleWatcher();
    const lagAt = (t: number) => (t <= 5_000 ? (t / 5_000) * 200 : 200);
    for (let t = 0; t <= 16_000; t += 1_000) {
      const seen = watcher.observe({ time: t, nodes: { q: { ...up, lag: { queue: lagAt(t) } }, worker: up } }, d);
      if (t >= 9_000) expect(seen, `at ${t}`).toEqual([]);
    }
  });

  it("a down queue fed by a topic: its messages wait in the topic, as playback keeps them", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Chain",
      nodes: [
        { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
        { id: "topic", stencil: "kafka.topic", label: "orders", x: 0, y: 0 },
        { id: "q", stencil: "aws.sqs", label: "fulfil", x: 0, y: 0 },
        { id: "worker", stencil: "service.go", label: "Worker", x: 0, y: 0 },
      ],
      edges: [
        { id: "a", from: "web", to: "topic", kind: "async" },
        { id: "b", from: "topic", to: "q", kind: "async" },
        { id: "c", from: "q", to: "worker", kind: "async" },
      ],
    };
    const [down] = new TroubleWatcher().observe(
      {
        time: 1_000,
        nodes: { web: up, topic: { ...up, lag: { b: 29 } }, q: { ...up, status: "down" }, worker: up },
      },
      d,
    );
    expect(down.detail).toBe("Messages wait in orders until it's back (29 so far).");
  });

  it("outage details stay linear with thousands of down consumers on one topic", () => {
    const build = (n: number) => {
      const d: DiagramFile = { format: "diagrams/v1", title: "Wide", nodes: [], edges: [] };
      d.nodes.push({ id: "topic", stencil: "kafka.topic", label: "t", x: 0, y: 0 });
      const nodes: Record<string, { status: "up" | "down"; lag: Record<string, number>; dropped: number }> = {
        topic: { status: "up", lag: {}, dropped: 0 },
      };
      for (let i = 0; i < n; i++) {
        d.nodes.push({ id: `c${i}`, stencil: "service.go", label: `c${i}`, x: 0, y: 0 });
        d.edges.push({ id: `e${i}`, from: "topic", to: `c${i}`, kind: "async" });
        nodes[`c${i}`] = { status: "down", lag: {}, dropped: 0 };
      }
      const watcher = new TroubleWatcher();
      let time = 0;
      watcher.observe({ time, nodes }, d);
      return () => watcher.observe({ time: (time += 1_000), nodes }, d);
    };
    expect(growth(build(150), build(150 * GROWTH_FACTOR))).toBeLessThan(LINEAR_LIMIT);
  });
});

describe("the trouble callout and the capacity callout", () => {
  const lag = (node: string, related: string[]): Trouble => ({
    key: `lag:${node}`,
    kind: "lag",
    node,
    headline: "",
    announce: "",
    detail: "",
    action: { kind: "inputs" },
    related,
  });
  it("a lag the plan diagnoses (its broker or its consumer over capacity, nobody reading it) stays with the plan", () => {
    expect(troubleLeads(lag("q", ["worker"]), { tone: "over", top: { id: "worker" } })).toBe(false);
    expect(troubleLeads(lag("q", ["worker"]), { tone: "hot", top: { id: "q" } })).toBe(false);
    expect(troubleLeads(lag("q", []), { tone: "warn", addConsumer: "q" })).toBe(false);
  });
  it("an unrelated overload elsewhere never hides it; other causes always lead", () => {
    expect(troubleLeads(lag("queue-b", ["worker-b"]), { tone: "over", top: { id: "service-a" } })).toBe(true);
    expect(troubleLeads(lag("q", ["worker"]), { tone: "ok", top: { id: "worker" } })).toBe(true);
    expect(troubleLeads({ ...lag("q", []), key: "down:q", kind: "down" }, { tone: "over", top: { id: "q" } })).toBe(
      true,
    );
  });
});

describe("third review", () => {
  it("loss counters invalidate cached trouble even at the same paused time", () => {
    const d = diagram(0, { failureRate: 1, latencyMs: 0 });
    const e = createEngine({ seed: 1 });
    e.load(d);
    const watcher = new TroubleWatcher();
    expect(watcher.observe(realSnapshot(e.snapshot()), d)).toEqual([]);
    e.inject("worker", 1);
    e.step(10);
    const frame = realSnapshot(e.snapshot());
    const trouble = watcher.observe(frame, d);
    expect(trouble).toEqual([expect.objectContaining({ kind: "dropping", node: "worker" })]);
    expect(watcher.observe(frame, d)).toBe(trouble);
    e.inject("worker", 1);
    e.step(10);
    expect(watcher.observe(realSnapshot(e.snapshot()), d)[0].headline).toContain("2 dropped");
  });

  it.each([false, true])("an unused second DLQ route never suppresses ordinary lag (first denied: %s)", (deny) => {
    const d = diagram(30);
    d.nodes.push({ id: "other", stencil: "aws.sqs", label: "Other", x: 0, y: 0 });
    d.edges.push(
      { id: "first", from: "q", to: "other", props: { dlq: true, deny } },
      { id: "second", from: "q", to: "unread", props: { dlq: true } },
    );
    d.nodes.push({ id: "unread", stencil: "aws.sqs", label: "Unread", x: 0, y: 0 });
    d.edges.push({ id: "ordinary", from: "web", to: "unread" });
    expect(watch(d, 30).find((t) => t.node === "unread")).toMatchObject({
      kind: "lag",
      action: { kind: "add-consumer" },
    });
  });

  it("broker arrival losses remain outage diagnostics after revival, even after event eviction", () => {
    const d = diagram(0);
    const e = createEngine({ seed: 1 });
    e.load(d);
    const watcher = new TroubleWatcher();
    watcher.observe(realSnapshot(e.snapshot()), d);
    e.setNodeStatus("q", "down");
    e.inject("q", 300);
    e.step(1_000);
    e.setNodeStatus("q", "up");
    for (let i = 0; i < 210; i++) e.setNodeStatus("worker", i % 2 ? "up" : "down");
    expect(e.snapshot().events.some((event) => event.kind === "drop")).toBe(false);
    const trouble = watcher.observe(realSnapshot(e.snapshot()), d).find((t) => t.node === "q");
    expect(trouble).toMatchObject({ kind: "dropping", action: { kind: "events", node: "q" } });
    expect(trouble?.detail).toContain("dropped on arrival");
    expect(realSnapshot(e.snapshot()).nodes.q.outageDropped).toBe(300);
  });
});

it("indexes timeout adjacency once instead of materializing all edges for every losing node", () => {
  const count = 300;
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "Independent workers",
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `worker-${i}`,
      label: `Worker ${i}`,
      stencil: "service.go",
      x: i * 200,
      y: 0,
    })),
    edges: Array.from({ length: count }, (_, i) => ({
      id: `edge-${i}`,
      from: `worker-${i}`,
      to: `worker-${(i + 1) % count}`,
      kind: "async",
    })),
  };
  const frame = (dropped: number): WatchedFrame => ({
    time: 0,
    nodes: Object.fromEntries(d.nodes.map((n) => [n.id, { status: "up", lag: {}, dropped }])),
  });
  const watcher = new TroubleWatcher();
  watcher.observe(frame(0), d); // Compile and cache the shape before counting diagnosis work.
  let entries = 0;
  const iterator = Map.prototype[Symbol.iterator];
  const spy = vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function* (this: Map<unknown, unknown>) {
    for (const entry of iterator.call(this)) {
      entries++;
      yield entry;
    }
    return undefined;
  });
  try {
    expect(watcher.observe(frame(1), d)).toHaveLength(count);
    expect(entries).toBeLessThanOrEqual(8 * count);
  } finally {
    spy.mockRestore();
  }
});
