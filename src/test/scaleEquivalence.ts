import { expect } from "vitest";
import type { DiagramFile } from "../model/types";
import { createEngine } from "../sim/engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "../sim/resourceInvariants";
import { STEP } from "../sim/timing";
import type { EdgeSimProps, NodeSimProps, SimSnapshot } from "../sim/types";
import { realSnapshot } from "../sim/units";

/** I1 is an additional floor: callers retain their tighter, scenario-specific bounds. */
export function expectScaleEquivalent(baseline: SimSnapshot, sampled: SimSnapshot, pool: number, faults = 0) {
  const a = realSnapshot(baseline);
  const b = realSnapshot(sampled);
  const scale = sampled.scale ?? 1;
  const compare = (x: number, y: number, name: string) => {
    const bound = scale * (Math.ceil(pool / scale) + 1) * (1 + faults) + 0.02 * x;
    expect(
      Math.abs(y - x),
      `I1 ${name}: scale1=${x}, scale${scale}=${y}, S=${pool}, faults=${faults}`,
    ).toBeLessThanOrEqual(bound);
  };
  for (const [id, node] of Object.entries(a.nodes))
    for (const key of ["processed", "failed", "rejected", "dropped"] as const)
      compare(node[key] ?? 0, b.nodes[id][key] ?? 0, `${id}.${key}`);
  for (const [id, edge] of Object.entries(a.edges))
    for (const key of ["timedOut", "late"] as const)
      compare(edge.calls?.[key] ?? 0, b.edges[id].calls?.[key] ?? 0, `${id}.${key}`);
}

/** Replay a fresh constant-rate interval; command histories include edits/restores and
 * are not themselves constant-rate, fixed-scale I1 experiments. Keep all generated pools. */
export function checkConstantRateEquivalence(diagram: DiagramFile, scale: number, seed = 7) {
  const pools = diagram.nodes.flatMap((n) => {
    const p = n.props as NodeSimProps | undefined;
    return [
      ...(p?.concurrency === undefined ? [] : [p.concurrency * (p.replicas ?? 1)]),
      ...(p?.maxConcurrency === undefined ? [] : [p.maxConcurrency]),
      ...(p?.api?.maxInFlight === undefined ? [] : [p.api.maxInFlight]),
    ];
  });
  pools.push(
    ...diagram.edges.flatMap((e) => {
      const p = e.props as EdgeSimProps | undefined;
      return p?.caller?.poolConnections === undefined ? [] : [p.caller.poolConnections];
    }),
  );
  pools.push(
    ...(diagram.planning?.sharedAllocations ?? []).flatMap((a) => (a.maxInFlight === undefined ? [] : [a.maxInFlight])),
  );
  const run = (weight: number) => {
    const e = createEngine({
      scale: weight,
      seed,
      maxParticles: 0,
      verifyLedger: assertLedgerInvariants,
      verifyOutcomes: assertOutcomeInvariants,
      verifyResources: assertResourceInvariants,
    });
    e.load(diagram);
    let injected = 0;
    // 100 real requests/s, quantized only at the sampled cohort boundary.
    for (let time = STEP; time <= 20_000; time += STEP) {
      const due = Math.floor((time * 100) / (1000 * weight));
      if (due > injected) e.inject("source", due - injected);
      injected = due;
      e.step(STEP);
    }
    return e.snapshot();
  };
  const baseline = run(1),
    sampled = run(scale);
  expectScaleEquivalent(baseline, sampled, Math.min(...pools));
}
