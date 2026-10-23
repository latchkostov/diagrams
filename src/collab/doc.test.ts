import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { structuralText } from "../model/diagramDiff";
import type { DiagramFile } from "../model/types";
import { commandsFromDiff } from "./commands";
import { CollabDoc } from "./doc";
import { metaOf, recordsOf } from "./schema";

export const sample = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Orders",
  direction: "LR",
  groups: [{ id: "g1", label: "Cluster", x: 0, y: 0, width: 600, height: 400 }],
  nodes: [
    { id: "api", stencil: "aws.api-gateway", label: "API", x: 40, y: 40, group: "g1" },
    { id: "topic", stencil: "kafka.topic", label: "orders", x: 240, y: 40, props: { partitions: 6 } },
    { id: "db", stencil: "postgres", label: "DB", x: 440, y: 40 },
  ],
  edges: [
    { id: "e1", from: "api", to: "topic", kind: "async" },
    { id: "e2", from: "topic", to: "db", label: "store" },
  ],
  annotations: [{ id: "note", kind: "note", text: "Hello", x: 0, y: 500, width: 160, height: 80 }],
  simulations: [
    {
      id: "s1",
      title: "Storm",
      seed: 3,
      traffic: [{ id: "t", node: "api", shape: { kind: "burst", count: 10 } }],
    },
  ],
  layerOrder: ["note", "api"],
});

const diagramOf = (d: CollabDoc) => {
  const p = d.project();
  if (p.status !== "ok") throw new Error(p.error);
  return p.diagram;
};

/** One peer's step, the way the editor binding makes it: diff against what it last saw, apply. */
export function edit(doc: CollabDoc, change: (d: DiagramFile) => DiagramFile, merge?: string) {
  const before = diagramOf(doc);
  doc.apply(commandsFromDiff(before, change(structuredClone(before))), { merge });
}

function sync(...docs: CollabDoc[]) {
  for (const a of docs) for (const b of docs) if (a !== b) b.applyRemote(a.encodeDiff(b.stateVector()));
}

