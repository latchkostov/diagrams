import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type DiagramNode } from "../model/types";
import { capacityView, emptyInputs, freePlaySimulation, partitionsNotes } from "./capacityModel";
import { heldWords } from "./format";
import { createEngine } from "../sim/engine";
import { stencilRole } from "../stencils/roles";
import { traceOnce } from "../trace/headless";
import { buildJourney } from "../trace/journey";
import { buildScript } from "./slowmo/script";
import { runChecks } from "../checks";

// A topic, stream or queue nobody reads (the owner's report: "Kafka Topic can't keep up at all. It's paused or
// down, or no consumer can take its messages", "No capacity · 2/s waiting", "297 lag", and raising partitions
// from 3 to 9000 changed nothing). A topic keeps what's published: it isn't overloaded, and it has no lag (lag
// is per consumer group). A queue's messages do wait. Paused and down keep their own words.

const BROKER = { topic: "kafka.topic", stream: "aws.kinesis", queue: "aws.sqs" } as const;

/** Incoming traffic (2/s) → .NET Service → the broker, which nothing reads; .NET Service → App Configuration. */
function owner(broker: keyof typeof BROKER = "topic", extra: Partial<DiagramNode> = {}): DiagramFile {
  return {
    format: DIAGRAM_FORMAT,
    title: "Owner",
    nodes: [
      { id: "in", stencil: "client.user", label: "Incoming traffic", x: 0, y: 0 },
      { id: "api", stencil: "service.dotnet", label: ".NET Service", x: 300, y: 0 },
      { id: "bus", stencil: BROKER[broker], label: "Orders", x: 600, y: 0, ...extra },
      { id: "cfg", stencil: "azure.app-config", label: "App Configuration", x: 300, y: 200 },
    ],
    edges: [
      { id: "e1", from: "in", to: "api" },
      { id: "e2", from: "api", to: "bus" },
      { id: "e3", from: "api", to: "cfg", relation: "config" },
    ],
  };
}
const view = (d: DiagramFile) => capacityView(d, freePlaySimulation(d, emptyInputs()));
const withConsumer = (d: DiagramFile): DiagramFile => ({
  ...d,
  nodes: [...d.nodes, { id: "worker", stencil: "service.java", label: "Worker", x: 900, y: 0 }],
  edges: [...d.edges, { id: "e4", from: "bus", to: "worker" }],
});

