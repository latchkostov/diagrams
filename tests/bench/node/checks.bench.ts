// Architecture checks and Run simulations, without the browser (docs/BENCHMARKS.md § Metrics). runChecks is what the
// canvas runs in a worker after edits; collectEvidence plays every saved simulation (Run simulations).
//
// Gates: every rule but capacity grows linearly (capacity, superlinear today, below quadratic), and a run analyses
// capacity at most once per saved simulation plus free play, compiling the simulation's topology once for the rules
// and once per analysis. A rule that recompiled per node
// would pass a ratio at small sizes and still be the whole-graph-per-item regression the counts catch.

import { vi } from "vitest";
import * as capacity from "../../../src/sim/capacity";
import * as topology from "../../../src/sim/topology";
import { RULES, runChecks } from "../../../src/checks/run";
import { GROWTH_FACTOR } from "../../../src/test/complexity";
import { collectEvidence } from "../../../src/checks/evidence";
import { FAMILY_IDS } from "../../../src/bench/workloads";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { serviceMesh } from "../../../src/bench/workloads/mesh";
import {
  cases,
  GATE_LARGE,
  GATE_SMALL,
  measure,
  measureFresh,
  samplesFor,
  suite,
  workload,
  workloadInfo,
} from "./harness";

const s = suite("checks");
/** Quadratic growth at GROWTH_FACTOR (64): a limit for work that is superlinear today, to hold it from getting worse. */
const QUADRATIC_GROWTH = GROWTH_FACTOR ** 2;

for (const { family, n, title } of cases(FAMILY_IDS))
  s.timing(`runChecks ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const result = runChecks(d);
    s.time(
      "runChecks",
      measure(() => runChecks(d), { samples: samplesFor(n) }),
      w,
    );
    s.count("findings", result.findings.length, { w });
  });

// Run simulations: the pipeline families carry two saved simulations each (steady load and an incident).
for (const { family, n, title } of cases(["pipeline", "annotated"]))
  s.timing(`Run simulations ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    // A clock that never moves: the app's 15 s wall budget never cuts the run short, so what's played doesn't depend on
    // the machine (the measurement is the work).
    const run = () => collectEvidence(d, { now: () => 0 });
    const evidence = run();
    s.time(
      "runSimulations",
      measureFresh(() => run, { samples: n >= 1_500 ? 3 : 5, warmup: 0 }),
      w,
    );
    s.count("runSimulations-played", evidence.played.length, { w });
    s.count("runSimulations-losses", evidence.losses.length, { w });
  });

// Every rule but capacity is linear. Capacity isn't, today (about 29x for 8x the pipeline: its sizing fix analyses the
// diagram again for each candidate; docs/BENCHMARKS.md § Hotspots), and it's most of a big run's time, so it has a gate
// of its own, held below quadratic until the refactor makes it linear too.
const STRUCTURAL = RULES.filter((r) => !r.onDemand && r.id !== "capacity").map((r) => r.id);

s.gating("a check run grows linearly but for the capacity rule", () => {
  for (const [name, make] of [
    ["pipeline", eventPipeline],
    ["mesh", serviceMesh],
  ] as const) {
    const small = make(GATE_SMALL);
    const large = make(GATE_LARGE);
    s.growth(
      `runChecks-structural-${name}`,
      () => runChecks(small, { rules: STRUCTURAL }),
      () => runChecks(large, { rules: STRUCTURAL }),
    );
    s.growth(
      `runChecks-capacity-${name}`,
      () => runChecks(small, { rules: ["capacity"] }),
      () => runChecks(large, { rules: ["capacity"] }),
      QUADRATIC_GROWTH,
      "superlinear today (hotspot); held below quadratic",
    );
  }
});

s.gating("a check run compiles the topology and analyses capacity a fixed number of times", () => {
  const d = eventPipeline(GATE_SMALL);
  const compile = vi.spyOn(topology, "compileTopology");
  const analyze = vi.spyOn(capacity, "analyzeCapacity");
  try {
    runChecks(d);
    const sims = d.simulations?.length ?? 0;
    const analyses = analyze.mock.calls.length;
    s.count("analyzeCapacity-per-run", analyses, {
      limit: 1 + sims,
      why: "free play plus each saved simulation, on first use",
    });
    s.count("compileTopology-per-run", compile.mock.calls.length, {
      limit: 1 + analyses,
      why: "buildContext compiles once for every rule; analyzeCapacity compiles its own",
    });
  } finally {
    compile.mockRestore();
    analyze.mockRestore();
  }
});