describe("CollabDoc projection", () => {
  it("round-trips a diagram through shared state unchanged", () => {
    const doc = new CollabDoc();
    doc.hydrate(sample());
    expect(structuralText(diagramOf(doc))).toBe(structuralText(sample()));
  });

  it("never shares private: a remote peer can't set or clear it", () => {
    const doc = new CollabDoc();
    doc.hydrate({ ...sample(), private: true });
    expect(diagramOf(doc).private).toBeUndefined();
    expect(() => doc.apply([{ op: "meta", set: { private: false } }])).toThrow();
  });

  it("re-reads only the records a remote change touched", () => {
    const a = new CollabDoc();
    a.hydrate(sample());
    const b = new CollabDoc();
    sync(a, b);
    diagramOf(b);
    const before = b.stats.recordsProjected;
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, label: "Ledger" } : n)) }));
    sync(a, b);
    expect(diagramOf(b).nodes.find((n) => n.id === "db")?.label).toBe("Ledger");
    expect(b.stats.recordsProjected - before).toBe(1);
  });

  it("keeps both people's edits to different fields and different props of one node", () => {
    const a = new CollabDoc();
    a.hydrate(sample());
    const b = new CollabDoc();
    sync(a, b);
    edit(a, (d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === "topic" ? { ...n, label: "orders.v2", props: { ...n.props, retention: 7 } } : n,
      ),
    }));
    edit(b, (d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === "topic" ? { ...n, x: 300, y: 90, props: { ...n.props, partitions: 12 } } : n,
      ),
    }));
    sync(a, b);
    const topic = diagramOf(a).nodes.find((n) => n.id === "topic");
    expect(topic).toMatchObject({ label: "orders.v2", x: 300, y: 90, props: { partitions: 12, retention: 7 } });
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });

  it("keeps both people's first settings on a node that had none, and an addition beside a removal of the last one", () => {
    const a = new CollabDoc({ clientId: 1 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    const setProps = (id: string, props: Record<string, unknown> | undefined) => (d: DiagramFile) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, props } : n)),
    });
    edit(a, setProps("db", { replicas: 3 }));
    edit(b, setProps("db", { concurrency: 4 }));
    sync(a, b);
    expect(diagramOf(a).nodes.find((n) => n.id === "db")?.props).toEqual({ concurrency: 4, replicas: 3 });
    // A removes the topic's only setting while B adds another: B's addition stays.
    edit(a, setProps("topic", undefined));
    edit(b, setProps("topic", { partitions: 6, retention: 7 }));
    sync(a, b);
    for (const d of [a, b]) expect(diagramOf(d).nodes.find((n) => n.id === "topic")?.props).toEqual({ retention: 7 });
  });

  it("moves are atomic: x and y come from the same person", () => {
    const a = new CollabDoc({ clientId: 1 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 1000 } : n)) }));
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, y: 1000 } : n)) }));
    sync(a, b);
    const db = diagramOf(a).nodes.find((n) => n.id === "db")!;
    expect([
      [1000, 40],
      [440, 1000],
    ]).toContainEqual([db.x, db.y]);
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });

  it("hides an edge whose end was deleted concurrently, keeps its record, and converges", () => {
    const a = new CollabDoc();
    a.hydrate(sample());
    const b = new CollabDoc();
    sync(a, b);
    edit(a, (d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== "db"),
      edges: d.edges.filter((e) => e.to !== "db"),
    }));
    edit(b, (d) => ({ ...d, edges: [...d.edges, { id: "e3", from: "api", to: "db" }] }));
    sync(a, b);
    for (const doc of [a, b]) {
      const p = doc.project();
      expect(p.status).toBe("ok");
      expect(p.hidden).toEqual(["e3"]);
      expect(recordsOf(doc.ydoc, "edges").has("e3")).toBe(true);
    }
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });

  it("reports concurrent additions past the node limit as invalid on every peer, keeping the last valid diagram", () => {
    const base: DiagramFile = {
      format: "diagrams/v1",
      title: "Big",
      nodes: Array.from({ length: 4_000 }, (_, i) => ({ id: `n${i}`, stencil: "postgres", label: "", x: i, y: 0 })),
      edges: [],
    };
    const a = new CollabDoc();
    a.hydrate(base);
    const b = new CollabDoc();
    sync(a, b);
    const add = (prefix: string) => (d: DiagramFile) => ({
      ...d,
      nodes: [
        ...d.nodes,
        ...Array.from({ length: 600 }, (_, i) => ({ id: `${prefix}${i}`, stencil: "postgres", label: "", x: 0, y: i })),
      ],
    });
    edit(a, add("a"));
    edit(b, add("b"));
    sync(a, b);
    for (const doc of [a, b]) {
      const p = doc.project();
      expect(p.status).toBe("invalid");
      if (p.status === "invalid") {
        expect(p.error).toMatch(/limit is 5000/);
        // The last valid diagram this peer happened to project: local history, but never past the limit.
        expect([4_000, 4_600]).toContain(p.diagram?.nodes.length);
      }
      expect((doc.recoveryExport().nodes as unknown[]).length).toBe(5_200);
    }
  });

  it("orders lists deterministically when two people reorder and add at once", () => {
    const a = new CollabDoc({ clientId: 10 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 20 });
    sync(a, b);
    edit(a, (d) => ({ ...d, nodes: [...d.nodes].reverse() }));
    edit(b, (d) => ({ ...d, nodes: [...d.nodes, { id: "cache", stencil: "redis", label: "Cache", x: 0, y: 200 }] }));
    sync(a, b);
    const ids = diagramOf(a).nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(diagramOf(b).nodes.map((n) => n.id));
  });

  it("a stale peer's whole-diagram copy can't revert changes it never saw (diffs are against its own base)", () => {
    const a = new CollabDoc();
    a.hydrate(sample());
    const b = new CollabDoc();
    sync(a, b);
    edit(a, (d) => ({ ...d, title: "Renamed by A" }));
    // b hasn't received A's rename; its step changes a node only.
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "api" ? { ...n, label: "Edge API" } : n)) }));
    sync(a, b);
    expect(diagramOf(b).title).toBe("Renamed by A");
    expect(diagramOf(a).nodes[0].label).toBe("Edge API");
  });
});

