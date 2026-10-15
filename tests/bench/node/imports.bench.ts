// Imports, without the browser (docs/BENCHMARKS.md § Metrics): Docker Compose, Kubernetes manifests, a Terraform
// plan and AsyncAPI documents (src/bench/workloads/sources.ts), through the whole pipeline a file goes through when
// it's opened: parsing, reading, mapping, layout and validation.
//
// - import: what File ▸ Import does by default (over 300 nodes it draws the boundaries with the most flows, and its
//   report offers the rest);
// - importEverything: Draw everything (every boundary, up to the file format's 5,000 nodes).
//
// Sizes: the unit count that makes about 100, 500, 1,500 and 5,000 nodes when everything is drawn.
// Gates: each importer grows linearly with its input.

import {
  importAsyncApi,
  importCompose,
  importKubernetes,
  importTerraform,
  replayOutcome,
} from "../../../src/interop/infra/pipeline";
import { readAsyncApi } from "../../../src/interop/infra/asyncapi";
import { readCompose } from "../../../src/interop/infra/compose";
import { readKubernetes } from "../../../src/interop/infra/kubernetes";
import { readTerraform } from "../../../src/interop/infra/terraform";
import type { ImportOutcome } from "../../../src/interop/formats";
import {
  asyncApiDocuments,
  composeFile,
  kubernetesManifests,
  terraformPlan,
  type SourceFile,
} from "../../../src/bench/workloads/sources";
import { GROWTH_FACTOR, measure, measureFresh, MODE, SIZES_RUN, suite } from "./harness";
import type { ImportGraph } from "../../../src/interop/infra/graph";
import type { FormatId } from "../../../src/interop/formats";

const s = suite("imports");

interface Format {
  id: FormatId;
  sources: (units: number) => SourceFile[];
  run: (files: SourceFile[]) => ImportOutcome;
  read: (files: SourceFile[]) => ImportGraph;
  /** Units for the growth gate's small input (the large is GROWTH_FACTOR times it). */
  gateUnits: number;
}

const FORMATS: Format[] = [
  {
    id: "compose",
    sources: (u) => [composeFile(u)],
    run: (f) => importCompose(f),
    read: (f) => readCompose(f),
    gateUnits: 40,
  },
  {
    id: "kubernetes",
    sources: (u) => kubernetesManifests(u),
    run: (f) => importKubernetes(f),
    read: (f) => readKubernetes(f),
    gateUnits: 40,
  },
  {
    id: "terraform",
    sources: (u) => [terraformPlan(u)],
    run: (f) => importTerraform(f),
    read: (f) => readTerraform(f),
    gateUnits: 40,
  },
  {
    id: "asyncapi",
    sources: (u) => asyncApiDocuments(u),
    run: (f) => importAsyncApi(f),
    read: (f) => readAsyncApi(f),
    gateUnits: 12,
  },
];

const nodesOf = (o: ImportOutcome) => (o.ok === true ? o.diagram.nodes.length : 0);
const everything = (format: Format, files: SourceFile[]) => replayOutcome(format.read(files), format.id);

/** Units that draw about `n` nodes with everything drawn (a probe, then a correction). */
function unitsFor(format: Format, n: number): number {
  const probe = 20;
  let units = Math.max(1, Math.round((n * probe) / Math.max(1, nodesOf(everything(format, format.sources(probe))))));
  const drawn = nodesOf(everything(format, format.sources(units)));
  if (drawn) units = Math.max(1, Math.round((units * n) / drawn));
  // Never over what an import draws (5,000): the biggest tier sits right at it.
  while (units > 1 && !nodesOf(everything(format, format.sources(units)))) units--;
  return units;
}

for (const format of FORMATS)
  for (const n of SIZES_RUN)
    s.timing(`import ${format.id} at about ${n} nodes`, () => {
      // AsyncAPI files are one application each, at most 100 per import (MAX_FILES): its biggest input stops there.
      let units = unitsFor(format, n);
      if (format.id === "asyncapi") units = Math.min(units, 100);
      const files = format.sources(units);
      const chars = files.reduce((sum, f) => sum + f.text.length, 0);
      const first = format.run(files);
      if (first.ok !== true) throw new Error(`${format.id}: ${"error" in first ? first.error : "failed"}`);
      const all = everything(format, files);
      const w = { family: format.id, n, nodes: nodesOf(all), edges: all.ok === true ? all.diagram.edges.length : 0 };
      const samples = MODE === "quick" ? 3 : n >= 1_500 ? 5 : 9;
      s.time(
        "import",
        measureFresh(() => () => format.run(files), { samples }),
        w,
      );
      s.time(
        "importEverything",
        measureFresh(() => () => everything(format, files), { samples }),
        w,
      );
      s.count("import-drawnNodes", nodesOf(first), { w });
      s.count("import-sourceChars", chars, { w, unit: "chars" });
      s.time(
        "read",
        measure(() => format.read(files), { samples, minMs: 5 }),
        w,
        undefined,
        "reader only (parse included)",
      );
    });

s.gating("every importer grows linearly with its input", () => {
  for (const format of FORMATS) {
    const small = format.sources(format.gateUnits);
    const large = format.sources(format.gateUnits * GROWTH_FACTOR);
    s.growth(
      `import-${format.id}`,
      () => everything(format, small),
      () => everything(format, large),
    );
  }
});
