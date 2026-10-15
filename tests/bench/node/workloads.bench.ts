// Materialises the workloads (docs/BENCHMARKS.md § Workloads) the run needs, before anything measures them: the
// browser benchmarks read these files, and the Node suites read them instead of generating the slow ones again. Records
// each one's size and fingerprint, so a result says exactly which input it measured.

import { FAMILY_IDS } from "../../../src/bench/workloads";
import { MODE, SIZES_RUN, suite, workload, workloadInfo } from "./harness";

const s = suite("workloads");

const wanted =
  MODE === "gates"
    ? (["pipeline", "mesh"] as const).flatMap((family) => [100, 500].map((n) => ({ family, n })))
    : FAMILY_IDS.flatMap((family) => SIZES_RUN.map((n) => ({ family, n })));

// A gating test, so every mode materialises what its browser benchmarks open.
s.gating(
  "materialise the workloads",
  () => {
    for (const { family, n } of wanted) {
      const w = workloadInfo(family, n, workload(family, n));
      s.count("nodes", w.nodes, { w });
      s.count("edges", w.edges, { w });
      s.rec.info[`${family}@${n}`] = w.fingerprint;
    }
  },
  900_000,
);
