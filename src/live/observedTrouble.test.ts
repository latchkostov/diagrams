import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { createEngine } from "../sim/engine";
import { realSnapshot } from "../sim/units";
import { TroubleWatcher, pickTrouble, type Trouble } from "./observedTrouble";

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
      detail: "They ran out of deliveries and it has no dead-letter queue to keep them.",
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
    detail: "",
    action: { kind: "inputs" },
  });
  it("each cause once per run, until it's dismissed or over", () => {
    const memory = { shown: new Set<string>(), ended: new Set<string>(), dismissed: new Set<string>() };
    expect(pickTrouble([t("a"), t("b")], memory)?.key).toBe("a");
    expect(pickTrouble([t("a"), t("b")], memory)?.key).toBe("a");
    memory.dismissed.add("a");
    expect(pickTrouble([t("a"), t("b")], memory)?.key).toBe("b");
    // b is over, then back: not shown again in this run.
    expect(pickTrouble([t("a")], memory)).toBeUndefined();
    expect(pickTrouble([t("a"), t("b")], memory)).toBeUndefined();
  });
});
