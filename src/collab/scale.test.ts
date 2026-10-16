import { describe, expect, it } from "vitest";
import { annotatedPipeline } from "../bench/workloads/annotated";
import { serviceMesh } from "../bench/workloads/mesh";
import type { DiagramFile } from "../model/types";
import { GROWTH_FACTOR, growth, LINEAR_LIMIT } from "../test/complexity";
import { validateDiagram } from "../interop/native";
import { commandsFromDiff } from "./commands";
import { CollabDoc } from "./doc";
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
  it("fits a full 5,000-node room in one document frame", () => {
    for (const d of [mesh.large, annotatedPipeline(LARGE)]) {
      const bytes = hydrated(d).encodeDiff().length;
      log(`full state, ${d.nodes.length} nodes / ${d.edges.length} edges: ${bytes} bytes`);
      expect(bytes).toBeLessThan(COLLAB_LIMITS.maxDocFrameBytes / 2);
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
    ratios.hydrate = growth(
      () => hydrated(mesh.small),
      () => hydrated(mesh.large),
      { samples: 3 },
    );
    const [as, al] = [hydrated(mesh.small), hydrated(mesh.large)];
    const [ds, dl] = [ok(as), ok(al)];
    let i = 0;
    ratios.diffApply = growth(
      () => as.apply(commandsFromDiff(ds, relabel(ds, ++i))),
      () => al.apply(commandsFromDiff(dl, relabel(dl, ++i))),
      { samples: 3 },
    );
    const [us, ul] = [as.encodeDiff(), al.encodeDiff()];
    ratios.joinSync = growth(
      () => new CollabDoc().applyRemote(us),
      () => new CollabDoc().applyRemote(ul),
      { samples: 3 },
    );
    ratios.project = growth(
      () => {
        as.apply(commandsFromDiff(ds, relabel(ds, ++i)));
        return as.project();
      },
      () => {
        al.apply(commandsFromDiff(dl, relabel(dl, ++i)));
        return al.project();
      },
      { samples: 3 },
    );
    const deleteAll = (d: DiagramFile) => () => {
      const doc = hydrated(d);
      doc.apply(commandsFromDiff(d, { ...d, nodes: [], edges: [] }));
    };
    ratios.bulkDelete = growth(deleteAll(mesh.small), deleteAll(mesh.large), { samples: 3 });
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
