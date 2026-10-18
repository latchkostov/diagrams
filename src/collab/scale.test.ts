import { describe, expect, it, vi } from "vitest";
import { annotatedPipeline } from "../bench/workloads/annotated";
import { serviceMesh } from "../bench/workloads/mesh";
import type { DiagramFile } from "../model/types";
import { GROWTH_FACTOR, countingReads, LINEAR_LIMIT } from "../test/complexity";
import { validateDiagram } from "../interop/native";
import { commandsFromDiff } from "./commands";
import { CollabDoc } from "./doc";
import * as Y from "yjs";
import { COLLAB_LIMITS } from "./limits";

// 5,000-node and churn measurements (docs/QUALITY.md § Timing in tests): operation counts, bytes and same-run growth
// ratios, never milliseconds. Sizes: 625 and 5,000 nodes (GROWTH_FACTOR apart), from the benchmark generators.
// GROWTH_LOG=1 prints the ratios; COLLAB_SCALE_LOG=1 prints the byte and count measurements below.

const SMALL = 5_000 / GROWTH_FACTOR;
const LARGE = 5_000;
const log = (...args: unknown[]) => {
  if (process.env.COLLAB_SCALE_LOG) console.log(...args);
};

const mesh = { small: serviceMesh(SMALL), large: serviceMesh(LARGE) };

function hydrated(d: DiagramFile, clientId = 1) {
  const doc = new CollabDoc({ clientId });
  doc.hydrate(d);
  return doc;
}

function joined(from: CollabDoc, clientId: number) {
  const doc = new CollabDoc({ clientId });
  doc.applyRemote(from.encodeDiff());
  return doc;
}

const ok = (doc: CollabDoc) => {
  const p = doc.project();
  if (p.status !== "ok") throw new Error(p.error);
  return p.diagram;
};

const relabel = (d: DiagramFile, i: number): DiagramFile => ({
  ...d,
  nodes: d.nodes.map((n, j) => (j === 0 ? { ...n, label: `renamed ${i}` } : n)),
});

