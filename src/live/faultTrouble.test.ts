import { expect, it } from "vitest";
import { faultDrillFixture } from "../lab/faultDrillFixture";
import { faultLabel, nodeFaultLabel } from "../model/faultWords";
import { faultTrouble } from "./faultTrouble";
import type { Trouble } from "./observedTrouble";
import { type Fault } from "../model/faults";
import { boundaryOutage, outageMembership } from "../model/faultRuntime";

const down: Trouble = {
  key: "down:worker",
  kind: "down",
  node: "worker",
  headline: "Worker is down",
  announce: "Worker is down",
  detail: "Messages sent to it fail",
  action: { kind: "revive", node: "worker" },
};

it("restores the enclosing boundary and reports actual loss rather than hypothetical failure", () => {
  const diagram = faultDrillFixture();
  const faults = [{ kind: "boundary", boundary: "zone-b", down: true }] as const;
  expect(faultTrouble(down, diagram, faults)).toMatchObject({
    headline: "Zone b is down",
    detail: "No messages dropped here. New requests can go elsewhere.",
    action: { kind: "restore-boundary", boundary: "zone-b", label: "Zone b" },
  });
  expect(faultTrouble(down, diagram, faults, { worker: { dropped: 26 } })?.detail).toBe("26 messages dropped");
  expect(faultTrouble(down, diagram)).toBe(down);
});

it("faults on a blamed consumer replace capacity advice with Clear fault", () => {
  const faults = [
    { kind: "slow", node: "worker", factor: 5 },
    { kind: "fail", node: "worker", rate: 0.5 },
  ] as const;
  const lag: Trouble = { ...down, kind: "lag", node: "queue", related: ["worker"], action: { kind: "inputs" } };
  expect(nodeFaultLabel("worker", faults)).toBe("5× slower · fails 50%");
  expect(faultTrouble(lag, faultDrillFixture(), faults)).toMatchObject({
    action: { kind: "clear-fault", node: "worker" },
  });
  expect(faultTrouble(lag, faultDrillFixture(), faults)?.detail).toContain("5× slower · fails 50%");
});

it.each<Fault>([
  { kind: "slow", node: "worker", factor: 5 },
  { kind: "fail", node: "worker", rate: 0.5 },
])("preserves Restore for a down node with $kind overlays", (fault) => {
  expect(faultTrouble(down, faultDrillFixture(), [fault])).toBe(down);
});

it("indexes 1,000 nodes and 100 nested boundaries once, caching membership across publications", () => {
  let reads = 0;
  const diagram = faultDrillFixture();
  diagram.groups = Array.from({ length: 100 }, (_, i) => ({
    id: `g${i}`,
    label: `Zone ${i}`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    get group() {
      reads++;
      return i ? `g${i - 1}` : undefined;
    },
  }));
  diagram.nodes = Array.from({ length: 1000 }, (_, i) => ({
    get id() {
      reads++;
      return i ? `n${i}` : "worker";
    },
    label: "Worker",
    stencil: "processor",
    group: "g99",
    x: 0,
    y: 0,
  }));
  diagram.edges = [];
  const faults: Fault[] = [
    { kind: "boundary", boundary: "g99", down: true },
    { kind: "boundary", boundary: "g0", down: true },
  ];
  const counters = Object.fromEntries(diagram.nodes.map((n) => [n.id, { dropped: 1 }]));
  reads = 0;
  for (let i = 0; i < 1000; i++) {
    expect(boundaryOutage(diagram, i ? `n${i}` : "worker", faults)?.id).toBe("g99");
  }
  expect(faultTrouble(down, diagram, faults, counters)?.detail).toBe("1,000 messages dropped");
  expect(reads).toBeLessThanOrEqual(4 * (1000 + 100));
  const members = outageMembership(diagram, faults);
  expect(members.get("worker")?.id).toBe("g99");
  reads = 0;
  // Snapshots contain new fault arrays even when active faults have not changed.
  expect(outageMembership(diagram, [...faults])).toBe(members);
  counters.worker.dropped = 2;
  expect(faultTrouble(down, diagram, [...faults], counters)?.detail).toBe("1,001 messages dropped");
  expect(reads).toBe(0);
  const reversed = [...faults].reverse();
  expect(outageMembership(diagram, reversed).get("worker")?.id).toBe("g0");
  expect(faultTrouble(down, diagram, [], counters)).toBe(down);
});

it("sums each dropped counter under its first overlapping outage only", () => {
  const diagram = faultDrillFixture();
  diagram.groups!.forEach((g) => {
    g.group = "region";
  });
  diagram.groups!.push({ id: "region", label: "Region", x: 0, y: 0, width: 1000, height: 500 });
  const faults: Fault[] = [
    { kind: "boundary", boundary: "zone-b", down: true },
    { kind: "boundary", boundary: "region", down: true },
  ];
  const nodes = { worker: { dropped: 1 }, store: { dropped: 2 }, caller: { dropped: 3 }, queue: { dropped: 4 } };
  expect(faultTrouble(down, diagram, faults, nodes)?.detail).toBe("3 messages dropped");
  expect(faultTrouble({ ...down, node: "caller" }, diagram, faults, nodes)?.detail).toBe("7 messages dropped");
  expect(faultTrouble(down, diagram, [...faults].reverse(), nodes)?.detail).toBe("10 messages dropped");
});

it("fault markers resolve human labels while preserving IDs as a missing-target fallback", () => {
  const fault = { kind: "boundary", boundary: "zone-b", down: true } as const;
  expect(faultLabel(fault, "zone-outage", faultDrillFixture())).toBe("Zone outage: Zone b");
  expect(faultLabel({ ...fault, boundary: "missing" }, "zone-outage", faultDrillFixture())).toBe(
    "Zone outage: missing",
  );
});