describe("CollabDoc sync replies", () => {
  it("splits a large reply by client into parts that rebuild the same state", () => {
    const a = new CollabDoc({ clientId: 1 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    for (let i = 0; i < 20; i++)
      edit(b, (d) => ({
        ...d,
        nodes: [...d.nodes, { id: `b${i}`, stencil: "postgres", label: "x".repeat(500), x: i, y: 0 }],
      }));
    sync(a, b);
    const whole = a.encodeDiff();
    const parts = a.encodeDiffParts(undefined, Math.floor(whole.length / 2));
    expect(parts.length).toBe(2);
    const c = new CollabDoc({ clientId: 3 });
    for (const p of [...parts].reverse()) expect(c.applyRemote(p).ok).toBe(true);
    expect(structuralText(diagramOf(c))).toBe(structuralText(diagramOf(a)));
    // What a peer already has isn't sent again.
    expect(a.encodeDiffParts(c.stateVector(), 10)).toHaveLength(1);
  });
});

describe("CollabDoc Undo is per person", () => {
  const setup = () => {
    const a = new CollabDoc({ clientId: 1 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    return { a, b };
  };
  const label = (d: CollabDoc, id: string) => diagramOf(d).nodes.find((n) => n.id === id)?.label;

  it("nobody's first Undo empties the room: the initial copy isn't undoable", () => {
    const { a } = setup();
    expect(a.canUndo()).toBe(false);
    expect(a.undo()).toBe(false);
    expect(diagramOf(a).nodes).toHaveLength(3);
  });

  it("undoes my edit and leaves the other person's edit to the same node", () => {
    const { a, b } = setup();
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, label: "Mine" } : n)) }));
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 999 } : n)) }));
    sync(a, b);
    expect(a.undo()).toBe(true);
    sync(a, b);
    for (const d of [a, b]) {
      expect(label(d, "db")).toBe("DB");
      expect(diagramOf(d).nodes.find((n) => n.id === "db")?.x).toBe(999);
    }
  });

  it("never undoes another person's edit", () => {
    const { a, b } = setup();
    edit(b, (d) => ({ ...d, title: "B's title" }));
    sync(a, b);
    expect(a.undo()).toBe(false);
    expect(diagramOf(a).title).toBe("B's title");
  });

  it("merges steps only under the same explicit tag", () => {
    const { a } = setup();
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, label: "L" } : n)) }), "label:db");
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, label: "Le" } : n)) }), "label:db");
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, label: "Led" } : n)) }), "label:db");
    edit(a, (d) => ({ ...d, title: "T" }));
    a.undo();
    expect(diagramOf(a).title).toBe("Orders");
    expect(label(a, "db")).toBe("Led");
    a.undo();
    expect(label(a, "db")).toBe("DB");
    a.redo();
    expect(label(a, "db")).toBe("Led");
  });

  it("same-field concurrent edits converge, and undoing mine converges too", () => {
    const { a, b } = setup();
    edit(a, (d) => ({ ...d, title: "A" }));
    edit(b, (d) => ({ ...d, title: "B" }));
    sync(a, b);
    const winner = diagramOf(a).title;
    expect(["A", "B"]).toContain(winner);
    expect(diagramOf(b).title).toBe(winner);
    a.undo();
    sync(a, b);
    expect(diagramOf(a).title).toBe(diagramOf(b).title);
    // Undo removes A's value: B's stays, or (when A's had overwritten it) the value before A's edit comes back.
    // Never no value at all.
    expect(["B", "Orders"]).toContain(diagramOf(a).title);
    expect(metaOf(a.ydoc).has("title")).toBe(true);
  });

  it.each([1, 3])("undo then redo of a concurrent same-field edit returns to where it was (A's client id %i)", (id) => {
    const a = new CollabDoc({ clientId: id });
    a.hydrate(sample());
    expect(a.ydoc.clientID).toBe(id);
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    edit(a, (d) => ({ ...d, title: "A" }));
    edit(b, (d) => ({ ...d, title: "B" }));
    sync(a, b);
    const before = structuralText(diagramOf(a));
    // When B's value won, A's edit is already invisible and Undo has nothing to do.
    a.undo();
    sync(a, b);
    expect(metaOf(a.ydoc).has("title")).toBe(true);
    if (structuralText(diagramOf(a)) !== before) {
      expect(a.canRedo()).toBe(true);
      expect(a.redo()).toBe(true);
    } else a.redo();
    sync(a, b);
    expect(structuralText(diagramOf(a))).toBe(before);
    expect(structuralText(diagramOf(b))).toBe(before);
  });

  it.each([1, 3])("undo then redo of a concurrent move restores the move (A's client id %i)", (id) => {
    const a = new CollabDoc({ clientId: id });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 1 } : n)) }));
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 2 } : n)) }));
    sync(a, b);
    const before = structuralText(diagramOf(a));
    a.undo();
    sync(a, b);
    expect(a.project().hidden).toEqual([]);
    a.redo();
    sync(a, b);
    expect(structuralText(diagramOf(a))).toBe(before);
    expect(structuralText(diagramOf(b))).toBe(before);
  });

  it.each([1, 2])("undo after a concurrent move never leaves a node without a position (client order %i)", (order) => {
    const a = new CollabDoc({ clientId: order === 1 ? 1 : 3 });
    a.hydrate(sample());
    const b = new CollabDoc({ clientId: 2 });
    sync(a, b);
    edit(a, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 1 } : n)) }));
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "db" ? { ...n, x: 2 } : n)) }));
    sync(a, b);
    a.undo();
    b.undo();
    sync(a, b);
    for (const d of [a, b]) {
      expect(d.project().hidden).toEqual([]);
      expect(diagramOf(d).nodes.map((n) => n.id)).toContain("db");
    }
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });

  it("undo of my delete restores the node on every peer", () => {
    const { a, b } = setup();
    edit(a, (d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== "db"),
      edges: d.edges.filter((e) => e.to !== "db"),
    }));
    sync(a, b);
    expect(diagramOf(b).nodes.map((n) => n.id)).not.toContain("db");
    a.undo();
    sync(a, b);
    for (const d of [a, b]) {
      expect(diagramOf(d).nodes.map((n) => n.id)).toContain("db");
      expect(diagramOf(d).edges.map((e) => e.id)).toContain("e2");
    }
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });

  it("undo of my creation after someone renamed it removes the node everywhere (my operation, theirs inside it)", () => {
    const { a, b } = setup();
    edit(a, (d) => ({ ...d, nodes: [...d.nodes, { id: "cache-a1", stencil: "redis", label: "Cache", x: 0, y: 300 }] }));
    sync(a, b);
    edit(b, (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "cache-a1" ? { ...n, label: "Hot cache" } : n)) }));
    sync(a, b);
    a.undo();
    sync(a, b);
    for (const d of [a, b]) expect(diagramOf(d).nodes.map((n) => n.id)).not.toContain("cache-a1");
    // B's rename lived inside A's node: B has nothing visible left to undo, and undoing it changes nothing.
    b.undo();
    sync(a, b);
    expect(structuralText(diagramOf(a))).toBe(structuralText(diagramOf(b)));
  });
});

