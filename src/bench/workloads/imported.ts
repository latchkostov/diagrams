// Workloads: diagrams as the importers draw them (docs/BENCHMARKS.md § Workloads). Synthetic Kubernetes manifests and
// a Terraform plan (./sources.ts) go through the real readers, mapping, layout and validation, with every boundary
// drawn (the report's Draw everything): the shapes, groups, relations and positions an imported diagram really has.
// About `n` nodes: the importer decides how many nodes a unit becomes, so the unit count is solved for.

import type { DiagramFile } from "../../model/types";
import { replayOutcome } from "../../interop/infra/pipeline";
import { readKubernetes } from "../../interop/infra/kubernetes";
import { readTerraform } from "../../interop/infra/terraform";
import { LIMITS } from "../../interop/native";
import { kubernetesManifests, terraformPlan } from "./sources";

/** The diagram for `units`, or undefined when the importer won't draw that many. */
type Read = (units: number) => DiagramFile | undefined;

function drawAll(read: Read, n: number, what: string): DiagramFile {
  // Nodes per unit from a probe, then a correction or two (the per-namespace and per-topic nodes aren't linear).
  const probe = 40;
  const probed = read(probe);
  if (!probed) throw new Error(`${what}: the probe import failed`);
  let units = Math.max(1, Math.round((n * probe) / probed.nodes.length));
  let d = read(units);
  for (let i = 0; i < 3 && d && d.nodes.length !== n; i++) {
    const next = Math.max(1, Math.round((units * n) / d.nodes.length));
    if (next === units) break;
    units = next;
    d = read(units);
  }
  // Never over the file format's or the importer's limit: the biggest tier sits right at it.
  while (!d || d.nodes.length > LIMITS.maxNodes) {
    if (units <= 1) throw new Error(`${what}: no unit count draws a diagram`);
    d = read(--units);
  }
  return d;
}

const drawn = (r: ReturnType<typeof replayOutcome>) => (r.ok === true ? r.diagram : undefined);

export function importedKubernetes(n: number): DiagramFile {
  const read: Read = (units) => drawn(replayOutcome(readKubernetes(kubernetesManifests(units)), "kubernetes"));
  const d = drawAll(read, n, "Kubernetes");
  return { ...d, title: `Imported Kubernetes (${d.nodes.length} nodes)` };
}

export function importedTerraform(n: number): DiagramFile {
  const read: Read = (units) => drawn(replayOutcome(readTerraform([terraformPlan(units)]), "terraform"));
  const d = drawAll(read, n, "Terraform");
  return { ...d, title: `Imported Terraform (${d.nodes.length} nodes)` };
}
