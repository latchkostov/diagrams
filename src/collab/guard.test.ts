import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DiagramFile } from "../model/types";
import { commandsFromDiff, type DiagramCommand } from "./commands";
import { CollabDoc } from "./doc";
import { anyBound, checkCommands } from "./guard";
import { seededRandom } from "./random";

// The local step bound must be an upper bound on what Yjs actually encodes, or an accepted step could be one no peer
// accepts. Checked against real encodings, including the cases that broke cruder estimates.

const base = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "T",
  nodes: [{ id: "a", stencil: "postgres", label: "A", x: 0, y: 0 }],
  edges: [],
});

function encoded(commands: DiagramCommand[]): { bound: number; actual: number } {
  const doc = new CollabDoc({ clientId: 1 });
  doc.hydrate(base());
  const check = checkCommands(commands);
  if (!check.ok) throw new Error(check.problem);
  let actual = 0;
  doc.ydoc.on("update", (u: Uint8Array) => void (actual += u.length));
  expect(doc.apply(commands).ok).toBe(true);
  return { bound: check.bytes, actual };
}

describe("checkCommands' size bound", () => {
  it.each([
    ["400,000 floats", (): DiagramCommand[] => [{ op: "meta", set: { samples: new Array(400_000).fill(0.1) } }]],
    [
      "large integers and negative numbers",
      (): DiagramCommand[] => [{ op: "meta", set: { n: Array.from({ length: 50_000 }, (_, i) => -(2 ** 40) - i) } }],
    ],
    ["three-byte characters", (): DiagramCommand[] => [{ op: "meta", set: { s: "\u4e2d".repeat(99_000) } }]],
    [
      "a node with 20,000 props",
      (): DiagramCommand[] => [
        {
          op: "put",
          kind: "nodes",
          record: {
            id: "big",
            stencil: "postgres",
            label: "",
            x: 0,
            y: 0,
            props: Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`p${i}`, i])),
          },
        },
      ],
    ],
    [
      "an array of empty objects",
      (): DiagramCommand[] => [{ op: "meta", set: { samples: Array.from({ length: 10_000 }, () => ({})) } }],
    ],
    [
      "a long reorder",
      (): DiagramCommand[] => [
        { op: "order", kind: "nodes", ids: Array.from({ length: 20_000 }, (_, i) => `id-${i}`) },
      ],
    ],
  ])("bounds %s", (_name, make) => {
    const { bound, actual } = encoded(make());
    expect(bound).toBeGreaterThanOrEqual(actual);
  });

  it("bounds seeded random edit steps", () => {
    const rnd = seededRandom(17);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const value = (depth = 0): unknown => {
      const r = rnd();
      if (depth > 3 || r < 0.3) return pick([rnd() * 1e6, Math.floor(rnd() * 1e9) - 5e8, rnd() < 0.5, null]);
      if (r < 0.6) return "x\u00e9\u4e2d\ud83d\ude00".repeat(Math.floor(rnd() * 50));
      if (r < 0.8) return Array.from({ length: Math.floor(rnd() * 20) }, () => value(depth + 1));
      return Object.fromEntries(
        Array.from({ length: Math.floor(rnd() * 10) }, (_, i) => [`k${i}\u00e9`, value(depth + 1)]),
      );
    };
    for (let round = 0; round < 40; round++) {
      const before = base();
      const after: DiagramFile = {
        ...before,
        title: String(value()),
        nodes: [
          { ...before.nodes[0], label: `L${round}`, props: { a: value(), b: value() } },
          ...Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => ({
            id: `n${round}-${i}`,
            stencil: "postgres",
            label: "\u4e2d",
            x: i,
            y: i,
            props: { v: value() },
          })),
        ],
        ...(rnd() < 0.5 ? { extra: value() } : {}),
      };
      const { bound, actual } = encoded(commandsFromDiff(before, after));
      expect(bound, `round ${round}`).toBeGreaterThanOrEqual(actual);
    }
  });

  it("bounds lib0's encoding of single values", () => {
    for (const v of [0.1, 2 ** 53, -1, "\u4e2d", [1, [2, [3]]], { a: { b: "c" } }, true, null]) {
      const doc = new Y.Doc();
      const arr = doc.getArray("x");
      let size = 0;
      doc.on("update", (u: Uint8Array) => void (size += u.length));
      arr.push([v]);
      // The update also carries the item's id and parent: subtract a fixed envelope measured with a 0.
      expect(anyBound(v)).toBeGreaterThan(0);
      expect(size).toBeLessThan(anyBound(v) + 64);
    }
  });
});
