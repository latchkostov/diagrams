import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { exceedsDepth, LIMITS, MIGRATIONS, parseNative, preserveUnknown, validateDiagram } from "./native";
import { createSimulationRun } from "../sim/simulation";
import { fromFlow, toFlow } from "../canvas/convert";

const base = {
  format: "diagrams/v1",
  title: "T",
  nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }],
  edges: [],
};

describe("native format validation", () => {
  it("accepts a minimal file and fills defaults", () => {
    const r = parseNative(JSON.stringify({ ...base, title: "" }));
    expect(r.ok && r.diagram.title).toBe("Untitled diagram");
  });

  it("gives specific, friendly errors", () => {
    const err = (v: unknown) => {
      const r = typeof v === "string" ? parseNative(v) : validateDiagram(v);
      return r.ok ? "" : r.error;
    };
    expect(err("{ nope")).toMatch(/isn't valid JSON/);
    expect(err([])).toMatch(/diagram object/);
    expect(err({ ...base, format: "drawio" })).toMatch(/Expected format "diagrams\/v1", but it was "drawio"/);
    expect(err({ ...base, format: undefined })).toMatch(/it was missing/);
    expect(err({ ...base, format: "diagrams/v9" })).toMatch(/newer than this version/);
    expect(err({ ...base, nodes: [{ id: "a", stencil: "x", x: "1", y: 0 }] })).toMatch(/Node #1 \("a"\)/);
    expect(err({ ...base, edges: [{ id: "e", from: "a", to: "ghost" }] })).toMatch(/points at a node.*"ghost"/);
  });

  it("repairs what it safely can, with warnings", () => {
    const r = validateDiagram({
      ...base,
      direction: "diagonal",
      groups: [{ id: "g", label: "G", x: 0, y: 0, width: 10, height: 10 }, { id: "bad" }],
      nodes: [
        { ...base.nodes[0], group: "missing" },
        { id: "b", stencil: "aws.sqs", label: 7, x: 1, y: 1 },
      ],
      edges: [
        { id: "e", from: "a", to: "b", kind: "weird" },
        { id: "e", from: "b", to: "a" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.direction).toBeUndefined();
    expect(r.diagram.groups).toHaveLength(1);
    expect(r.diagram.nodes[0].group).toBeUndefined();
    expect(r.diagram.nodes[1].label).toBe("7");
    expect(r.diagram.edges.map((e) => e.id)).toEqual(["e", "e-2"]);
    expect(r.diagram.edges[0].kind).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps unknown fields", () => {
    const r = validateDiagram({ ...base, theme: "neon", nodes: [{ ...base.nodes[0], owner: "team-a" }] });
    expect(r.ok && (r.diagram as unknown as Record<string, unknown>).theme).toBe("neon");
    expect(r.ok && (r.diagram.nodes[0] as unknown as Record<string, unknown>).owner).toBe("team-a");
  });

  it("runs registered migrations", () => {
    MIGRATIONS["diagrams/v0"] = (raw) => ({ ...raw, format: "diagrams/v1", nodes: raw.boxes, edges: [] });
    try {
      const r = validateDiagram({ format: "diagrams/v0", title: "Old", boxes: base.nodes });
      expect(r.ok && r.diagram.nodes[0].id).toBe("a");
    } finally {
      delete MIGRATIONS["diagrams/v0"];
    }
  });
});

describe("preserveUnknown", () => {
  it("re-attaches unknown fields the canvas dropped", () => {
    const original = {
      ...base,
      theme: "neon",
      nodes: [{ ...base.nodes[0], owner: "team-a" }],
      edges: [],
      groups: [{ id: "g", label: "G", x: 0, y: 0, width: 1, height: 1, collapsed: true }],
    } as unknown as DiagramFile;
    const current: DiagramFile = {
      format: "diagrams/v1",
      title: "Edited",
      nodes: [
        { id: "a", stencil: "kafka.topic", label: "A2", x: 5, y: 5 },
        { id: "new", stencil: "aws.sqs", label: "N", x: 0, y: 0 },
      ],
      edges: [],
      groups: [{ id: "g", label: "G", x: 0, y: 0, width: 1, height: 1 }],
    };
    const out = preserveUnknown(current, original) as unknown as {
      theme: string;
      title: string;
      nodes: Record<string, unknown>[];
      groups: Record<string, unknown>[];
    };
    expect(out.theme).toBe("neon");
    expect(out.title).toBe("Edited");
    expect(out.nodes[0]).toMatchObject({ label: "A2", owner: "team-a" });
    expect(out.nodes[1].owner).toBeUndefined();
    expect(out.groups[0].collapsed).toBe(true);
    expect(preserveUnknown(current, undefined)).toBe(current);
  });
});

describe("review regressions: malformed input never reaches the canvas", () => {
  const renders = (d: DiagramFile) => {
    const f = toFlow(d);
    return fromFlow(f.meta, f.nodes, f.edges);
  };

  it("drops malformed groups (groups: {}, [null], bad geometry) instead of crashing toFlow", () => {
    for (const groups of [
      {},
      [null],
      [{ id: "g", label: "G", x: 0, y: 0, width: "wide", height: 1 }],
      [{ id: "g", x: 0, y: 0, width: -5, height: 5 }],
    ]) {
      const r = validateDiagram({ ...base, groups });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.diagram.groups).toBeUndefined();
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(() => renders(r.diagram)).not.toThrow();
    }
  });

  it("coerces object-valued text so React can render it", () => {
    const r = validateDiagram({
      ...base,
      title: { x: 1 },
      description: { y: 2 },
      groups: [{ id: "g", label: { z: 3 }, x: 0, y: 0, width: 10, height: 10 }],
      nodes: [{ ...base.nodes[0], label: { a: 1 }, sublabel: ["b"] }],
      edges: [{ id: "e", from: "a", to: "a", label: { c: 1 }, sourceSide: "middle" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.title).toBe("Untitled diagram");
    expect(r.diagram.description).toBeUndefined();
    expect(r.diagram.groups![0].label).toBe("");
    expect(r.diagram.nodes[0].label).toBe("");
    expect(r.diagram.nodes[0].sublabel).toBeUndefined();
    expect(r.diagram.edges[0].label).toBeUndefined();
    expect(r.diagram.edges[0].sourceSide).toBeUndefined();
    expect(() => renders(r.diagram)).not.toThrow();
  });

  it("rejects non-finite coordinates", () => {
    const r = validateDiagram({ ...base, nodes: [{ ...base.nodes[0], x: Infinity }] });
    expect(r.ok).toBe(false);
  });

  it("keeps well-formed simulations and drops malformed ones with a reason", () => {
    const good = {
      id: "s",
      title: "Burst",
      traffic: [{ id: "t", node: "a", shape: { kind: "burst", count: 5 } }],
      expectations: [{ id: "x", label: "ok", metric: { system: "inSystem" }, op: "==", value: 0 }],
    };
    const r = validateDiagram({
      ...base,
      simulations: [
        good,
        { id: "bad-shape", title: "x", traffic: [{ id: "t", node: "a", shape: { kind: "tsunami" } }] },
        { id: "ghost", title: "x", traffic: [{ id: "t", node: "nope", shape: { kind: "burst", count: 1 } }] },
        {
          id: "nan",
          title: "x",
          traffic: [{ id: "t", node: "a", shape: { kind: "constant", ratePerSec: "fast", durationMs: 1 } }],
        },
        {
          id: "steps",
          title: "x",
          traffic: [],
          timeline: [{ atMs: 0, action: { do: "status", node: "a", status: "exploded" } }],
        },
        "nonsense",
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.simulations?.map((sim) => sim.id)).toEqual(["s", "ghost"]);
    expect(r.warnings.filter((w) => /Simulation/.test(w))).toHaveLength(5);
  });

  it("bounds size, nesting and entity counts", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 200; i++) deep = (deep.next = {}) as Record<string, unknown>;
    const nested = validateDiagram({ ...base, nodes: [{ ...base.nodes[0], props: root }] });
    expect(nested.ok === false && nested.error).toMatch(/nested too deeply/);

    const many = validateDiagram({
      ...base,
      nodes: Array.from({ length: LIMITS.maxNodes + 1 }, (_, i) => ({
        id: `n${i}`,
        stencil: "x",
        label: "",
        x: 0,
        y: 0,
      })),
    });
    expect(many.ok === false && many.error).toMatch(/limit is 5000/);

    const huge = parseNative(" ".repeat(LIMITS.maxTextChars + 1));
    expect(huge.ok === false && huge.error).toMatch(/too large/);
    expect(exceedsDepth({ a: [{ b: 1 }] }, 2)).toBe(true);
    expect(exceedsDepth({ a: [1] }, 2)).toBe(false);
  });
});

describe("simulation boundary regressions", () => {
  const simulation = { id: "s", title: "S", traffic: [] };
  const accepted = (sim: unknown) => {
    const r = validateDiagram({ ...base, simulations: [sim] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const malformed: unknown[] = [
    ...["a", {}, [1]].map((focus) => ({
      ...simulation,
      timeline: [{ atMs: 0, action: { do: "note", text: "N", focus } }],
    })),
    { ...simulation, timeline: [{ atMs: 0, action: { do: "note", text: "N", pause: "yes" } }] },
    ...[
      { kind: "burst" },
      { kind: "burst", count: -1 },
      { kind: "constant", durationMs: 1 },
      { kind: "ramp", stages: [{}] },
      { kind: "spike", baseRate: 1 },
    ].map((shape) => ({ ...simulation, traffic: [{ id: "t", node: "a", shape }] })),
    ...["label", "messageType"].map((field) => ({
      ...simulation,
      traffic: [{ id: "t", node: "a", [field]: {}, shape: { kind: "burst", count: 1 } }],
    })),
    ...[
      { do: "props", node: "a", props: [] },
      { do: "props", node: "a", props: { emits: { A: {} } } },
      { do: "inject", node: "a" },
      { do: "inject", node: "a", count: 1, messageType: {} },
      { do: "inject", node: "a", count: 1, spreadMs: "soon" },
    ].map((action) => ({ ...simulation, timeline: [{ atMs: 0, action }] })),
    ...[{ system: "anything" }, { node: "a", field: "anything" }, { node: "a", field: "lag", group: {} }].map(
      (metric) => ({ ...simulation, expectations: [{ id: "e", label: "E", metric, op: "==", value: 1 }] }),
    ),
    ...[
      { op: "!=", when: "end" },
      { op: "==", when: "later" },
      { op: "==", when: "at" },
      { op: "==", when: "at", atMs: "soon" },
      { op: "==", label: {} },
    ].map((patch) => ({
      ...simulation,
      expectations: [{ id: "e", label: "E", metric: { system: "inSystem" }, value: 1, ...patch }],
    })),
    { ...simulation, setup: { status: { a: "exploded" } } },
    { ...simulation, setup: { props: { a: { messageType: [] } } } },
    { ...simulation, multipliers: { traffic: "fast" } },
    { ...simulation, scale: 0 },
    { ...simulation, description: {} },
  ];
  it.each(malformed.map((sim, i) => [i, sim] as const))(
    "drops malformed union payload %i before the runner",
    (_i, sim) => {
      const r = accepted(sim);
      expect(r.diagram.simulations).toBeUndefined();
      expect(r.warnings.join(" ")).toMatch(/skipped/);
    },
  );

  it("preserves missing-node traffic, narration, setup and expectations with diagnostics", () => {
    const sim = {
      ...simulation,
      traffic: [{ id: "t", node: "deleted", shape: { kind: "burst", count: 1 } }],
      timeline: [{ atMs: 0, action: { do: "note", text: "N", focus: ["deleted"], pause: true } }],
      setup: { status: { deleted: "down" }, props: { deleted: { concurrency: 1 } } },
      expectations: [{ id: "e", label: "E", metric: { node: "deleted", field: "processed" }, op: "==", value: 0 }],
    };
    const r = accepted(sim);
    expect(r.diagram.simulations).toEqual([sim]);
    expect(r.warnings.join(" ")).toMatch(/missing node/);
    expect(r.warnings.join(" ")).not.toMatch(/skipped/);
    expect(() => createSimulationRun(r.diagram, r.diagram.simulations![0])).not.toThrow();
  });

  it("accepts every complete variant and initializes the runner", () => {
    const sim = {
      ...simulation,
      seed: 1,
      scale: 2,
      multipliers: { traffic: 1, capacity: 1 },
      durationMs: 100,
      traffic: [
        { id: "b", node: "a", shape: { kind: "burst", count: 1, spreadMs: 50, atMs: 1 } },
        { id: "c", node: "a", shape: { kind: "constant", ratePerSec: 1, durationMs: 100 } },
        { id: "r", node: "a", shape: { kind: "ramp", startRate: 1, stages: [{ durationMs: 100, targetRate: 2 }] } },
        {
          id: "s",
          node: "a",
          shape: { kind: "spike", baseRate: 1, peakRate: 2, atMs: 1, peakMs: 50, durationMs: 100 },
        },
      ],
      timeline: [
        { atMs: 0, action: { do: "props", node: "a", props: { emits: { "*": "B" } } } },
        { atMs: 1, action: { do: "inject", node: "a", count: 1, messageType: "B" } },
        { atMs: 2, action: { do: "status", node: "a", status: "up" } },
        { atMs: 3, action: { do: "note", text: "N", focus: ["a"], pause: false } },
      ],
      expectations: [
        {
          id: "e",
          label: "E",
          metric: { node: "a", field: "lag", group: "g" },
          op: ">=",
          value: 0,
          when: "at",
          atMs: 10,
        },
      ],
    };
    const r = accepted(sim);
    expect(r.diagram.simulations).toEqual([sim]);
    expect(r.warnings).toEqual([]);
    const run = createSimulationRun(r.diagram, r.diagram.simulations![0]);
    expect(() => run.step(100)).not.toThrow();
  });

  it("bounds finite counts and rates before playback", () => {
    for (const shape of [
      { kind: "burst", count: 1e20 },
      { kind: "constant", ratePerSec: 1e20, durationMs: 1 },
    ]) {
      expect(accepted({ ...simulation, traffic: [{ id: "t", node: "a", shape }] }).diagram.simulations).toBeUndefined();
    }
    expect(
      accepted({ ...simulation, timeline: [{ atMs: 0, action: { do: "inject", node: "a", count: 1e20 } }] }).diagram
        .simulations,
    ).toBeUndefined();
  });

  it("enforces document-wide counts and volume before traversing payloads", () => {
    const steps = Array.from({ length: Math.floor(LIMITS.maxTimelineSteps / 2) + 1 }, () => ({
      atMs: 0,
      action: { do: "note", text: "N" },
    }));
    const sims = [1, 2].map((id) => ({ ...simulation, id: String(id), timeline: steps }));
    expect(validateDiagram({ ...base, simulations: sims }).ok).toBe(false);
    const traffic = [{ id: "t", node: "a", shape: { kind: "burst", count: LIMITS.maxMessageCount } }];
    expect(
      validateDiagram({ ...base, simulations: [1, 2, 3].map((id) => ({ ...simulation, id: String(id), traffic })) }).ok,
    ).toBe(false);
    for (const patch of [
      { traffic: Array.from({ length: LIMITS.maxTrafficProfiles + 1 }, () => traffic[0]) },
      {
        expectations: Array.from({ length: LIMITS.maxExpectations + 1 }, () => ({
          id: "e",
          label: "E",
          metric: { system: "inSystem" },
          op: "==",
          value: 0,
        })),
      },
      {
        traffic: [
          {
            id: "r",
            node: "a",
            shape: {
              kind: "ramp",
              stages: Array.from({ length: LIMITS.maxRampStages + 1 }, () => ({ durationMs: 0, targetRate: 0 })),
            },
          },
        ],
      },
      {
        traffic: [
          {
            id: "c",
            node: "a",
            shape: { kind: "constant", durationMs: LIMITS.maxSimulationMs, ratePerSec: LIMITS.maxRatePerSec },
          },
        ],
      },
    ])
      expect(validateDiagram({ ...base, simulations: [{ ...simulation, ...patch }] }).ok).toBe(false);
  });

  it("rejects coordinates and node emission rates unsafe for synchronous consumers", () => {
    expect(validateDiagram({ ...base, nodes: [{ ...base.nodes[0], x: 1e20 }] }).ok).toBe(false);
    expect(validateDiagram({ ...base, nodes: [{ ...base.nodes[0], props: { ratePerSec: 1e20 } }] }).ok).toBe(false);
  });
});
