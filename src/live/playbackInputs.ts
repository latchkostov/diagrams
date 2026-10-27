// Playback inputs stay independent of panel formatting, presets and analysis.
import type { DiagramFile, DiagramNode, SimRole, Simulation, TrafficShape } from "../model/types";
import type { CapacityFix } from "./capacityModel";
import { replicaRange } from "../model/resourceRuntime";
import { stencilRole } from "../stencils/roles";
import { mixTotal, resolveNodeProps } from "../sim/defaults";
import type { TrafficMix } from "../model/requestRouting";
import { scaleMix } from "../model/routingAppearance";
import { autoScale, peakRate } from "../sim/scale";
import { trafficWindow } from "../sim/simulation";
import { sourceTraffic, withSizing } from "../sim/capacityInputs";
import { resolveMultiplier, resolveScale } from "../sim/units";

/** What the panel changes, on top of the saved simulation (or the diagram in free play). */
export interface LiveInputs {
  /** Traffic multiplier; undefined keeps the simulation's saved value. */
  traffic?: number;
  /** Capacity (replica) multiplier; undefined keeps the saved value. */
  capacity?: number;
  /** Real messages per dot; undefined keeps the saved (or automatic) scale. */
  scale?: number;
  /** Per-node property overrides (replicas, latencyMs, failureRate, partitions, …). */
  props: Record<string, Record<string, unknown>>;
  /** Entry rates in real msg/s (peak), by node. */
  rates: Record<string, number>;
}

export const emptyInputs = (): LiveInputs => ({ props: {}, rates: {} });

export function hasInputs(i: LiveInputs): boolean {
  return (
    i.traffic !== undefined ||
    i.capacity !== undefined ||
    i.scale !== undefined ||
    Object.values(i.props).some((p) => Object.keys(p).length > 0) ||
    Object.keys(i.rates).length > 0
  );
}

const roleOf = (n: DiagramNode): SimRole => stencilRole(n.stencil);

/** Node props as the simulation sees them: diagram props, then the saved setup, then overrides. */
export function baseProps(
  d: DiagramFile,
  node: DiagramNode,
  sim: Simulation | null | undefined,
  overrides?: Record<string, unknown>,
): ReturnType<typeof resolveNodeProps> {
  return resolveNodeProps(d, node, { ...sim?.setup?.props?.[node.id], ...overrides });
}

/** Multiplies every rate (or count) of a traffic shape. */
export function scaleShape(shape: TrafficShape, factor: number): TrafficShape {
  const f = Number.isFinite(factor) ? Math.max(0, factor) : 1;
  switch (shape.kind) {
    case "constant":
      return { ...shape, ratePerSec: shape.ratePerSec * f };
    case "spike":
      return { ...shape, baseRate: shape.baseRate * f, peakRate: shape.peakRate * f };
    case "ramp":
      return {
        ...shape,
        startRate: (shape.startRate ?? 0) * f,
        stages: shape.stages.map((s) => ({ ...s, targetRate: s.targetRate * f })),
      };
    case "burst":
      return { ...shape, count: Math.round(shape.count * f) };
  }
}

/** A shape with the given peak rate (used when its current peak is zero, so scaling can't work). */
function shapeWithPeak(shape: TrafficShape, rate: number): TrafficShape {
  switch (shape.kind) {
    case "constant":
      return { ...shape, ratePerSec: rate };
    case "spike":
      return { ...shape, baseRate: rate, peakRate: rate };
    case "ramp":
      return { ...shape, startRate: rate, stages: shape.stages.map((s) => ({ ...s, targetRate: rate })) };
    case "burst":
      return { ...shape, count: Math.round((rate * (shape.spreadMs || 1000)) / 1000) };
  }
}

/** Sets an entry point's peak rate: scales its traffic profiles, or adds a steady one. Mutates `sim`. */
export function setEntryRate(sim: Simulation, nodeId: string, rate: number): void {
  const target = Math.max(0, Number.isFinite(rate) ? rate : 0);
  const profiles = sim.traffic.filter((p) => p.node === nodeId);
  const total = profiles.reduce((sum, p) => sum + peakRate(p.shape), 0);
  if (profiles.length) {
    for (const p of profiles)
      p.shape = total > 0 ? scaleShape(p.shape, target / total) : shapeWithPeak(p.shape, target / profiles.length);
    return;
  }
  if (!target) return;
  const end = Math.max(0, ...sim.traffic.map((p) => trafficWindow(p.shape).endMs));
  const ids = new Set(sim.traffic.map((p) => p.id));
  let id = `rate-${nodeId}`;
  for (let i = 2; ids.has(id); i++) id = `rate-${nodeId}-${i}`;
  sim.traffic.push({
    id,
    node: nodeId,
    label: "Entry rate",
    shape: { kind: "constant", ratePerSec: target, fromMs: 0, durationMs: end || sim.durationMs || 10_000 },
  });
}

function mergeProps(
  base: Record<string, Record<string, unknown>> | undefined,
  over: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = structuredClone(base ?? {});
  for (const [id, props] of Object.entries(over)) {
    if (!Object.keys(props).length) continue;
    out[id] = { ...out[id], ...props };
  }
  return out;
}

