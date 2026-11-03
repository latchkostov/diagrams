import type { DiagramFile, Simulation } from "../../model/types";
import { analyzeCapacity } from "../capacity";
const initialRate = (shape: Simulation["traffic"][number]["shape"]): number => {
  if (shape.kind === "burst") return 0;
  if (shape.kind === "spike") return shape.atMs === 0 && shape.peakMs > 0 ? shape.peakRate : shape.baseRate;
  if ((shape.fromMs ?? 0) > 0) return 0;
  return shape.kind === "constant" ? shape.ratePerSec : (shape.startRate ?? 0);
};
export function cachePlan(diagram: DiagramFile, simulation?: Simulation) {
  const starting = simulation && {
    ...simulation,
    timeline: [],
    traffic: simulation.traffic.map((p) => ({
      ...p,
      shape: { kind: "constant" as const, ratePerSec: initialRate(p.shape), durationMs: 1000 },
    })),
  };
  return analyzeCapacity(diagram, starting).cacheDemand ?? {};
}
