import { expect } from "vitest";
import type { DiagramFile } from "../model/types";
import { createEngine } from "../sim/engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "../sim/resourceInvariants";
import { assertResilienceInvariants } from "../sim/resilienceInvariants";
import { STEP } from "../sim/timing";
import type { EdgeSimProps, NodeSimProps, SimEngine, SimSnapshot } from "../sim/types";
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
    for (const key of ["timedOut", "late", "retried", "shortCircuited", "succeeded"] as const)
      compare(edge.calls?.[key] ?? 0, b.edges[id].calls?.[key] ?? 0, `${id}.${key}`);
}

/** Sampled arrival instants: cohorts injected before each STEP (the original formula). */
export function cohortArrivals(scale: number, ratePerSec = 100, durationMs = 20_000): number[] {
  const perTick: number[] = [];
  let injected = 0;
  for (let time = STEP; time <= durationMs; time += STEP) {
    const due = Math.floor((time * ratePerSec) / (1000 * scale));
    perTick.push(due - injected);
    injected = due;
  }
  return perTick;
}

/** Scale 1 at the same instants: cumulative real arrivals = floor(C * N). */
export function sameArrivals(cohorts: readonly number[], scale: number): number[] {
  let c = 0,
    real = 0;
  return cohorts.map((n) => {
    c += n;
    const due = Math.floor(c * scale + 1e-9);
    const add = due - real;
    real = due;
    return add;
  });
}

export function assertHarnessDriven(diagram: DiagramFile) {
  for (const node of diagram.nodes) {
    const props = node.props as NodeSimProps | undefined;
    if ((props?.ratePerSec ?? 0) > 0 || props?.trafficMix !== undefined)
      throw new Error(`I1 harness owns arrivals: ${node.id} has a source rate or traffic mix`);
  }
}

export interface DriveOptions {
  /** Runs before each tick's arrivals at the same simulated time in both runs: faults, edits, observations. */
  script?: (engine: SimEngine, time: number) => void;
  /** Also checks the retry, breaker and budget invariants (R1-R6) on every tick. */
  resilience?: boolean;
}

export function drive(
  diagram: DiagramFile,
  weight: number,
  perTick: readonly number[],
  seed = 7,
  { script, resilience }: DriveOptions = {},
): SimSnapshot {
  assertHarnessDriven(diagram);
  const e = createEngine({
    scale: weight,
    seed,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
    verifyResources: assertResourceInvariants,
    ...(resilience ? { verifyResilience: assertResilienceInvariants } : {}),
  });
  e.load(diagram);
  perTick.forEach((count, tick) => {
    script?.(e, tick * STEP);
    if (count > 0) e.inject("source", count);
    e.step(STEP);
  });
  return e.snapshot();
}

type ConstantRateOptions = { seed?: number; ratePerSec?: number; durationMs?: number } & DriveOptions;

/** Command histories include edits/restores and are not themselves constant-rate,
 * fixed-scale I1 experiments. Replay fresh runs and keep all generated pools. */
export function constantRateRuns(
  diagram: DiagramFile,
  scale: number,
  { seed = 7, ratePerSec = 100, durationMs = 20_000, ...hooks }: ConstantRateOptions = {},
) {
  assertHarnessDriven(diagram);
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
  const cohorts = cohortArrivals(scale, ratePerSec, durationMs);
  const real = sameArrivals(cohorts, scale);
  return {
    baseline: drive(diagram, 1, real, seed, hooks),
    sampled: drive(diagram, scale, cohorts, seed, hooks),
    pools,
    cohorts,
    real,
  };
}

export function checkConstantRateEquivalence(
  diagram: DiagramFile,
  scale: number,
  seed = 7,
  opts: Omit<ConstantRateOptions, "seed"> = {},
) {
  const { baseline, sampled, pools } = constantRateRuns(diagram, scale, { ...opts, seed });
  expectScaleEquivalent(baseline, sampled, Math.min(...pools));
}