describe("the live banner and heat map", () => {
  it.each(["topic", "stream"] as const)("a %s nobody reads: “Nobody reads Orders”, amber, Add a consumer", (role) => {
    const v = view(owner(role));
    expect(v.headline).toBe("Nobody reads Orders");
    expect(v.detail).toBe(
      "It keeps what's published, but nothing consumes it. Partitions can't change that: add a consumer.",
    );
    expect(v.addConsumer).toBe("bus");
    expect(v.tone).toBe("warn");
    expect(v.nodes.bus).toMatchObject({ noReader: true, level: "warn", text: "Nobody reads this yet · 2/s kept" });
    expect(v.headline).not.toMatch(/can't keep up/);
  });

  it("a queue nobody reads keeps the waiting words: its messages do pile up", () => {
    const v = view(owner("queue"));
    expect(v.headline).toBe("Nobody reads Orders");
    expect(v.detail).toBe("Messages wait in it until a consumer takes them.");
    expect(v.addConsumer).toBe("bus");
    expect(v.nodes.bus).toMatchObject({ noReader: true, level: "over", text: "No consumer · 2/s waiting" });
  });

  it("paused or down keeps its own words, separate from nobody reading it", () => {
    const paused = view(owner("topic", { props: { status: "paused" } }));
    expect(paused.headline).toBe("Orders is paused");
    expect(paused.addConsumer).toBeUndefined();
    expect(paused.nodes.bus.text).toBe("Paused · 2/s waiting");
    // The consumer is down: an outage, not "nobody reads it".
    const d = withConsumer(owner());
    d.nodes[4].props = { status: "down" };
    const down = view(d);
    expect(down.headline).toBe("Worker is down");
    expect(down.nodes.bus.noReader).toBeUndefined();
  });

  it("more partitions change nothing, and the banner doesn't pretend they could", () => {
    const more = view(owner("topic", { props: { partitions: 9000 } }));
    expect(more.headline).toBe("Nobody reads Orders");
    expect(more.fix).toBeNull();
  });

  it("a dead-letter route out isn't a reader", () => {
    const d = owner();
    d.nodes.push({ id: "dlq", stencil: "aws.sqs", label: "Orders DLQ", x: 600, y: 200 });
    d.edges.push({ id: "e5", from: "bus", to: "dlq", props: { dlq: true } });
    expect(view(d).nodes.bus.noReader).toBe(true);
  });

  it("with a consumer, a topic is read: no 'nobody reads', and the config dependency carries nothing", () => {
    const v = view(withConsumer(owner()));
    expect(v.nodes.bus.noReader).toBeUndefined();
    expect(v.addConsumer).toBeUndefined();
    expect(v.nodes.cfg?.offered ?? 0).toBe(0);
  });
});

describe("badge and hover-card words", () => {
  it.each([
    [{ role: "queue" }, { unit: "queued", row: "Queued" }],
    [
      { role: "queue", noConsumer: true },
      { unit: "queued", row: "Queued" },
    ],
    [{ role: "topic" }, { unit: "lag", row: "Lag (max group)" }],
    [
      { role: "topic", noConsumer: true },
      { lead: "Nobody reads this yet", unit: "kept", row: "Kept" },
    ],
    [
      { role: "stream", noConsumer: true },
      { lead: "Nobody reads this yet", unit: "kept", row: "Kept" },
    ],
  ])("%o", (s, words) => expect(heldWords(s)).toEqual(words));

  it("the engine says which brokers have no consumer: a topic with none has no lag at all", () => {
    for (const [d, expected] of [
      [owner(), true],
      [owner("queue"), true],
      [withConsumer(owner()), undefined],
    ] as const) {
      const engine = createEngine({ seed: 1 });
      engine.load(d);
      engine.inject("bus", 5);
      engine.step(2000);
      const s = engine.frame().nodes.bus;
      expect(s.noConsumer).toBe(expected);
      if (expected && s.role === "topic") {
        expect(s.lag).toEqual({});
        expect(s.backlog).toBe(5);
      }
    }
  });
});

describe("the Inputs panel's partitions note", () => {
  const raised = (d: DiagramFile, partitions: number) =>
    partitionsNotes(d, null, { ...emptyInputs(), props: { bus: { partitions } } }).get("bus");
  it("says nothing until partitions are raised", () => {
    expect(partitionsNotes(owner(), null, emptyInputs()).size).toBe(0);
  });
  it("no consumer: more partitions change nothing", () => {
    expect(raised(owner(), 9000)).toBe("Nobody reads it yet, so more partitions change nothing.");
  });
  it("fewer consumer replicas than partitions: the extra ones add no speed", () => {
    expect(raised(withConsumer(owner()), 6)).toBe("Its consumer group has 1 replica: partitions past 1 add no speed.");
    const d = withConsumer(owner());
    d.nodes[4].props = { replicas: 8 };
    expect(raised(d, 6)).toBeUndefined();
  });
  it("only for topics and streams", () => {
    expect(raised(owner("queue"), 6)).toBeUndefined();
  });
});

describe("slow motion and the trace", () => {
  const roleOf = (d: DiagramFile) => (id: string) => stencilRole(d.nodes.find((n) => n.id === id)?.stencil ?? "");
  it("a message kept by a topic nobody reads: 'kept in', and the trace card's journey knows where", () => {
    const d = owner();
    const trace = traceOnce(d, { from: "in" })!;
    expect(buildJourney(trace, d).kept).toEqual(["bus"]);
    const script = buildScript({ trace, diagram: d, roleOf: roleOf(d) });
    expect(script.beats.map((b) => b.caption).filter(Boolean)).toContain("kept in Orders: nobody reads it");
    expect(script.summary).toMatch(/^Kept in Orders, unread/);
  });
  it("a queue nobody reads parks it, as before", () => {
    const d = owner("queue");
    const trace = traceOnce(d, { from: "in" })!;
    const script = buildScript({ trace, diagram: d, roleOf: roleOf(d) });
    expect(script.beats.map((b) => b.caption).filter(Boolean)).toContain("parked in Orders");
    expect(script.summary).toMatch(/^Done/);
  });
});

describe("Checks agree", () => {
  it("a topic nobody reads keeps its messages; a queue's pile up", () => {
    const [topic] = runChecks(owner()).findings.filter((f) => f.rule === "no-reader");
    expect(topic).toMatchObject({ title: "Nobody reads Orders", severity: "warning" });
    expect(topic.message).toBe(
      ".NET Service publishes to Orders, but nothing consumes it: it keeps every message, unread.",
    );
    const [queue] = runChecks(owner("queue")).findings.filter((f) => f.rule === "no-reader");
    expect(queue.message).toBe(".NET Service sends to Orders, but nothing consumes it: messages pile up.");
  });
});
