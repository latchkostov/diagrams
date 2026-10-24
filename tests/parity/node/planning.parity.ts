import { capacityView } from "../../../src/live/capacityView";
// Capacity analysis and planning (docs/SIMULATION.md "Capacity analysis without playback", planning P1/P2): what
// the heat map, the bottleneck callout, the Inputs panel, the inspector's explanations and capability rows, and the
// p2 upgrade produce for each diagram, in edit mode (free play's configured traffic) and with each saved
// simulation selected in the live view.
import { describe, it } from "vitest";
import type { DiagramFile, Simulation } from "../../../src/model/types";
import { LiveController, type LiveState } from "../../../src/live/controller";
import { configuredPlanning } from "../../../src/planning/cache";
import { planningSignature } from "../../../src/planning/budget";
import { explainNode } from "../../../src/planning/explanation";
import { capabilities } from "../../../src/planning/capabilities";
import { planningRun } from "../../../src/planning/run";
import { upgradePlanning, legacyExport } from "../../../src/planning/migration";
import { brokerAssignments } from "../../../src/sim/brokerAssignments";
import { analyzeCapacity, type CapacityAnalysis, type NodeCapacity } from "../../../src/sim/capacity";
import { compileTopology } from "../../../src/sim/topology";
import { sizingFix, redundancyFix, planningSimulation, FIX_ABOVE } from "../../../src/sim/capacityPlanning";
import {
  applyPreset,
  effectiveSimulation,
  emptyInputs,
  freePlaySimulation,
  partitionsNotes,
  PRESETS,
  type CapacityView,
} from "../../../src/live/capacityModel";
import { autoScale } from "../../../src/sim/scale";
import { planningDiagrams as allDiagrams, examples } from "../lib/corpus";
import { expectGolden } from "../lib/golden";
import { stable } from "../lib/stable";

const mapToObject = <V>(map: Map<string, V>) => Object.fromEntries(map);

/** A node's capacity on one line: [capacity, offered, utilization, replicas, active, idle] and its flags. */
function capacityLine(n: NodeCapacity): unknown {
  const flags: Record<string, unknown> = {};
  if (n.status) flags.status = n.status;
  if (n.device) flags.device = true;
  if (n.assignment) flags.assignment = n.assignment;
  const line = [n.capacity, n.offered, n.utilization, n.replicas, n.activeReplicas, n.idleReplicas];
  return Object.keys(flags).length ? [...line, flags] : line;
}

function analysisRecord(a: CapacityAnalysis) {
  return {
    bottleneck: a.bottleneck?.id ?? null,
    suggestion: a.suggestion,
    converged: a.converged,
    iterations: a.iterations,
    "nodes [capacity, offered, utilization, replicas, active, idle]": Object.fromEntries(
      Object.entries(a.nodes).map(([id, n]) => [id, capacityLine(n)]),
    ),
    connections: a.connections,
    offeredTypes: a.offeredTypes,
  };
}

/** Resolved settings per node; the profile's evidence notes are catalogue text, recorded by key only. */
function resolvedRecord(a: CapacityAnalysis) {
  return Object.fromEntries(
    Object.entries(a.resolved).map(([id, r]) => {
      const profile = r.profile && { ...r.profile, evidence: r.profile.evidence?.map((e) => e.key) };
      return [id, { ...r, profile }];
    }),
  );
}

/**
 * The configured planning (inspector and hover card) of every node, as the live state at hand sees it. Diagrams over
 * the planning budget show none in the app (`configured: false`); their explanations are still recorded, from the
 * same pure functions the cache would call.
 */
function planning(d: DiagramFile, state: LiveState | null) {
  const configured = configuredPlanning(d, state);
  const sim = configured?.sim ?? planningRun(d, state);
  const status = Object.fromEntries(Object.entries(state?.snapshot.nodes ?? {}).map(([id, n]) => [id, n.status]));
  const analysis = configured?.analysis ?? analyzeCapacity(d, planningSimulation(d, sim), { status });
  const topology = compileTopology(d);
  const explanations: Record<string, unknown> = {};
  const rows: Record<string, unknown> = {};
  for (const n of d.nodes) {
    const explanation = configured ? configured.explanation(n.id) : explainNode(d, n.id, { sim, analysis, topology });
    if (explanation) explanations[n.id] = explanation;
    const caps = configured ? configured.rows(n.id) : capabilities(d, n, topology, analysis.resolved[n.id]);
    if (caps.length) rows[n.id] = caps;
  }
  const nodes = Object.values(analysis.nodes);
  const hot = nodes.filter((n) => n.utilization >= FIX_ABOVE);
  return {
    configured: planningSignature(d, state) !== undefined,
    simulation: sim.id,
    analysis: analysisRecord(analysis),
    explanations,
    capabilities: rows,
    sizing: sizingFix(d, planningSimulation(d, sim), nodes),
    redundancy: Object.fromEntries(hot.map((n) => [n.id, redundancyFix(d, planningSimulation(d, sim), n)])),
    resolved: resolvedRecord(analysis),
  };
}

