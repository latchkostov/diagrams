import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { analyzeCapacity } from "../sim/capacity";
import { planningSimulation } from "../sim/capacityPlanning";
import { compileTopology } from "../sim/topology";
import { explainNode } from "./explanation";
import { capabilities } from "./capabilities";
import { planningRun } from "./run";

const signatures = new WeakMap<DiagramFile, string>();
const entries = new Map<string, ReturnType<typeof compute>>();

function compute(d: DiagramFile, state?: LiveState | null) {
  const sim = planningRun(d, state);
  const status = Object.fromEntries(Object.entries(state?.snapshot.nodes ?? {}).map(([id, n]) => [id, n.status]));
  const analysis = analyzeCapacity(d, planningSimulation(d, sim), { status });
  const topology = compileTopology(d);
  const rows = new Map<string, ReturnType<typeof capabilities>>();
  const explanations = new Map<string, ReturnType<typeof explainNode>>();
  return {
    running: state?.running,
    inputs: state?.inputs,
    tweaks: state?.tweaks,
    statusKey: JSON.stringify(status),
    sim,
    analysis,
    rows(id: string) {
      if (!rows.has(id)) {
        const node = d.nodes.find((n) => n.id === id);
        rows.set(id, node ? capabilities(d, node, topology, analysis.resolved[id]) : []);
      }
      return rows.get(id)!;
    },
    explanation(id: string) {
      if (!explanations.has(id)) explanations.set(id, explainNode(d, id, { sim, analysis, topology }));
      return explanations.get(id);
    },
  };
}

/** A small shared cache for inspector and hover. Counters never identify configured planning work. */
export function configuredPlanning(d: DiagramFile, state?: LiveState | null) {
  let signature = signatures.get(d);
  if (!signature) {
    signature = JSON.stringify(d);
    signatures.set(d, signature);
  }
  const statusKey = JSON.stringify(
    Object.fromEntries(Object.entries(state?.snapshot.nodes ?? {}).map(([id, n]) => [id, n.status])),
  );
  let entry = entries.get(signature);
  if (
    !entry ||
    entry.running !== state?.running ||
    entry.inputs !== state?.inputs ||
    entry.tweaks !== state?.tweaks ||
    entry.statusKey !== statusKey
  ) {
    entry = compute(d, state);
    entries.delete(signature);
    entries.set(signature, entry);
    if (entries.size > 4) entries.delete(entries.keys().next().value!);
  }
  return entry;
}
