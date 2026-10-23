import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import { recoveryFault, recoveryPath } from "./recoveryEvidence";

it("tracks enclosing boundary, feeding link and synchronous descendant faults only", () => {
  const d = waitingFixture();
  d.groups = [
    { id: "outer", label: "Region", x: 0, y: 0, width: 1000, height: 1000 },
    { id: "inner", label: "Zone", x: 0, y: 0, width: 800, height: 800, group: "outer" },
  ];
  d.nodes[2].group = "inner";
  // The partner calls on: a service (a sink, the fixture's external API, ends every request; playback calls nothing).
  d.nodes[2].stencil = "generic.service";
  d.nodes.push({ ...d.nodes[2], id: "child" }, { ...d.nodes[2], id: "unused", group: undefined });
  d.edges.push({ id: "nested", from: "partner", to: "child", kind: "sync" });
  const path = recoveryPath(d, d.edges[1])!;
  const e = createEngine();
  e.load(d);
  const snapshot = realSnapshot(e.snapshot());
  expect(recoveryFault(snapshot, path)).toBe(false);
  for (const fault of [
    { kind: "boundary", boundary: "outer", down: true },
    { kind: "link", edge: "input", cut: true },
    { kind: "link", edge: "nested", cut: true },
    { kind: "slow", node: "child", factor: 2 },
  ] as const)
    expect(recoveryFault({ ...snapshot, faults: [fault] }, path)).toBe(true);
  expect(recoveryFault({ ...snapshot, faults: [{ kind: "fail", node: "unused", rate: 0.5 }] }, path)).toBe(false);
  expect(recoveryFault({ ...snapshot, faults: [{ kind: "slow", node: "partner", factor: 1 }] }, path)).toBe(false);
});

it("indexes a long ancestor chain with linear edge inspections", () => {
  const d = waitingFixture();
  const count = 200;
  d.nodes = Array.from({ length: count }, (_, i) => ({ ...d.nodes[i ? 1 : 0], id: String(i) }));
  let reads = 0;
  d.edges = Array.from({ length: count - 1 }, (_, i) => ({
    id: String(i),
    from: String(i),
    get to() {
      reads++;
      return String(i + 1);
    },
  }));
  const path = recoveryPath(d, { id: "call", from: String(count - 2), to: String(count - 1) });
  expect(path?.nodes.size).toBe(count);
  expect(reads).toBeLessThan(count * 8);
});

it("depends only on connections playback sends traffic along, between nodes the simulation knows", () => {
  const d = waitingFixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes.push(
    { ...d.nodes[2], id: "idle" },
    { ...d.nodes[2], id: "denied" },
    { ...d.nodes[2], id: "feeder" },
    { ...d.nodes[2], id: "api", stencil: "generic.external-api" },
    { ...d.nodes[2], id: "behind-api" },
  );
  d.annotations = [{ id: "note", kind: "shape", text: "Planned", x: 0, y: 0, width: 100, height: 50 }];
  d.edges.push(
    { id: "to-idle", from: "partner", to: "idle", kind: "sync", props: { share: 0 } },
    { id: "to-denied", from: "partner", to: "denied", kind: "sync", props: { deny: true } },
    { id: "from-feeder", from: "feeder", to: d.edges[1].from, kind: "async", props: { share: 0 } },
    { id: "to-note", from: "partner", to: "note", kind: "sync" },
    { id: "from-note", from: "note", to: d.edges[1].from, kind: "sync" },
    // A sink ends the request: playback never calls on from it.
    { id: "to-api", from: "partner", to: "api", kind: "sync" },
    { id: "past-api", from: "api", to: "behind-api", kind: "sync" },
  );
  const path = recoveryPath(d, d.edges[1])!;
  expect([...path.nodes].sort()).toEqual(["api", "caller", "partner", "source"]);
  expect([...path.edges].sort()).toEqual(["call", "input", "to-api"]);
  const e = createEngine();
  e.load(d);
  expect(recoveryFault(realSnapshot(e.snapshot()), path)).toBe(false);
});
