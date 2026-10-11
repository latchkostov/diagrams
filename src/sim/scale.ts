import type { DiagramFile, Simulation, TrafficShape } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveMultiplier } from "./units";

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
            ? positive((simulation.setup?.props?.[node.id]?.ratePerSec ?? node.props?.ratePerSec ?? 2) as number)
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
  const power = 10 ** Math.floor(Math.log10(required));
  return Math.min(Number.MAX_SAFE_INTEGER, [1, 2, 5, 10].find((value) => value * power >= required)! * power);
}
