// Planning analysis and explanations, without the browser (docs/BENCHMARKS.md § Metrics), for every planning
// revision the app reads: legacy files (none), P1, P2, and P3 (what Diagram properties' upgrade writes today).
//
// - analyzeCapacity: the free-play capacity analysis behind the inspector's planning, the heat map and the capacity
//   check, at every size.
// - The inspector's planning for one node (configuredPlanning: analysis, topology, explanation and capability rows),
//   computed afresh as a keystroke in the node's label does (the label is part of the planning signature), where the
//   inspector offers it. Its work estimate (src/planning/budget.ts) turns it off above 256 nodes and, in practice,
//   for most diagrams over a few dozen nodes, and for 5 of the 17 public examples: so also "planningCompute", the same
//   computation without the estimate, at 100 and 250 nodes (what lifting the limit would cost).
// - Explanations for every node (the hover card), the planning upgrade, and the planning signature.
// - "withLoop": the analysis of a mesh with one request loop, which runs to its iteration bound (the worst case).
//
// Gates: the analysis grows linearly; selecting node after node reads one cached analysis.

import { configuredPlanning, planningRunStats } from "../../../src/planning/cache";
import { capabilities } from "../../../src/planning/capabilities";
import { planningRun } from "../../../src/planning/run";
import { explainNode, explanationSimulation } from "../../../src/planning/explanation";
import { upgradePlanning } from "../../../src/planning/migration";
import { planningSignature } from "../../../src/planning/budget";
import { analyzeCapacity } from "../../../src/sim/capacity";
import { planningSimulation } from "../../../src/sim/capacityPlanning";
import { compileTopology } from "../../../src/sim/topology";
import { FAMILY_IDS } from "../../../src/bench/workloads";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { serviceMesh } from "../../../src/bench/workloads/mesh";
import { publicExamples } from "../../../src/bench/workloads/examples";
import type { DiagramFile } from "../../../src/model/types";
import {
  cases,
  GATE_LARGE,
  GATE_SMALL,
  MODE,
  measure,
  measureFresh,
  samplesFor,
  suite,
  workload,
  workloadInfo,
} from "./harness";

const s = suite("planning");

/** The same diagram as each planning revision reads it: as saved (legacy), opted in to P1 or P2, and upgraded. */
const revision =
  (r: "p1" | "p2") =>
  (d: DiagramFile): DiagramFile => ({
    ...structuredClone(d),
    format: "diagrams/v2",
    planning: { revision: r },
  });
const REVISIONS = {
  legacy: (d: DiagramFile) => d,
  p1: revision("p1"),
  p2: revision("p2"),
  // The explicit upgrade (Diagram properties), to the newest revision: P3 today, effective defaults pinned.
  p3: (d: DiagramFile) => upgradePlanning(d),
};

const analyze = (d: DiagramFile) => analyzeCapacity(d, planningSimulation(d, explanationSimulation(d)));

