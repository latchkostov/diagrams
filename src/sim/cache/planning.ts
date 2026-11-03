import type { DiagramFile } from "../../model/types";
import { analyzeCapacity } from "../capacity";
export function cachePlan(diagram: DiagramFile) {
  return analyzeCapacity(diagram).cacheDemand ?? {};
}
