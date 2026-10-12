import { expect } from "vitest";
import { applyOps, type DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { DiagramFile, DiagramNode, Simulation } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { runChecks } from "../checks/run";

// A one-click fix must never change or lose traffic it doesn't mean to. These play a seeded simulation before and
// after each way a finding offers to fix it, and compare what every node the diagram had handles.

const outsideClient = (n: DiagramNode) => n.stencil.startsWith("client.") || n.stencil === "generic.webhook";

/** Messages each node handles in a seeded run, every outside client sending a burst of 12. */
export function delivered(d: DiagramFile, counted: (n: DiagramNode) => boolean = () => true): Record<string, number> {
  const sim: Simulation = {
    id: "t",
    title: "Delivery",
    seed: 7,
    traffic: d.nodes
      .filter(outsideClient)
      .map((n) => ({ id: `t-${n.id}`, node: n.id, shape: { kind: "burst" as const, count: 12 } })),
  };
  const run = createSimulationRun(d, sim);
  run.setSpeed(8);
  for (let i = 0; i < 4000 && !run.state().done; i++) run.step(25);
  const nodes = run.engine.snapshot().nodes;
  return Object.fromEntries(d.nodes.filter(counted).map((n) => [n.id, nodes[n.id].processed]));
}

/**
 * Every way `rule`'s first finding offers to fix it (its button and each chip) delivers what the diagram delivered:
 * each node the diagram had (and `counted` keeps) handles as many messages afterwards, and each node the fix adds
 * (that `counted` keeps) handles none. Returns how many ways it tried.
 */
export function preservesDelivery(
  d: DiagramFile,
  rule: CheckRuleId,
  counted: (n: DiagramNode) => boolean = () => true,
): number {
  const [finding] = runChecks(d, { rules: [rule] }).findings;
  expect(finding?.fix?.ops, rule).toBeDefined();
  const ways = [{ label: finding.fix!.label, ops: finding.fix!.ops! }, ...(finding.fix!.options ?? [])];
  sameDelivery(d, ways, counted);
  return ways.length;
}

/** `ways` (each a batch of edit ops) all deliver what `d` delivered: see preservesDelivery. */
export function sameDelivery(
  d: DiagramFile,
  ways: readonly { label: string; ops: DiagramOp[] }[],
  counted: (n: DiagramNode) => boolean = () => true,
): void {
  const before = delivered(d, counted);
  expect(Object.values(before).some((n) => n > 0)).toBe(true);
  for (const way of ways) {
    const result = applyOps(d, way.ops);
    expect(result.errors, way.label).toEqual([]);
    const after = delivered(result.diagram, counted);
    // Every node that was there is still there and handles what it did (one removed fails here)...
    expect(Object.fromEntries(Object.keys(before).map((id) => [id, after[id]])), way.label).toEqual(before);
    // ...and every node the change added (that `counted` keeps) handles nothing.
    const added = Object.entries(after).filter(([id]) => !(id in before));
    expect(Object.fromEntries(added), way.label).toEqual(Object.fromEntries(added.map(([id]) => [id, 0])));
  }
}
