import type { DiagramFile } from "../model/types";
import type { Finding } from "../checks/types";
import { simulationContent } from "../sim/simulationContent";

// Only verified worker results cross back to main-thread rechecks and agent tools.
const cache = new Map<string, Finding[]>();
export function rememberRequestChecks(d: DiagramFile, findings: Finding[]): void {
  const key = simulationContent(d);
  cache.delete(key);
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(
    key,
    findings.filter((f) => !!f.requestFinding),
  );
}
export function rememberedRequestChecks(d: DiagramFile): Finding[] | undefined {
  return cache.get(simulationContent(d));
}