describe("collaboration at 5,000 nodes", () => {
  it("fits a full 5,000-node room in one document message (sent as 1 MiB fragments)", () => {
    for (const d of [mesh.large, annotatedPipeline(LARGE)]) {
      const bytes = hydrated(d).encodeDiff().length;
      log(`full state, ${d.nodes.length} nodes / ${d.edges.length} edges: ${bytes} bytes`);
      expect(bytes).toBeLessThan(COLLAB_LIMITS.maxMessageBytes / 8);
    }
  });

  it("round-trips the workloads unchanged, on the creator and on a peer that joined", () => {
    for (const d of [mesh.small, annotatedPipeline(SMALL)]) {
      // What the import validator makes of the workload is what a room must show: nothing dropped or reordered.
      const expected = validateDiagram(structuredClone(d));
      if (!expected.ok) throw new Error(expected.error);
      const creator = hydrated(d);
      expect(ok(creator)).toEqual(expected.diagram);
      expect(ok(joined(creator, 2))).toEqual(expected.diagram);
    }
  });

  it("one edit is one command, a constant-size update and one record re-read, at either size", () => {
    const measure = (d: DiagramFile) => {
      const a = hydrated(d, 1);
      const b = joined(a, 2);
      const base = ok(a);
      ok(b);
      const updates: Uint8Array[] = [];
      a.ydoc.on("update", (u: Uint8Array) => void updates.push(u));
      const commands = commandsFromDiff(base, relabel(base, 1));
      a.apply(commands);
      const before = b.stats.recordsProjected;
      for (const u of updates) b.applyRemote(u);
      ok(b);
      return {
        commands: commands.length,
        bytes: updates.reduce((n, u) => n + u.length, 0),
        reread: b.stats.recordsProjected - before,
      };
    };
    const small = measure(mesh.small);
    const large = measure(mesh.large);
    log("single edit", { small, large });
    expect(small.commands).toBe(1);
    expect(large.commands).toBe(1);
    expect(small.reread).toBe(1);
    expect(large.reread).toBe(1);
    expect(large.bytes).toBeLessThanOrEqual(small.bytes + 8);
  });

  it("a drag of 200 committed moves grows the document by a bounded amount per move", () => {
    const a = hydrated(mesh.small);
    const start = a.encodeDiff().length;
    let d = ok(a);
    for (let i = 0; i < 200; i++) {
      const next = { ...d, nodes: d.nodes.map((n, j) => (j === 0 ? { ...n, x: n.x + 10 } : n)) };
      a.apply(commandsFromDiff(d, next));
      d = next;
    }
    const perMove = (a.encodeDiff().length - start) / 200;
    log(`bytes per committed move: ${perMove.toFixed(1)}`);
    expect(perMove).toBeLessThan(32);
  });

  it("grows linearly: hydrate, diff + apply, sync, project, bulk delete", () => {
    const ratios: Record<string, number> = {};
    // Count source reads, shared-record accesses and order entries visited. This keeps each phase
    // separate and observes repeated scans as well as lookups, without measuring quota/JIT/GC delays.
    const work = (run: () => void) => {
      const orderReads: (() => number)[] = [];
      const toArray = Y.Array.prototype.toArray;
      const order = vi.spyOn(Y.Array.prototype, "toArray").mockImplementation(function (this: Y.Array<unknown>) {
        const counted = countingReads(toArray.call(this));
        orderReads.push(counted.reads);
        return new Proxy(counted.items, {
          get(target, key, receiver) {
            if (counted.reads() > target.length * LINEAR_LIMIT)
              throw new Error("Projection order scans exceeded linear work limit");
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      });
      const get = vi.spyOn(Y.Map.prototype, "get");
      const set = vi.spyOn(Y.Map.prototype, "set");
      try {
        run();
        return orderReads.reduce((sum, reads) => sum + reads(), 0) + get.mock.calls.length + set.mock.calls.length;
      } finally {
        order.mockRestore();
        get.mockRestore();
        set.mockRestore();
      }
    };
    const measure = (diagram: DiagramFile) => {
      const nodes = countingReads(diagram.nodes);
      const edges = countingReads(diagram.edges);
      const d = { ...diagram, nodes: nodes.items, edges: edges.items };
      const sourceWork = (run: () => void) => {
        const before = nodes.reads() + edges.reads();
        return work(run) + nodes.reads() + edges.reads() - before;
      };
      let doc!: CollabDoc;
      const hydrate = sourceWork(() => {
        doc = hydrated(d);
      });
      try {
        const base = ok(doc);
        const diffApply = sourceWork(() => doc.apply(commandsFromDiff(d, relabel(d, 1))));
        const update = doc.encodeDiff();
        let bytesRead = 0;
        const wire = new Proxy(update, {
          get(target, key) {
            if (typeof key === "string" && /^\d+$/.test(key)) bytesRead++;
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const joinSync =
          work(() => {
            const peer = new CollabDoc();
            try {
              expect(peer.applyRemote(wire)).toEqual({ ok: true });
            } finally {
              peer.destroy();
            }
          }) + bytesRead;
        const project = work(() => {
          doc.apply(commandsFromDiff(base, relabel(base, 2)));
          expect(ok(doc).nodes).toHaveLength(d.nodes.length);
        });
        const bulkDelete = sourceWork(() => doc.apply(commandsFromDiff(d, { ...d, nodes: [], edges: [] })));
        expect(ok(doc).nodes).toHaveLength(0);
        return { hydrate, diffApply, joinSync, project, bulkDelete };
      } finally {
        doc.destroy();
      }
    };
    const small = measure(mesh.small);
    const large = measure(mesh.large);
    for (const what of Object.keys(small) as (keyof typeof small)[]) {
      expect(small[what], what).toBeGreaterThan(0);
      ratios[what] = large[what] / small[what];
    }
    log("growth ratios", ratios);
    for (const [what, r] of Object.entries(ratios)) expect(r, what).toBeLessThan(LINEAR_LIMIT);
  }, 120_000);
});

describe("churn: many short-lived people", () => {
  /** `actors` sessions each join with a fresh Yjs client, make one edit and leave. */
  const small = serviceMesh(100);
  function churn(actors: number) {
    const room = hydrated(small, 1);
    for (let k = 0; k < actors; k++) {
      const visitor = joined(room, 1000 + k);
      const d = ok(visitor);
      visitor.apply(commandsFromDiff(d, relabel(d, k)));
      room.applyRemote(visitor.encodeDiff(room.stateVector()));
      visitor.destroy();
    }
    return { stateVector: room.stateVector().length, state: room.encodeDiff().length };
  }

  it("state vector and document grow linearly with the number of people who ever edited", () => {
    const few = churn(25);
    const many = churn(200);
    const base = hydrated(small).encodeDiff().length;
    log("churn", { few, many, base });
    // One entry per editor ever: a few bytes each.
    expect((many.stateVector - few.stateVector) / 175).toBeLessThan(12);
    // The document grows by a bounded amount per short-lived editor, not with the diagram's size.
    expect((many.state - base) / 200).toBeLessThan(96);
    expect((many.state - base) / Math.max(1, few.state - base)).toBeLessThan(LINEAR_LIMIT);
  });
});
