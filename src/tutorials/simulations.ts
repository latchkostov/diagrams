import type { DiagramFile, Simulation } from "../model/types";
import { drillFault } from "../live/faults";
import type { Demo, SimulationMatch } from "./types";

/**
 * Saved simulations as tutorial data: whether one is the simulation a step asks for, and the one a saveSimulation demo
 * authors, as Simulations… would (a Drill step per fault preset, aimed by the preset at the diagram's own targets).
 */

/** A saved simulation is this one: its id, a Drill step (the preset, or any), enough expectations. */
export function matchesSimulation(sim: Simulation | null | undefined, match: SimulationMatch): boolean {
  if (!sim || (match.id !== undefined && sim.id !== match.id)) return false;
  if (
    match.drill &&
    !(sim.timeline ?? []).some(
      (step) => step.action.do === "fault" && (match.drill === "any" || step.action.drill === match.drill),
    )
  )
    return false;
  return (sim.expectations?.length ?? 0) >= (match.expectations ?? 0);
}

/**
 * The diagram's saved simulations with the demo's in them, or null when nothing is missing. Edit-preserving: one saved
 * under the demo's id keeps its own steps and checks and gains only the Drill steps and expectations it lacks.
 */
export function withSavedSimulation(
  diagram: DiagramFile,
  demo: Extract<Demo, { kind: "saveSimulation" }>,
): Simulation[] | null {
  const saved = diagram.simulations ?? [];
  const own = saved.find((sim) => sim.id === demo.id);
  const next = authoredSimulation(diagram, own, demo);
  if (!next) return null;
  return own ? saved.map((sim) => (sim === own ? next : sim)) : [...saved, next];
}

/** `own` (the learner's copy of the demo's simulation, if any) with what the demo authors and it lacks; null: nothing. */
export function authoredSimulation(
  diagram: DiagramFile,
  own: Simulation | undefined,
  demo: Extract<Demo, { kind: "saveSimulation" }>,
): Simulation | null {
  const drills = (demo.drills ?? []).filter(
    (d) => !own?.timeline?.some((step) => step.action.do === "fault" && step.action.drill === d.preset),
  );
  const expectations = (demo.expectations ?? []).filter((e) => !own?.expectations?.some((x) => x.id === e.id));
  if (own && !drills.length && !expectations.length) return null;
  const base: Simulation = own ?? {
    id: demo.id,
    title: demo.title(),
    seed: 7,
    traffic: [],
    timeline: [],
    expectations: [],
  };
  return {
    ...base,
    timeline: [
      ...(base.timeline ?? []),
      ...drills.map((d) => ({
        atMs: d.atMs,
        action: { do: "fault" as const, fault: drillFault(d.preset, diagram), drill: d.preset },
      })),
    ],
    expectations: [...(base.expectations ?? []), ...expectations],
  };
}
