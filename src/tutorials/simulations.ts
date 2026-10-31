import type { DiagramFile, Simulation } from "../model/types";
import { drillFault } from "../live/faults";
import { equal } from "./paths";
import type { Demo, SimulationMatch } from "./types";

/**
 * Saved simulations as tutorial data: whether one is the simulation a step asks for, and the one a saveSimulation demo
 * authors, as Simulations… would (a Drill step per fault preset, aimed by the preset at the diagram's own targets).
 */

/** A saved simulation is this one: its id, a Drill step (the preset, or any), enough expectations. */
export function matchesSimulation(sim: Simulation | null | undefined, match: SimulationMatch): boolean {
  if (!sim || (match.id !== undefined && sim.id !== match.id)) return false;
  if (
    (match.drill || match.fault) &&
    !(sim.timeline ?? []).some(
      (step) =>
        step.action.do === "fault" &&
        (!match.drill || match.drill === "any" || step.action.drill === match.drill) &&
        (!match.fault ||
          (step.atMs === match.fault.atMs &&
            "node" in step.action.fault &&
            step.action.fault.node === match.fault.node &&
            (!match.fault.kind || step.action.fault.kind === match.fault.kind))),
    )
  )
    return false;
  if (
    match.traffic &&
    (sim.traffic.length !== match.traffic.length ||
      !match.traffic.every((p) =>
        sim.traffic.some(
          (actual) => actual.node === p.node && actual.messageType === p.messageType && equal(actual.shape, p.shape),
        ),
      ))
  )
    return false;
  if (match.seed !== undefined && sim.seed !== match.seed) return false;
  if (match.scale !== undefined && (sim.scale ?? 1) !== match.scale) return false;
  if (match.durationMs !== undefined && sim.durationMs !== match.durationMs) return false;
  if (
    (["traffic", "capacity"] as const).some(
      (input) =>
        match.multipliers?.[input] !== undefined && (sim.multipliers?.[input] ?? 1) !== match.multipliers[input],
    )
  )
    return false;
  if (
    match.note &&
    !sim.timeline?.some(
      (s) =>
        s.atMs === match.note!.atMs &&
        s.action.do === "note" &&
        !!s.action.text.trim() &&
        s.action.pause === match.note!.pause &&
        s.action.focus?.includes(match.note!.focus),
    )
  )
    return false;
  if (
    match.expectation &&
    !sim.expectations?.some(
      (e) =>
        equal(e.metric, match.expectation!.metric) &&
        e.op === match.expectation!.op &&
        e.value === match.expectation!.value &&
        (e.when ?? "end") === match.expectation!.when,
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
  if (demo.definition) {
    // The reference is explicit; keep unrelated authored timeline items and settings.
    const definition = demo.definition;
    const next = {
      ...own,
      ...definition,
      timeline: [
        ...(own?.timeline ?? []).filter(
          (s) => !definition.timeline?.some((d) => d.atMs === s.atMs && d.action.do === s.action.do),
        ),
        ...(definition.timeline ?? []).map((d) => {
          const existing = own?.timeline?.find((s) => s.atMs === d.atMs && s.action.do === d.action.do);
          return d.action.do === "note" &&
            existing?.action.do === "note" &&
            existing.action.text.trim() &&
            existing.action.pause === d.action.pause &&
            equal(existing.action.focus, d.action.focus)
            ? existing
            : d;
        }),
      ],
      expectations: [
        ...(own?.expectations ?? []).filter((e) => !definition.expectations?.some((d) => d.id === e.id)),
        ...(definition.expectations ?? []),
      ],
    };
    return equal(own, next) ? null : next;
  }
  const drills = (demo.drills ?? []).filter(
    (d) => !own?.timeline?.some((step) => step.action.do === "fault" && step.action.drill === d.preset),
  );
  const expectations = (demo.expectations ?? []).filter((e) => !own?.expectations?.some((x) => x.id === e.id));
  if (
    own &&
    !drills.length &&
    !expectations.length &&
    (demo.durationMs === undefined || own.durationMs === demo.durationMs)
  )
    return null;
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
    ...(demo.durationMs === undefined ? {} : { durationMs: demo.durationMs }),
    timeline: [
      ...(base.timeline ?? []),
      ...drills.map((d) => ({
        atMs: d.atMs,
        action: {
          do: "fault" as const,
          fault: (() => {
            const fault = drillFault(d.preset, diagram);
            return d.target && "node" in fault ? { ...fault, node: d.target } : fault;
          })(),
          drill: d.preset,
        },
      })),
    ],
    expectations: [...(base.expectations ?? []), ...expectations],
  };
}