for (const { family, n, title } of cases(FAMILY_IDS))
  s.timing(`capacity analysis ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const a = analyze(d);
    s.time(
      "analyzeCapacity",
      measure(() => analyze(d), { samples: samplesFor(n) }),
      w,
    );
    s.count("analyzeCapacity-iterations", a.iterations, { w });
    s.time(
      "planningSignature",
      measure(() => planningSignature(d), { samples: samplesFor(n) }),
      w,
    );
    s.time(
      "upgradePlanning",
      measure(() => upgradePlanning(d), { samples: samplesFor(n) }),
      w,
    );
  });

/** The inspector's planning for `id` as configuredPlanning computes it (src/planning/cache.ts), with no work estimate. */
function planningCompute(d: DiagramFile, id: string) {
  const sim = planningRun(d);
  const analysis = analyzeCapacity(d, planningSimulation(d, sim), { status: {} });
  const topology = compileTopology(d);
  const node = d.nodes.find((x) => x.id === id);
  if (!node) throw new Error(`no node ${id}`);
  capabilities(d, node, topology, analysis.resolved[id]);
  return explainNode(d, id, { sim, analysis, topology });
}

/** A keystroke in `target`'s label: a new document (a new planning signature). */
function typedInto(base: DiagramFile, targetId: string) {
  let keystroke = 0;
  return () => ({
    ...base,
    nodes: base.nodes.map((x) => (x.id === targetId ? { ...x, label: `${x.label}${++keystroke}` } : x)),
  });
}

// The inspector's planning per keystroke, per revision, where the inspector offers it: the generated families at 24
// nodes and the public examples its estimate allows.
const offered: { family: string; d: DiagramFile }[] = [
  { family: "pipeline", d: eventPipeline(24) },
  { family: "mesh", d: serviceMesh(24) },
  ...publicExamples()
    .filter(({ diagram }) => planningSignature(diagram) !== undefined)
    .map(({ slug, diagram }) => ({ family: `example-${slug}`, d: diagram })),
];
for (const [rev, convert] of Object.entries(REVISIONS))
  s.timing(`inspector planning per keystroke, ${rev}`, () => {
    for (const { family, d: original } of offered) {
      const base = convert(original);
      if (planningSignature(base) === undefined) continue;
      const w = workloadInfo(family, base.nodes.length, base);
      const target = base.nodes[Math.floor(base.nodes.length / 2)].id;
      const next = typedInto(base, target);
      const typed = () => {
        const d = next();
        return () => {
          const p = configuredPlanning(d);
          p?.explanation(target);
          p?.rows(target);
        };
      };
      s.time("inspectorPlanning-keystroke", measureFresh(typed, { samples: 15 }), w, rev);
    }
  });

// What the same computation costs past the estimate, and every node's explanation (hover cards).
const COMPUTE_SIZES = MODE === "quick" ? [100] : [100, 250];
for (const [rev, convert] of Object.entries(REVISIONS))
  for (const { family, n, title } of cases(["pipeline", "mesh", "examples"], COMPUTE_SIZES))
    s.timing(`planning compute ${rev} ${title}`, () => {
      const base = convert(workload(family, n));
      const w = workloadInfo(family, n, base);
      const target = base.nodes[Math.floor(base.nodes.length / 2)].id;
      const next = typedInto(base, target);
      s.time(
        "planningCompute",
        measureFresh(() => {
          const d = next();
          return () => planningCompute(d, target);
        }),
        w,
        rev,
      );
      const sim = explanationSimulation(base);
      const a = analyzeCapacity(base, planningSimulation(base, sim));
      const topology = compileTopology(base);
      s.time(
        "explainEveryNode",
        measure(() => {
          for (const x of base.nodes) explainNode(base, x.id, { sim, analysis: a, topology });
        }),
        w,
        rev,
      );
    });

s.timing("capacity analysis with a request loop", () => {
  for (const n of [100, 500]) {
    const d = structuredClone(serviceMesh(n));
    const services = d.nodes.filter((x) => x.id.startsWith("d1-svc-"));
    d.edges.push({ id: "loop", from: services[services.length - 1].id, to: services[0].id, kind: "sync" });
    const a = analyze(d);
    const w = workloadInfo("mesh-loop", n, d);
    s.time(
      "analyzeCapacity-withLoop",
      measure(() => analyze(d), { samples: samplesFor(n) }),
      w,
    );
    s.count("analyzeCapacity-withLoop-iterations", a.iterations, { w });
  }
});

s.gating("the capacity analysis grows linearly", () => {
  const small = eventPipeline(GATE_SMALL);
  const large = eventPipeline(GATE_LARGE);
  s.growth(
    "analyzeCapacity",
    () => analyze(small),
    () => analyze(large),
  );
});

s.gating("selecting node after node reads one cached analysis", () => {
  // A legacy file: upgraded (pinned presets on every node) it's past the inspector's work estimate already.
  const d = eventPipeline(24);
  if (planningSignature(d) === undefined) throw new Error("the inspector no longer offers planning at 24 nodes");
  const before = { ...planningRunStats };
  for (const x of d.nodes.slice(0, 20)) {
    const p = configuredPlanning(d);
    p?.explanation(x.id);
    p?.rows(x.id);
  }
  s.count("analyses-for-20-selections", planningRunStats.analyses - before.analyses, {
    limit: 1,
    why: "one document, one analysis: the selection never recomputes it",
  });
  s.count("explanations-for-20-selections", planningRunStats.explanations - before.explanations, {
    limit: 20,
    why: "one explanation per node, cached",
  });
});
