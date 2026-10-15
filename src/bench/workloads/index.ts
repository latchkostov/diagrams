// The benchmark workloads (docs/BENCHMARKS.md § Workloads): six families of synthetic, deterministic diagrams at four
// sizes. A family is a pure function of the node count (and a fixed seed), so every run and every machine measures
// the same input; `fingerprint` in the results proves it.

import type { DiagramFile } from "../../model/types";
import { annotatedPipeline } from "./annotated";
import { fingerprint } from "./common";
import { tiledExamples } from "./examples";
import { importedKubernetes, importedTerraform } from "./imported";
import { serviceMesh } from "./mesh";
import { eventPipeline } from "./pipeline";

/** The sizes every family is measured at: about 100, 500, 1,500 and 5,000 nodes (the file format's limit). */
export const SIZES = [100, 500, 1_500, 5_000] as const;
export type Size = (typeof SIZES)[number];

export const FAMILIES = {
  mesh: { title: "Service mesh with gateways", make: serviceMesh, exact: true },
  pipeline: { title: "Event-driven pipeline (Kafka, queues, DLQs)", make: eventPipeline, exact: true },
  k8s: { title: "Imported Kubernetes manifests", make: importedKubernetes, exact: false },
  terraform: { title: "Imported Terraform plan", make: importedTerraform, exact: false },
  annotated: { title: "Boundaries and annotations", make: annotatedPipeline, exact: true },
  examples: { title: "Public examples, tiled", make: tiledExamples, exact: true },
} as const satisfies Record<string, { title: string; make: (n: number) => DiagramFile; exact: boolean }>;
export type Family = keyof typeof FAMILIES;
export const FAMILY_IDS = Object.keys(FAMILIES) as Family[];

const cache = new Map<string, DiagramFile>();

/**
 * The workload `family` at about `n` nodes, generated once per process. Callers get the cached object: copy it
 * (structuredClone) before changing it.
 */
export function workload(family: Family, n: number): DiagramFile {
  const key = `${family}:${n}`;
  let d = cache.get(key);
  if (!d) {
    d = FAMILIES[family].make(n);
    cache.set(key, d);
  }
  return d;
}

/** What a result records about its input: counts and a fingerprint of the exact JSON. */
export function describeWorkload(d: DiagramFile) {
  return {
    nodes: d.nodes.length,
    edges: d.edges.length,
    groups: d.groups?.length ?? 0,
    annotations: d.annotations?.length ?? 0,
    simulations: d.simulations?.length ?? 0,
    fingerprint: fingerprint(JSON.stringify(d)),
  };
}
