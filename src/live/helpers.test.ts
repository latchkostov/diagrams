import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type Simulation } from "../model/types";
import { formatClock, formatCount, formatRate, formatSpeed, heatOf } from "./format";
import { PathCache, pointOnSamples, sampleIndex, samplePath, type PathLike } from "./pathSampler";
import { fractionToTime, placeMarkers, timeToFraction, trackLength, trafficBands } from "./timelineMath";
import {
  blankSimulation,
  createStormSimulation,
  defaultShape,
  knownMessageTypes,
  suggestedMessageType,
  uniqueSimId,
} from "./storm";
import { simulationWarnings } from "./validate";
import { downstreamOfEdge, edgesWithin } from "./graph";

const diagram = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "t",
  nodes: [
    { id: "api", stencil: "aws.api-gateway", label: "Signup API", x: 0, y: 0 },
    {
      id: "topic",
      stencil: "kafka.topic",
      label: "members",
      x: 0,
      y: 0,
      props: { emits: { MemberJoined: "WelcomeEmailRequested" } },
    },
    { id: "svc", stencil: "service.node", label: "welcome", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "db", x: 0, y: 0 },
  ],
  edges: [
    { id: "a", from: "api", to: "topic" },
    { id: "b", from: "topic", to: "svc", props: { filter: ["Member*", "AccountClosed"] } },
    { id: "c", from: "svc", to: "db" },
  ],
  ...extra,
});

describe("format", () => {
  it("keeps counts short", () => {
    expect([0, 7, 999, 1000, 1234, 9999, 15_300, 999_499, 2_500_000].map(formatCount)).toEqual([
      "0",
      "7",
      "999",
      "1k",
      "1.2k",
      "10k",
      "15k",
      "999k",
      "2.5M",
    ]);
    expect(formatCount(NaN)).toBe("–");
  });
  it("formats rates, clocks and speeds", () => {
    expect(formatRate(0.01)).toBe("0/s");
    expect(formatRate(3.25)).toBe("3.3/s");
    expect(formatRate(4)).toBe("4/s");
    expect(formatRate(42.4)).toBe("42/s");
    expect(formatClock(12_345)).toBe("12.3s");
    expect(formatClock(65_000)).toBe("1:05");
    expect([0.25, 1, 2, 8].map(formatSpeed)).toEqual(["0.25×", "1×", "2×", "8×"]);
  });
  it("heat rises quickly then saturates", () => {
    expect(heatOf(0)).toBe(0);
    expect(heatOf(5)).toBeGreaterThan(0.3);
    expect(heatOf(1000)).toBe(1);
  });
});

