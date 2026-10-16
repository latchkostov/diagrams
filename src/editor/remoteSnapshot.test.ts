import { expect, it, vi } from "vitest";
import { toFlow } from "../canvas/convert";
import { remoteTargetRemoved, retainRemoteSelection } from "./remoteSnapshot";
import { roomSnapshotKey } from "./historySelection";
import { serviceMesh } from "../bench/workloads/mesh";

it("indexes incoming IDs once for bulk focus preservation", () => {
  for (const size of [128, 1024]) {
    let reads = 0;
    const current = toFlow({
      format: "diagrams/v1",
      title: "Bulk",
      nodes: Array.from({ length: size }, (_, i) => ({ id: `n${i}`, stencil: "service.go", label: "N", x: i, y: 0 })),
      edges: [],
    });
    current.nodes = current.nodes.map((n) => ({ ...n, selected: true }));
    const next = {
      ...current,
      nodes: current.nodes.map(
        (n) =>
          new Proxy(n, {
            get(target, key, receiver) {
              if (key === "id") reads++;
              return Reflect.get(target, key, receiver);
            },
          }),
      ),
    };
    expect(remoteTargetRemoved(current, next, { inspector: true })).toBe(false);
    expect(reads).toBeLessThanOrEqual(size * 2);
    expect(remoteTargetRemoved(current, { ...next, nodes: [] }, { id: "n0" })).toBe(true);
  }
});

it("does not serialize or revisit unchanged settings for a remote edit in a 5,000-node room", () => {
  const d = serviceMesh(5000);
  let reads = 0;
  for (const n of d.nodes)
    if (n.props)
      n.props = new Proxy(n.props, {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      });
  const current = toFlow(d);
  const target = current.nodes.findIndex((n) => n.id === d.nodes[0].id);
  current.nodes[target] = { ...current.nodes[target], selected: true, measured: { width: 220, height: 72 } };
  roomSnapshotKey(current); // populate persisted-record keys
  const next = toFlow({ ...d, nodes: d.nodes.map((n, i) => (i === 0 ? { ...n, label: "Peer rename" } : n)) });
  reads = 0;
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    const retained = retainRemoteSelection(current, next);
    expect(stringify).not.toHaveBeenCalled();
    expect(reads).toBe(0);
    expect(retained.nodes[target]).toMatchObject({
      selected: true,
      measured: { width: 220, height: 72 },
      data: { label: "Peer rename" },
    });
    for (let i = 0; i < retained.nodes.length; i++) if (i !== target) expect(retained.nodes[i]).toBe(current.nodes[i]);
    roomSnapshotKey(retained);
    expect(stringify.mock.calls.length).toBeLessThan(24);
    expect(reads).toBeLessThan(24);
    expect(roomSnapshotKey(retained)).not.toBe(roomSnapshotKey(current));
  } finally {
    stringify.mockRestore();
  }
});

it("room keys ignore selection and measurements but see disappearing boundary references and rounded moves", () => {
  const current = toFlow({
    format: "diagrams/v1",
    title: "Room",
    groups: [{ id: "g", label: "G", x: 0, y: 0, width: 400, height: 400 }],
    nodes: [{ id: "n", stencil: "service.go", label: "N", x: 20, y: 40, group: "g" }],
    edges: [],
  });
  const key = roomSnapshotKey(current);
  expect(
    roomSnapshotKey({
      ...current,
      nodes: current.nodes.map((n) => ({ ...n, selected: true, measured: { width: 120, height: 100 } })),
    }),
  ).toBe(key);
  expect(roomSnapshotKey({ ...current, nodes: current.nodes.filter((n) => n.type !== "boundary") })).not.toBe(key);
  expect(
    roomSnapshotKey({
      ...current,
      nodes: current.nodes.map((n) => ({ ...n, position: { ...n.position, x: n.position.x + 0.1 } })),
    }),
  ).toBe(key);
});