/** The heat map and the callout: each node's level and badge text, and the headline with its fix. */
function viewRecord(view: CapacityView) {
  return {
    tone: view.tone,
    top: view.top?.id ?? null,
    headline: view.headline,
    detail: view.detail,
    fix: view.fix,
    addConsumer: view.addConsumer ?? null,
    converged: view.converged,
    nodes: Object.fromEntries(
      Object.entries(view.nodes).map(([id, n]) => {
        const extra = {
          ...(n.modeled ? {} : { modeled: false }),
          ...(n.noReader ? { noReader: true } : {}),
          ...(n.waitsIn ? { waitsIn: n.waitsIn } : {}),
        };
        return [id, [n.level, n.text, ...(Object.keys(extra).length ? [extra] : [])]];
      }),
    ),
  };
}

/** The Inputs panel's presets on free play: what each does to the inputs, the heat map and the partition notes. */
function presets(d: DiagramFile) {
  return Object.fromEntries(
    PRESETS.map((preset) => {
      const inputs = applyPreset(preset.id, emptyInputs(), d, null);
      return [
        preset.id,
        {
          inputs,
          view: viewRecord(capacityView(d, freePlaySimulation(d, inputs))),
          partitionsNotes: mapToObject(partitionsNotes(d, null, inputs)),
        },
      ];
    }),
  );
}

/** A context's record, with each part that equals edit mode's written as SAME (most of them, usually). */
const SAME = "(same as edit)";
function sameAs<T extends Record<string, unknown>>(edit: T, other: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(other).map(([key, value]) => [
      key,
      // Compared as the goldens print them: JSON.stringify would call Infinity and NaN both null.
      key !== "simulation" && stable(value) === stable(edit[key]) ? SAME : value,
    ]),
  );
}

/** The live view's state with a simulation selected (or free play), before it plays. */
function liveState(d: DiagramFile, sim: Simulation): LiveState {
  const c = new LiveController(d);
  c.selectSimulation(sim);
  const state = c.getState();
  c.dispose();
  return state;
}

function record(d: DiagramFile) {
  const assignments = brokerAssignments(d);
  const sims = d.simulations ?? [];
  const edit = planning(d, null);
  return {
    autoScale: {
      freePlay: autoScale(freePlaySimulation(d, emptyInputs()), d),
      ...Object.fromEntries(sims.map((s) => [s.id, autoScale(s, d)])),
    },
    brokerAssignments: { brokers: mapToObject(assignments.brokers), consumers: mapToObject(assignments.consumers) },
    edit,
    simulations: Object.fromEntries(sims.map((s) => [s.id, sameAs(edit, planning(d, liveState(d, s)))])),
    capacity: {
      freePlay: presets(d),
      ...Object.fromEntries(
        sims.map((s) => [s.id, viewRecord(capacityView(d, effectiveSimulation(s, emptyInputs())))]),
      ),
    },
  };
}

describe("planning", () => {
  for (const { slug, diagram } of allDiagrams) it(slug, () => expectGolden(`planning/${slug}.json`, record(diagram)));
});

describe("planning revision p2 upgrade", () => {
  for (const { slug, diagram } of examples)
    it(slug, () => {
      const upgraded = upgradePlanning(diagram);
      const legacy = legacyExport(upgraded);
      expectGolden(`planning-p2/${slug}.json`, {
        format: upgraded.format,
        planning: upgraded.planning,
        nodeProps: Object.fromEntries(upgraded.nodes.map((n) => [n.id, n.props ?? null])),
        legacyExport: { format: legacy.diagram.format, losses: legacy.losses },
        ...record(upgraded),
      });
    });
});