describe("CollabDoc refuses hostile updates before they touch the document", () => {
  const hostile = (write: (doc: Y.Doc) => void) => {
    const evil = new Y.Doc();
    write(evil);
    return Y.encodeStateAsUpdate(evil);
  };

  it.each([
    ["an unknown root", (d: Y.Doc) => d.getMap("evil").set("x", 1), "unknown-root"],
    ["a text type", (d: Y.Doc) => recordsOfDoc(d).set("n", new Y.Text("x")), "forbidden-content"],
    ["a subdocument", (d: Y.Doc) => recordsOfDoc(d).set("n", new Y.Doc()), "forbidden-content"],
    ["binary content", (d: Y.Doc) => recordsOfDoc(d).set("n", new Uint8Array([1, 2])), "forbidden-content"],
    ["an over-long string", (d: Y.Doc) => d.getMap("meta").set("title", "x".repeat(100_001)), "string-too-long"],
    ["an over-long key", (d: Y.Doc) => d.getMap("meta").set("k".repeat(300), 1), "key-too-long"],
    ["a deeply nested value", (d: Y.Doc) => d.getMap("meta").set("planning", deep(40)), "too-deep"],
  ])("%s", (_name, write, problem) => {
    const doc = new CollabDoc();
    doc.hydrate(sample());
    const before = structuralText(diagramOf(doc));
    expect(doc.applyRemote(hostile(write))).toEqual({ ok: false, problem });
    expect(structuralText(diagramOf(doc))).toBe(before);
    expect(doc.stats.remoteRefused).toBe(1);
  });

  it("refuses garbage bytes", () => {
    const doc = new CollabDoc();
    expect(doc.applyRemote(new Uint8Array([255, 255, 255, 255, 1, 2, 3])).ok).toBe(false);
  });

  it("projects records of the wrong shape as absent, the same on every peer", () => {
    const doc = new CollabDoc();
    doc.hydrate(sample());
    doc.project();
    const result = doc.applyRemote(
      hostile((d) => {
        d.getMap("nodes").set("weird", 42);
        d.getMap("nodes").set("noStencil", new Y.Map());
      }),
    );
    expect(result.ok).toBe(true);
    const p = doc.project();
    // Not a map: not a record at all. A map without a stencil or position: an incomplete record, hidden and kept.
    expect(p.status).toBe("ok");
    expect(p.diagram?.nodes.map((n) => n.id)).toEqual(["api", "topic", "db"]);
    expect(p.hidden).toEqual(["noStencil"]);
  });
});

