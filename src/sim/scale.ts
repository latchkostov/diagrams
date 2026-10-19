import { revisionAtLeast } from "../model/revisions";
import { replicaRange } from "../model/autoscaling";
import { resolveProps } from "./defaults";
import type { DiagramFile, Simulation, TrafficShape } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveMultiplier } from "./units";
import { mixTotal } from "./defaults";

const positive = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? Math.max(0, n) : 0);
/** Sustained peak for capacity planning; instantaneous batches use a one-second window. */
export function peakRate(shape: TrafficShape): number {
  switch (shape.kind) {
    case "constant":
      return positive(shape.ratePerSec);
    case "spike":
      return Math.max(positive(shape.baseRate), positive(shape.peakRate));
    case "ramp":
      return Math.max(positive(shape.startRate), ...shape.stages.map((stage) => positive(stage.targetRate)));
    case "burst":
      return Math.min(
        Number.MAX_SAFE_INTEGER,
        (positive(shape.count) * 1000) / (positive(shape.spreadMs) ? Math.max(1, positive(shape.spreadMs)) : 1000),
      );
  }
}
/** Conservative sum of entry peaks, rounded upward to the 1/2/5 series. Does not mutate the input. */
export function autoScale(simulation: Simulation, diagram: DiagramFile): number {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  const rate = simulation.traffic.length
    ? simulation.traffic.reduce((sum, profile) => sum + (ids.has(profile.node) ? peakRate(profile.shape) : 0), 0)
    : diagram.nodes.reduce(
        (sum, node) =>
          sum +
          (stencilRole(node.stencil) === "source"
            ? positive(
                // A rates-mode traffic mix supplies its own total; otherwise the stored rate, as before.
                mixTotal(diagram.planning, simulation.setup?.props?.[node.id]?.trafficMix ?? node.props?.trafficMix) ??
                  ((simulation.setup?.props?.[node.id]?.ratePerSec ?? node.props?.ratePerSec ?? 2) as number),
              )
            : 0),
        0,
      );
  const injections = (simulation.timeline ?? []).reduce(
    (sum, step) =>
      sum +
      (step.action.do === "inject" && ids.has(step.action.node)
        ? peakRate({ kind: "burst", count: step.action.count, spreadMs: step.action.spreadMs })
        : 0),
    0,
  );
  const required = ((rate + injections) * resolveMultiplier(simulation.multipliers?.traffic)) / 60;
  if (!Number.isFinite(required)) return Number.MAX_SAFE_INTEGER;
  if (required <= 1) return 1;
  // Multiplication keeps dot-scale rounding identical across JavaScript engines.
  let power = 1;
  while (power * 10 <= required) power *= 10;
  let scale = Math.min(Number.MAX_SAFE_INTEGER, [1, 2, 5, 10].find((value) => value * power >= required)! * power);
  if (revisionAtLeast(diagram.planning?.revision, "p3-w1")) {
    const callers = new Set(
      diagram.edges.filter((e) => e.kind === "sync" && (!e.relation || e.relation === "flow")).map((e) => e.from),
    );
    for (const node of diagram.nodes)
      if (callers.has(node.id) && stencilRole(node.stencil) === "processor") {
        const props = resolveProps(
          "processor",
          node.label,
          { ...node.props, ...simulation.setup?.props?.[node.id] },
          node.stencil,
          diagram.planning,
        );
        const multiplier = resolveMultiplier(simulation.multipliers?.capacity);
        const replicas =
          props.autoscaling?.mode === "on"
            ? replicaRange(props.autoscaling.controller, multiplier).initial
            : Math.max(1, Math.round(props.replicas * multiplier));
        const slots = props.admission?.slots ?? replicas * props.concurrency;
        scale = Math.min(scale, Math.max(1, slots / 4));
      }
  }
  return scale;

}