describe("path sampling", () => {
  // A horizontal line 0..100 then down 0..50: an L-shaped path of length 150.
  const pointAt = (l: number) => (l <= 100 ? { x: l, y: 0 } : { x: 100, y: l - 100 });

  it("samples evenly including both ends", () => {
    const s = samplePath(150, pointAt, 10);
    expect(s.points.length).toBe(16 * 2);
    expect([s.points[0], s.points[1]]).toEqual([0, 0]);
    expect([s.points[30], s.points[31]]).toEqual([100, 50]);
  });

  it("interpolates points by fraction and clamps", () => {
    const s = samplePath(150, pointAt, 10);
    const out = { x: 0, y: 0 };
    expect(pointOnSamples(s, 0.5, out)).toEqual({ x: 75, y: 0 });
    expect(pointOnSamples(s, 0.9, out)).toEqual({ x: 100, y: 35 });
    expect(pointOnSamples(s, 2, out)).toEqual({ x: 100, y: 50 });
    expect(pointOnSamples(s, -1, out)).toEqual({ x: 0, y: 0 });
    expect(sampleIndex(s, 0.5)).toBe(7);
  });

  it("survives zero-length paths", () => {
    const s = samplePath(0, () => ({ x: 3, y: 4 }));
    expect(pointOnSamples(s, 0.5, { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
  });

  it("caches per edge and re-samples only when the path changes", () => {
    let d = "M0 0 L100 0";
    let lengthCalls = 0;
    let connected = true;
    const el: PathLike = {
      getAttribute: () => d,
      getTotalLength: () => (lengthCalls++, d === "M0 0 L100 0" ? 100 : 200),
      getPointAtLength: (l) => ({ x: l, y: 0 }),
      get isConnected() {
        return connected;
      },
    };
    let resolves = 0;
    const cache = new PathCache((id) => (resolves++, id === "e1" ? el : null), 10);
    expect(cache.get("e1")!.length).toBe(100);
    cache.get("e1");
    expect(lengthCalls).toBe(1);
    d = "M0 0 L200 0"; // a node moved
    expect(cache.get("e1")!.length).toBe(200);
    expect(lengthCalls).toBe(2);
    // Missing edges are looked up at most once per frame.
    expect(cache.get("nope", 1)).toBeNull();
    expect(cache.get("nope", 1)).toBeNull();
    expect(resolves).toBe(2);
    // A remounted path element is resolved again.
    connected = false;
    cache.get("e1", 2);
    expect(resolves).toBe(3);
  });
});

describe("timeline mapping", () => {
  it("maps time and fractions both ways", () => {
    expect(timeToFraction(5000, 20_000)).toBe(0.25);
    expect(timeToFraction(30_000, 20_000)).toBe(1);
    expect(timeToFraction(10, 0)).toBe(0);
    expect(fractionToTime(0.25, 20_000)).toBe(5000);
    expect(fractionToTime(0.123456, 10_000)).toBe(1230);
    expect(trackLength(10_000, 12_000)).toBe(12_000);
  });

  it("stacks markers that would overlap and skips traffic markers", () => {
    const placed = placeMarkers(
      [
        { atMs: 0, kind: "note", label: "a" },
        { atMs: 100, kind: "status", label: "b" },
        { atMs: 0, kind: "traffic", label: "t" },
        { atMs: 5000, kind: "note", label: "c" },
      ],
      10_000,
    );
    expect(placed.map((m) => [m.label, m.row])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
    expect(placed[2].at).toBe(0.5);
  });

  it("turns traffic profiles into bands", () => {
    const sim: Simulation = {
      id: "s",
      title: "s",
      traffic: [
        { id: "b", node: "api", shape: { kind: "burst", count: 10, atMs: 1000, spreadMs: 1000 } },
        {
          id: "c",
          node: "api",
          label: "steady",
          shape: { kind: "constant", ratePerSec: 5, fromMs: 2000, durationMs: 4000 },
        },
      ],
    };
    const bands = trafficBands(sim, 10_000);
    expect(bands[0]).toMatchObject({ start: 0.1, end: 0.2, burst: true, label: "b" });
    expect(bands[1]).toMatchObject({ start: 0.2, end: 0.6, burst: false, label: "steady" });
  });
});

describe("storm creation", () => {
  it("creates a burst simulation at the node with a unique id", () => {
    const d = diagram({ simulations: [{ id: "storm-signup-api", title: "x", traffic: [] }] });
    const sim = createStormSimulation(d, "api");
    expect(sim.id).toBe("storm-signup-api-2");
    expect(sim.traffic).toEqual([
      {
        id: "storm",
        node: "api",
        messageType: "MemberJoined",
        label: "100 × MemberJoined",
        shape: { kind: "burst", count: 100, spreadMs: 3000 },
      },
    ]);
    expect(sim.title).toBe("100 MemberJoined at Signup API");
    expect(sim.timeline?.[0].action).toMatchObject({
      do: "note",
      text: "100 MemberJoined messages arrive at Signup API.",
    });
    expect(simulationWarnings(sim, d)).toEqual([]);
  });

  it("prefers an explicit messageType, then a saved simulation's type", () => {
    const d = diagram();
    d.nodes[0].props = { messageType: "SignupRequested" };
    expect(suggestedMessageType(d, "api")).toBe("SignupRequested");
    const d2 = diagram({
      simulations: [
        {
          id: "s",
          title: "s",
          traffic: [{ id: "t", node: "svc", messageType: "Hello", shape: { kind: "burst", count: 1 } }],
        },
      ],
    });
    expect(suggestedMessageType(d2, "svc")).toBe("Hello");
    expect(createStormSimulation(d2, "svc", { count: 5, messageType: "Custom" }).traffic[0]).toMatchObject({
      messageType: "Custom",
      shape: { count: 5 },
    });
  });

  it("collects known message types without wildcards", () => {
    expect(knownMessageTypes(diagram())).toEqual(["AccountClosed", "MemberJoined", "WelcomeEmailRequested"]);
  });

  it("builds unique ids and default shapes", () => {
    expect(uniqueSimId("Black Friday!", ["black-friday"])).toBe("black-friday-2");
    expect(uniqueSimId("", [])).toBe("simulation");
    expect(blankSimulation(diagram()).id).toBe("simulation");
    for (const kind of ["burst", "constant", "ramp", "spike"] as const) expect(defaultShape(kind).kind).toBe(kind);
  });
});

describe("simulation warnings", () => {
  it("flags missing nodes everywhere they can be referenced", () => {
    const sim: Simulation = {
      id: "s",
      title: "s",
      traffic: [{ id: "t", node: "gone", shape: { kind: "burst", count: 10 } }],
      timeline: [
        { atMs: 0, action: { do: "status", node: "ghost", status: "down" } },
        { atMs: 0, action: { do: "note", text: "hi", focus: ["api", "phantom"] } },
      ],
      expectations: [{ id: "e", label: "e", metric: { node: "nowhere", field: "processed" }, op: "==", value: 1 }],
    };
    const w = simulationWarnings(sim, diagram());
    expect(w.map((x) => x.where)).toEqual(["traffic:t", "timeline:0", "timeline:1", "expectation:e"]);
    expect(w[0].text).toContain("gone");
  });

  it("warns about simulations that send nothing", () => {
    expect(simulationWarnings({ id: "s", title: "s", traffic: [] }, diagram())[0].where).toBe("simulation");
  });
});

describe("graph walks", () => {
  it("finds everything downstream of an edge", () => {
    const d = diagram();
    const r = downstreamOfEdge(d.edges, "b");
    expect([...r.edges].sort()).toEqual(["b", "c"]);
    expect([...r.nodes].sort()).toEqual(["db", "svc", "topic"]);
    expect(downstreamOfEdge(d.edges, "missing").edges.size).toBe(0);
  });

  it("terminates on cycles", () => {
    const edges = [
      { id: "x", from: "a", to: "b" },
      { id: "y", from: "b", to: "a" },
    ];
    const r = downstreamOfEdge(edges, "x");
    expect([...r.edges].sort()).toEqual(["x", "y"]);
  });

  it("keeps edges inside a node set", () => {
    expect([...edgesWithin(diagram().edges, new Set(["api", "topic", "db"]))]).toEqual(["a"]);
  });
});