const recordsOfDoc = (d: Y.Doc) => d.getMap("nodes");
function deep(n: number): unknown {
  let v: unknown = 1;
  for (let i = 0; i < n; i++) v = { v };
  return v;
}

it("stores waypoints atomically, converges concurrent edits and validates hostile lists", () => {
  const a = new CollabDoc(),
    b = new CollabDoc();
  const d = sample();
  d.edges[0].waypoints = [
    { x: 100, y: 200 },
    { x: 300, y: 200 },
  ];
  a.hydrate(d);
  sync(a, b);
  expect(diagramOf(b).edges[0].waypoints).toEqual(d.edges[0].waypoints);
  const wa = [
      { x: 100, y: -100 },
      { x: 300, y: -100 },
    ],
    wb = [{ x: 100, y: 500 }];
  edit(a, (d) => {
    d.edges[0].waypoints = wa;
    return d;
  });
  edit(b, (d) => {
    d.edges[0].waypoints = wb;
    d.edges[0].to = "db";
    return d;
  });
  sync(a, b);
  const result = diagramOf(a).edges[0];
  expect(result).toEqual(diagramOf(b).edges[0]);
  expect([wa, wb]).toContainEqual(result.waypoints);
  expect(result.to).toBe("db");
  edit(a, (d) => {
    d.edges[0].waypoints = Array.from({ length: 65 }, () => ({ x: 0, y: 0 }));
    return d;
  });
  sync(a, b);
  expect(diagramOf(a).edges[0].waypoints).toBeUndefined();
  expect(diagramOf(b).edges[0].waypoints).toBeUndefined();
});

it("projects waypoints after pinned sides and before props", () => {
  const doc = new CollabDoc();
  const d = sample();
  Object.assign(d.edges[0], {
    props: { travelMs: 10 },
    waypoints: [{ x: 100, y: 200 }],
    targetSide: "left",
    sourceSide: "right",
  });
  doc.hydrate(d);
  const keys = Object.keys(diagramOf(doc).edges[0]);
  expect(keys.indexOf("waypoints")).toBeGreaterThan(keys.indexOf("targetSide"));
  expect(keys.indexOf("props")).toBeGreaterThan(keys.indexOf("waypoints"));
});