/** The saved simulation with the panel's inputs applied: what the live run plays and Save writes. */
export function effectiveSimulation(base: Simulation, inputs: LiveInputs): Simulation {
  const sim = structuredClone(base);
  for (const [id, rate] of Object.entries(inputs.rates)) setEntryRate(sim, id, rate);
  const props = mergeProps(base.setup?.props, inputs.props);
  if (Object.keys(props).length) sim.setup = { ...sim.setup, props };
  if (inputs.traffic !== undefined || inputs.capacity !== undefined) {
    sim.multipliers = {
      traffic: inputs.traffic ?? resolveMultiplier(base.multipliers?.traffic),
      capacity: inputs.capacity ?? resolveMultiplier(base.multipliers?.capacity),
    };
  }
  if (inputs.scale !== undefined) sim.scale = resolveScale(inputs.scale);
  return sim;
}

export const sourceIds = (d: DiagramFile) => d.nodes.filter((n) => roleOf(n) === "source").map((n) => n.id);

/** Free play's entry rates: each source's ratePerSec (with overrides). */
export function freeRate(d: DiagramFile, id: string, inputs: LiveInputs): number {
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return 0;
  return inputs.rates[id] ?? baseProps(d, node, null, inputs.props[id]).ratePerSec;
}

/** Free play as a simulation (steady traffic at every source), so the analyzer sees the multipliers. */
export function freePlaySimulation(d: DiagramFile, inputs: LiveInputs): Simulation {
  return {
    id: "free-play",
    title: "Free play",
    traffic: sourceTraffic(d, (n) => freeRate(d, n.id, inputs)),
    setup: { props: mergeProps(undefined, inputs.props) },
    multipliers: { traffic: inputs.traffic ?? 1, capacity: inputs.capacity ?? 1 },
    scale: inputs.scale,
  };
}

/** Engine props for free play: overrides plus each source's rate × traffic (the engine has no multiplier). */
export function freePlayProps(d: DiagramFile, inputs: LiveInputs): Record<string, Record<string, unknown>> {
  const out = mergeProps(undefined, inputs.props);
  const traffic = inputs.traffic ?? 1;
  for (const id of sourceIds(d)) {
    if (traffic === 1 && inputs.rates[id] === undefined) continue;
    const target = freeRate(d, id, inputs) * traffic;
    // A rates-mode mix owns its total: scale its rows once (its stored ratePerSec stays dormant).
    const mix = (out[id]?.trafficMix ?? d.nodes.find((n) => n.id === id)?.props?.trafficMix) as TrafficMix | undefined;
    const total = mixTotal(d.planning, mix);
    if (total !== undefined) out[id] = { ...out[id], trafficMix: scaleMix(mix!, total > 0 ? target / total : 0) };
    else out[id] = { ...out[id], ratePerSec: target };
  }
  return out;
}

/** Free play's dot weight: an explicit choice, or the automatic 1/2/5 scale for ≤ ~60 dots/s. */
export function freePlayScale(d: DiagramFile, inputs: LiveInputs): number {
  return resolveScale(inputs.scale ?? autoScale(freePlaySimulation(d, { ...inputs, scale: undefined }), d));
}

/** Applies a fix to saved setup props (simulation) — returns a new simulation. */
export function withFix(sim: Simulation, fix: CapacityFix): Simulation {
  return withSizing(sim, fix.changes);
}

/** Drops the overrides a fix replaces, so the fix shows through. */
export function inputsWithoutFix(inputs: LiveInputs, fix: CapacityFix): LiveInputs {
  let props = inputs.props;
  for (const c of fix.changes) props = withoutProp(props, c.nodeId, c.key);
  return { ...inputs, props };
}

/** Removes one override (and the node's entry once it's empty). */
export function withoutProp(
  props: Record<string, Record<string, unknown>>,
  id: string,
  key: string,
): Record<string, Record<string, unknown>> {
  if (!props[id] || !(key in props[id])) return props;
  const own = Object.fromEntries(Object.entries(props[id]).filter(([k]) => k !== key));
  const rest = Object.fromEntries(Object.entries(props).filter(([k]) => k !== id));
  return Object.keys(own).length ? { ...rest, [id]: own } : rest;
}

/** Free play's "Save to diagram": overrides plus Traffic × and Capacity × folded into rates and replicas. */
export function freePlaySaveProps(d: DiagramFile, inputs: LiveInputs): Record<string, Record<string, unknown>> {
  const out = freePlayProps(d, inputs);
  const capacity = inputs.capacity ?? 1;
  if (capacity !== 1)
    for (const n of d.nodes) {
      // Capacity × scales what has capacity in units: a service's replicas and a network device's units.
      const props = baseProps(d, n, null, inputs.props[n.id]);
      if (
        (props.admission && props.admission.fixedSlotsPerReplica === undefined) ||
        (roleOf(n) !== "processor" && !props.device)
      )
        continue;
      if (props.autoscaling?.mode === "on") {
        const autoscaling = structuredClone(props.autoscaling),
          range = replicaRange(autoscaling.controller, capacity);
        Object.assign(autoscaling.controller, {
          minReplicas: range.min,
          maxReplicas: range.max,
          initialReplicas: range.initial,
        });
        out[n.id] = { ...out[n.id], autoscaling };
      } else {
        const replicas = Math.max(1, Math.round(props.replicas * capacity));
        out[n.id] = { ...out[n.id], replicas };
      }
    }
  return out;
}
